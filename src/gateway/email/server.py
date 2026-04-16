"""Email gateway entrypoint with health endpoint."""
from __future__ import annotations

import asyncio
import os
import threading

import uvicorn
from fastapi import FastAPI

health_app = FastAPI(title="NUVEX Email Gateway", version="0.1.0")
_running = False


@health_app.get("/health")
async def health():
    return {"status": "ok", "poller": "running" if _running else "starting"}


def _run_health():
    uvicorn.run(
        health_app,
        host="0.0.0.0",
        port=int(os.environ.get("GATEWAY_MAIL_PORT", "8103")),
        log_level="warning",
    )


async def main():
    global _running
    required = ["IMAP_HOST", "SMTP_HOST", "EMAIL_USER", "EMAIL_PASS"]
    missing = [k for k in required if not os.environ.get(k)]
    if missing:
        raise RuntimeError(
            "Missing required email gateway env vars: "
            + ", ".join(missing)
            + ". Add them to config/channels.env and restart gateway-email."
        )

    t = threading.Thread(target=_run_health, daemon=True)
    t.start()
    _running = True
    from .poller import run_poller
    await run_poller()


if __name__ == "__main__":
    asyncio.run(main())
