"""Telegram gateway health endpoint + main entrypoint."""
from __future__ import annotations

import asyncio
import os
import threading

import uvicorn
from fastapi import FastAPI

health_app = FastAPI(title="NUVEX Telegram Gateway", version="0.1.0")

# "starting" | "connecting" | "connected" | "error: <reason>"
bot_state: str = "starting"


@health_app.get("/health")
async def health():
    return {"status": "ok", "bot": bot_state, "connected": bot_state == "connected"}


def _run_health_server():
    port = int(os.environ.get("GATEWAY_TG_PORT", "8102"))
    uvicorn.run(health_app, host="0.0.0.0", port=port, log_level="warning")


async def main():
    global bot_state
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

    try:
        bot_state = "connecting"
        app = build_app()
        await app.initialize()
        await app.start()
        await app.updater.start_polling(drop_pending_updates=True)
        bot_state = "connected"
    except Exception as exc:
        import logging
        logging.getLogger(__name__).error("Telegram bot failed to start: %s", exc)
        bot_state = f"error: {str(exc)[:80]}"
        await asyncio.Event().wait()
        return

    # Start cross-channel action poller as a background task
    asyncio.create_task(start_action_poller(app))
    # Block forever
    await asyncio.Event().wait()


if __name__ == "__main__":
    asyncio.run(main())
