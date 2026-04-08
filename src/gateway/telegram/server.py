"""Telegram gateway health endpoint + main entrypoint."""
from __future__ import annotations

import asyncio
import os
import threading

import uvicorn
from fastapi import FastAPI

health_app = FastAPI(title="NUVEX Telegram Gateway", version="0.1.0")

_bot_running = False


@health_app.get("/health")
async def health():
    return {"status": "ok", "bot": "running" if _bot_running else "starting"}


def _run_health_server():
    port = int(os.environ.get("GATEWAY_TG_PORT", "8102"))
    uvicorn.run(health_app, host="0.0.0.0", port=port, log_level="warning")


async def main():
    global _bot_running
    # Start health server in background thread
    t = threading.Thread(target=_run_health_server, daemon=True)
    t.start()

    bot_token = os.environ.get("TELEGRAM_BOT_TOKEN", "")
    if not bot_token:
        import logging
        logging.getLogger(__name__).warning(
            "TELEGRAM_BOT_TOKEN not set — gateway health endpoint running but bot is disabled"
        )
        # Keep health server alive without starting the bot
        await asyncio.Event().wait()
        return

    from .bot import build_app, start_action_poller

    app = build_app()
    _bot_running = True
    await app.initialize()
    await app.start()
    await app.updater.start_polling(drop_pending_updates=True)
    # Start cross-channel action poller as a background task
    asyncio.create_task(start_action_poller(app))
    # Block forever
    await asyncio.Event().wait()


if __name__ == "__main__":
    asyncio.run(main())
