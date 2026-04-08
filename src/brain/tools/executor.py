"""Scratch directory management for per-thread tool execution (§35)."""
from __future__ import annotations

import logging
import shutil
from pathlib import Path

log = logging.getLogger(__name__)

_THREADS_ROOT = Path("data") / "threads"


def get_scratch_dir(thread_id: str) -> Path:
    """Return the absolute scratch directory path for a thread."""
    return (_THREADS_ROOT / thread_id / "scratch").resolve()


def ensure_scratch_dir(thread_id: str) -> Path:
    """Create the scratch directory if it does not exist and return its absolute path."""
    scratch = get_scratch_dir(thread_id)
    scratch.mkdir(parents=True, exist_ok=True)
    return scratch


def scratch_dir_size_mb(scratch: Path) -> float:
    """Return total size of the scratch directory in megabytes."""
    if not scratch.exists():
        return 0.0
    total = sum(f.stat().st_size for f in scratch.rglob("*") if f.is_file())
    return total / (1024 * 1024)


def check_scratch_quota(thread_id: str, quota_mb: int) -> tuple[bool, str | None]:
    """Return (ok, error_msg) where ok=True when within quota.

    Always returns (True, None) when quota_mb <= 0 (unlimited).
    """
    if quota_mb <= 0:
        return True, None
    scratch = get_scratch_dir(thread_id)
    if not scratch.exists():
        return True, None
    used = scratch_dir_size_mb(scratch)
    if used >= quota_mb:
        return False, f"Scratch quota exceeded: {used:.1f} MB used of {quota_mb} MB limit"
    return True, None


def cleanup_scratch_dir(thread_id: str) -> None:
    """Delete the scratch directory for a thread (called on archive/termination)."""
    scratch = get_scratch_dir(thread_id)
    if scratch.exists():
        try:
            shutil.rmtree(scratch)
            log.debug("scratch: deleted %s", scratch)
        except OSError as exc:
            log.warning("scratch: could not delete %s: %s", scratch, exc)
