"""Email gateway — IMAP IDLE listener + SMTP sender.

Uses IMAP IDLE (RFC 2177) so new messages trigger the agent immediately
rather than waiting for a polling interval.  Falls back to a 29-minute
re-IDLE cycle (servers terminate IDLE after ~30 min per spec).

Config priority (highest → lowest):
  1. Brain API: GET {BRAIN_URL}/agents/{AGENT_ID}/email-config
     (credentials saved by the user via the dashboard)
  2. Environment variables (IMAP_HOST, SMTP_HOST, EMAIL_USER, EMAIL_PASS)
     (used as bootstrap / fallback when the brain is unavailable)
"""
from __future__ import annotations

import asyncio
import dataclasses
import email as email_lib
import logging
import os
from email.header import decode_header
from email.mime.text import MIMEText
from email.utils import parseaddr

import aioimaplib
import aiosmtplib
import httpx

log = logging.getLogger(__name__)

# ── Identity (env var only; not part of the channel config stored in YAML) ──
BRAIN_URL = os.environ.get("BRAIN_URL", "http://brain:8100")
AGENT_ID = os.environ.get("NUVEX_AGENT_ID", "maya")
ORG_ID = os.environ.get("NUVEX_ORG_ID", "") or "default"


# ── Config dataclass ─────────────────────────────────────────────────────────

@dataclasses.dataclass
class EmailConfig:
    imap_host: str
    imap_port: int
    smtp_host: str
    smtp_port: int
    email_user: str
    email_pass: str


async def _load_config() -> EmailConfig:
    """Load email channel config from the brain API; fall back to env vars.

    The brain reads the agent's channel config from nuvex.yaml (written by
    the dashboard when the user saves their email settings).  If the brain is
    unavailable or the config is incomplete we fall back to env vars so the
    gateway still works in a plain Docker-Compose bootstrap.
    """
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(f"{BRAIN_URL}/agents/{AGENT_ID}/email-config")
            r.raise_for_status()
            data: dict = r.json()
        if data.get("imap_host") and data.get("email_user") and data.get("email_pass"):
            log.info(
                "email-gateway: loaded config from brain for agent=%s user=%s",
                AGENT_ID, data["email_user"],
            )
            return EmailConfig(
                imap_host=data["imap_host"],
                imap_port=int(data.get("imap_port", 993)),
                smtp_host=data["smtp_host"],
                smtp_port=int(data.get("smtp_port", 587)),
                email_user=data["email_user"],
                email_pass=data["email_pass"],
            )
        log.warning("email-gateway: brain config incomplete — falling back to env vars")
    except Exception as exc:
        log.warning("email-gateway: could not reach brain (%s) — falling back to env vars", exc)

    # Env-var fallback (only used when brain config is temporarily unavailable)
    imap_host = os.environ.get("IMAP_HOST")
    smtp_host = os.environ.get("SMTP_HOST")
    email_user = os.environ.get("EMAIL_USER")
    email_pass = os.environ.get("EMAIL_PASS")
    if not (imap_host and smtp_host and email_user and email_pass):
        raise RuntimeError("email config unavailable from brain and env fallback is incomplete")
    return EmailConfig(
        imap_host=imap_host,
        imap_port=int(os.environ.get("IMAP_PORT", "993")),
        smtp_host=smtp_host,
        smtp_port=int(os.environ.get("SMTP_PORT", "587")),
        email_user=email_user,
        email_pass=email_pass,
    )


# ── Header decode ─────────────────────────────────────────────────────────────

def _decode_header_value(val: str | bytes) -> str:
    parts = decode_header(val)
    return "".join(
        (b.decode(enc or "utf-8") if isinstance(b, bytes) else b)
        for b, enc in parts
    )


# ── Brain invocation ──────────────────────────────────────────────────────────

async def _invoke(cfg: EmailConfig, message: str, from_addr: str, subject: str, sender_name: str = "") -> str:
    thread_id = f"{ORG_ID}:{AGENT_ID}:email:{from_addr}"
    metadata: dict = {"channel": "email", "sender": from_addr}
    if sender_name:
        metadata["sender_name"] = sender_name
    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.post(
            f"{BRAIN_URL}/invoke",
            json={
                "agent_id": AGENT_ID,
                "org_id": ORG_ID,
                "message": f"Subject: {subject}\n\n{message}",
                "thread_id": thread_id,
                "metadata": metadata,
            },
        )
        r.raise_for_status()
        return r.json().get("reply", "")


# ── SMTP reply ────────────────────────────────────────────────────────────────

