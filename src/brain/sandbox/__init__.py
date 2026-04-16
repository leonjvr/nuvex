"""Sandbox package — per-execution isolation via nsjail (tool-execution-sandboxing §1).

Platform detection:
- Linux + nsjail available → exports SandboxExecutor (real isolation)
- Otherwise              → exports FallbackExecutor as SandboxExecutor (with warning)

Callers always import from this package:

    from src.brain.sandbox import SandboxExecutor, SandboxConfig, SandboxResult
"""
from __future__ import annotations

import logging
import platform

from .config import SandboxConfig
from .result import SandboxResult

log = logging.getLogger(__name__)

__all__ = ["SandboxExecutor", "SandboxConfig", "SandboxResult"]

# Platform detection (§1.10)
_on_linux = platform.system() == "Linux"

if _on_linux:
    try:
        from .executor import nsjail_available, SandboxExecutor as _NsjailExecutor

        if nsjail_available():
            SandboxExecutor = _NsjailExecutor
            log.debug("sandbox: nsjail detected — full isolation active")
        else:
            from .fallback import FallbackExecutor as SandboxExecutor  # type: ignore[misc]
            log.warning(
                "sandbox: running on Linux but nsjail not found — "
                "using FallbackExecutor (no isolation)"
            )
    except Exception as _err:
        from .fallback import FallbackExecutor as SandboxExecutor  # type: ignore[misc]
        log.warning("sandbox: executor import failed (%s) — using FallbackExecutor", _err)
else:
    from .fallback import FallbackExecutor as SandboxExecutor  # type: ignore[misc]
    log.debug("sandbox: non-Linux platform (%s) — using FallbackExecutor", platform.system())
