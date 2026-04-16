"""Email gateway entrypoint with health endpoint."""
from __future__ import annotations

import asyncio
import logging
import os
import threading

import uvicorn
from fastapi import FastAPI

from src.gateway.email._state import get_imap_state

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

health_app = FastAPI(title="NUVEX Email Gateway", version="0.1.0")


@health_app.get("/health")
async def health():
    state = get_imap_state()
    return {
        "status": "ok",
        "imap": state,
        "connected": state == "connected",
    }


def _run_health():
    uvicorn.run(
        health_app,
        host="0.0.0.0",
        port=int(os.environ.get("GATEWAY_MAIL_PORT", "8103")),
        log_level="warning",
    )


async def main():
    t = threading.Thread(target=_run_health, daemon=True)
    t.start()
    from .poller import run_poller
    await run_poller()


if __name__ == "__main__":
    asyncio.run(main())
