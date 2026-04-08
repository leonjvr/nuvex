"""Entry point: python -m src.brain"""
import logging
import os
import subprocess
import sys

import uvicorn

log = logging.getLogger(__name__)


def _run_migrations() -> None:
    """Run Alembic migrations synchronously before uvicorn starts."""
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        capture_output=True,
        text=True,
    )
    if result.stdout:
        print(result.stdout)
    if result.stderr:
        print(result.stderr, file=sys.stderr)
    if result.returncode != 0:
        print(f"[brain] Alembic migration failed (exit {result.returncode}) — aborting", file=sys.stderr)
        sys.exit(result.returncode)


if __name__ == "__main__":
    _run_migrations()
    uvicorn.run(
        "src.brain.server:app",
        host="0.0.0.0",
        port=int(os.environ.get("BRAIN_PORT", "8100")),
        reload=os.environ.get("DEV_RELOAD", "0") == "1",
        log_level=os.environ.get("LOG_LEVEL", "info").lower(),
    )
