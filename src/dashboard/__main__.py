"""Dashboard service entrypoint."""
from __future__ import annotations

import asyncio
import os
import uvicorn

from .server import create_app

if __name__ == "__main__":
    if os.name == "nt":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    port = int(os.environ.get("DASHBOARD_PORT", "8200"))
    uvicorn.run(create_app(), host="0.0.0.0", port=port)
