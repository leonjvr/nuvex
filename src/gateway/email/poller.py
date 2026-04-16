"""Email gateway — IMAP poller + SMTP sender."""
from __future__ import annotations

import asyncio
import email as email_lib
import logging
import os
from dataclasses import dataclass
from email.header import decode_header
from email.mime.text import MIMEText

import aioimaplib
import aiosmtplib
import httpx

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class EmailGatewayConfig:
    brain_url: str
    agent_id: str
    imap_host: str
    imap_port: int
    smtp_host: str
    smtp_port: int
    email_user: str
    email_pass: str
    poll_interval: int


def load_gateway_config() -> EmailGatewayConfig:
    """Load and validate required gateway settings from environment."""
    required = ["IMAP_HOST", "SMTP_HOST", "EMAIL_USER", "EMAIL_PASS"]
    missing = [k for k in required if not os.environ.get(k)]
    if missing:
        msg = (
            "Missing required email gateway env vars: "
            + ", ".join(missing)
            + ". Add them to config/channels.env and restart gateway-email."
        )
        raise RuntimeError(msg)

    return EmailGatewayConfig(
        brain_url=os.environ.get("BRAIN_URL", "http://brain:8100"),
        agent_id=os.environ.get("NUVEX_AGENT_ID", "maya"),
        imap_host=os.environ["IMAP_HOST"],
        imap_port=int(os.environ.get("IMAP_PORT", "993")),
        smtp_host=os.environ["SMTP_HOST"],
        smtp_port=int(os.environ.get("SMTP_PORT", "587")),
        email_user=os.environ["EMAIL_USER"],
        email_pass=os.environ["EMAIL_PASS"],
        poll_interval=int(os.environ.get("IMAP_POLL_INTERVAL", "30")),
    )


def _decode_header_value(val: str | bytes) -> str:
    parts = decode_header(val)
    return "".join(
        (b.decode(enc or "utf-8") if isinstance(b, bytes) else b)
        for b, enc in parts
    )


async def _invoke(cfg: EmailGatewayConfig, message: str, from_addr: str, subject: str) -> str:
    thread_id = f"{cfg.agent_id}:email:{from_addr}"
    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.post(
            f"{cfg.brain_url}/invoke",
            json={
                "agent_id": cfg.agent_id,
                "message": f"Subject: {subject}\n\n{message}",
                "thread_id": thread_id,
                "metadata": {"channel": "email", "sender": from_addr},
            },
        )
        r.raise_for_status()
        data = r.json()
        return data.get("reply", "")


async def _send_reply(cfg: EmailGatewayConfig, to_addr: str, subject: str, body: str) -> None:
    msg = MIMEText(body, "plain")
    msg["From"] = cfg.email_user
    msg["To"] = to_addr
    msg["Subject"] = f"Re: {subject}"
    async with aiosmtplib.SMTP(hostname=cfg.smtp_host, port=cfg.smtp_port, use_tls=False) as smtp:
        await smtp.starttls()
        await smtp.login(cfg.email_user, cfg.email_pass)
        await smtp.send_message(msg)


async def poll_imap(cfg: EmailGatewayConfig) -> None:
    """Poll IMAP for unseen messages and process them."""
    client = aioimaplib.IMAP4_SSL(host=cfg.imap_host, port=cfg.imap_port)
    await client.wait_hello_from_server()
    await client.login(cfg.email_user, cfg.email_pass)
    await client.select("INBOX")

    _, data = await client.search("UNSEEN")
    uids = data[0].split() if data and data[0] else []

    for uid in uids:
        try:
            _, msg_data = await client.fetch(uid, "(RFC822)")
            if not msg_data:
                continue
            raw = msg_data[1] if len(msg_data) > 1 else msg_data[0]
            msg = email_lib.message_from_bytes(raw)
            from_addr = msg.get("From", "")
            subject = _decode_header_value(msg.get("Subject", "(no subject)"))
            body = ""
            if msg.is_multipart():
                for part in msg.walk():
                    if part.get_content_type() == "text/plain":
                        body = part.get_payload(decode=True).decode(errors="replace")
                        break
            else:
                body = msg.get_payload(decode=True).decode(errors="replace")

            log.info("Processing email from=%s subject=%s", from_addr, subject)
            reply = await _invoke(cfg, body.strip(), from_addr, subject)
            if reply:
                await _send_reply(cfg, from_addr, subject, reply)

            await client.store(uid, "+FLAGS", "\\Seen")
        except Exception as exc:
            log.error("Failed to process email uid=%s: %s", uid, exc)

    await client.logout()


async def run_poller() -> None:
    cfg = load_gateway_config()
    log.info("Email gateway: starting IMAP poller (interval=%ds)", cfg.poll_interval)
    while True:
        try:
            await poll_imap(cfg)
        except Exception as exc:
            log.error("IMAP poll error: %s", exc)
        await asyncio.sleep(cfg.poll_interval)