async def _send_reply(cfg: EmailConfig, to_addr: str, subject: str, body: str) -> None:
    msg = MIMEText(body, "plain")
    msg["From"] = cfg.email_user
    msg["To"] = to_addr
    msg["Subject"] = f"Re: {subject}"
    # Port 465 = implicit TLS (SMTPS); port 587 = STARTTLS.
    # Some hosts auto-upgrade on 587 so we catch "already using TLS" and skip.
    # Use the SMTP hostname as the EHLO name so the relay sees a proper FQDN.
    use_tls = cfg.smtp_port == 465
    async with aiosmtplib.SMTP(
        hostname=cfg.smtp_host,
        port=cfg.smtp_port,
        use_tls=use_tls,
        local_hostname=cfg.smtp_host,
    ) as smtp:
        if not use_tls:
            try:
                await smtp.starttls()
            except aiosmtplib.SMTPException as exc:
                if "already using tls" not in str(exc).lower():
                    raise
        await smtp.login(cfg.email_user, cfg.email_pass)
        await smtp.send_message(msg)


# ── IMAP helpers ──────────────────────────────────────────────────────────────

async def _fetch_and_process_unseen(cfg: EmailConfig, client: aioimaplib.IMAP4_SSL) -> None:
    """Fetch all UNSEEN messages from the already-selected INBOX and process them."""
    _, data = await client.search("UNSEEN")
    uids = data[0].split() if data and data[0] else []

    for uid in uids:
        # aioimaplib returns uids as bytes (e.g. b'9'); decode to str for fetch/store
        uid_str = uid.decode() if isinstance(uid, bytes) else str(uid)
        try:
            # Use PEEK so IMAP does not auto-mark the message as \Seen.
            _, msg_data = await client.fetch(uid_str, "(BODY.PEEK[])")
            if not msg_data:
                continue
            # Typical response: [b'N FETCH (BODY[] {size})', bytearray(content), b')', ...]
            raw = bytes(msg_data[1]) if len(msg_data) > 1 else bytes(msg_data[0])
            msg = email_lib.message_from_bytes(raw)
            from_addr = msg.get("From", "")
            display_name, addr_only = parseaddr(_decode_header_value(from_addr))
            sender_email = addr_only or from_addr
            sender_name = display_name.strip() if display_name else ""
            subject = _decode_header_value(msg.get("Subject") or "(no subject)")
            body = ""
            if msg.is_multipart():
                for part in msg.walk():
                    if part.get_content_type() == "text/plain":
                        body = part.get_payload(decode=True).decode(errors="replace")
                        break
            else:
                body = msg.get_payload(decode=True).decode(errors="replace")

            log.info("Processing email from=%s subject=%s", sender_email, subject)
            reply = await _invoke(cfg, body.strip(), sender_email, subject, sender_name)
            # Mark as seen after a successful invoke (agent has read it),
            # even if sending the outbound reply fails.
            await client.store(uid_str, "+FLAGS", "\\Seen")
            if reply:
                try:
                    await _send_reply(cfg, sender_email, subject, reply)
                except Exception as exc:
                    log.error("Failed to send email reply uid=%s: %s", uid, exc)
        except Exception as exc:
            log.error("Failed to process email uid=%s: %s", uid, exc)


async def _idle_loop(cfg: EmailConfig, client: aioimaplib.IMAP4_SSL) -> None:
    """Poll for new messages every 30 s using NOOP to keep the connection alive.

    IMAP IDLE (RFC 2177) is unreliable across hosting providers — many servers
    don't push EXISTS notifications or drop the IDLE session silently.  A simple
    30-second NOOP poll is universally supported and gives a good latency/cost
    trade-off for email.
    """
    POLL_INTERVAL = int(os.environ.get("IMAP_POLL_INTERVAL", "30"))
    while True:
        await asyncio.sleep(POLL_INTERVAL)
        await client.noop()
        await _fetch_and_process_unseen(cfg, client)


# ── Entry point ───────────────────────────────────────────────────────────────

async def run_poller() -> None:
    """Load config from brain, then connect via IMAP IDLE; reconnect on error."""
    from src.gateway.email._state import set_imap_state  # noqa: PLC0415

    while True:
        client: aioimaplib.IMAP4_SSL | None = None
        try:
            try:
                cfg = await _load_config()
            except Exception as exc:
                log.warning("Email gateway: config unavailable (%s) — retrying in 10s", exc)
                set_imap_state("error: config unavailable")
                await asyncio.sleep(10)
                continue

            log.info(
                "Email gateway: starting IMAP IDLE listener (host=%s user=%s)",
                cfg.imap_host, cfg.email_user,
            )
            set_imap_state("connecting")
            client = aioimaplib.IMAP4_SSL(host=cfg.imap_host, port=cfg.imap_port)
            await client.wait_hello_from_server()
            await client.login(cfg.email_user, cfg.email_pass)
            await client.select("INBOX")
            set_imap_state("connected")
            # Drain any messages that arrived while we were offline
            await _fetch_and_process_unseen(cfg, client)
            log.info("Email gateway: INBOX selected, entering IDLE")
            await _idle_loop(cfg, client)
        except Exception as exc:
            reason = str(exc)[:80]
            log.error("IMAP IDLE error: %s — reconnecting in 10s", exc)
            set_imap_state(f"error: {reason}")
            try:
                if client:
                    await client.logout()
            except Exception:
                pass
            set_imap_state("reconnecting")
            await asyncio.sleep(10)
