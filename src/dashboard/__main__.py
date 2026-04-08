"""Dashboard service entrypoint."""
from __future__ import annotations

import os
import uvicorn

from .server import create_app

if __name__ == "__main__":
    port = int(os.environ.get("DASHBOARD_PORT", "8200"))
    uvicorn.run(create_app(), host="0.0.0.0", port=port)
