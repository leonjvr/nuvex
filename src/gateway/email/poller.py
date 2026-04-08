"""Email gateway — IMAP poller + SMTP sender."""
from __future__ import annotations

import asyncio
import email as email_lib
import logging
import os
from email.header import decode_header
from email.mime.text import MIMEText

import aioimaplib
import aiosmtplib
import httpx

log = logging.getLogger(__name__)

BRAIN_URL = os.environ.get("BRAIN_URL", "http://brain:8100")
AGENT_ID = os.environ.get("NUVEX_AGENT_ID", "maya")
IMAP_HOST = os.environ["IMAP_HOST"]
IMAP_PORT = int(os.environ.get("IMAP_PORT", "993"))
SMTP_HOST = os.environ["SMTP_HOST"]
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
EMAIL_USER = os.environ["EMAIL_USER"]
EMAIL_PASS = os.environ["EMAIL_PASS"]
POLL_INTERVAL = int(os.environ.get("IMAP_POLL_INTERVAL", "30"))


def _decode_header_value(val: str | bytes) -> str:
    parts = decode_header(val)
    return "".join(
        (b.decode(enc or "utf-8") if isinstance(b, bytes) else b)
        for b, enc in parts
    )


async def _invoke(message: str, from_addr: str, subject: str) -> str:
    thread_id = f"{AGENT_ID}:email:{from_addr}"
    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.post(
            f"{BRAIN_URL}/invoke",
            json={
                "agent_id": AGENT_ID,
                "message": f"Subject: {subject}\n\n{message}",
                "thread_id": thread_id,
                "metadata": {"channel": "email", "sender": from_addr},
            },
        )
        r.raise_for_status()
        data = r.json()
        return data.get("reply", "")


async def _send_reply(to_addr: str, subject: str, body: str) -> None:
    msg = MIMEText(body, "plain")
    msg["From"] = EMAIL_USER
    msg["To"] = to_addr
    msg["Subject"] = f"Re: {subject}"
    async with aiosmtplib.SMTP(hostname=SMTP_HOST, port=SMTP_PORT, use_tls=False) as smtp:
        await smtp.starttls()
        await smtp.login(EMAIL_USER, EMAIL_PASS)
        await smtp.send_message(msg)


async def poll_imap() -> None:
    """Poll IMAP for unseen messages and process them."""
    client = aioimaplib.IMAP4_SSL(host=IMAP_HOST, port=IMAP_PORT)
    await client.wait_hello_from_server()
    await client.login(EMAIL_USER, EMAIL_PASS)
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
            reply = await _invoke(body.strip(), from_addr, subject)
            if reply:
                await _send_reply(from_addr, subject, reply)

            await client.store(uid, "+FLAGS", "\\Seen")
        except Exception as exc:
            log.error("Failed to process email uid=%s: %s", uid, exc)

    await client.logout()


async def run_poller() -> None:
    log.info("Email gateway: starting IMAP poller (interval=%ds)", POLL_INTERVAL)
    while True:
        try:
            await poll_imap()
        except Exception as exc:
            log.error("IMAP poll error: %s", exc)
        await asyncio.sleep(POLL_INTERVAL)
