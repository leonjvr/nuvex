"""FallbackExecutor — asyncio subprocess, used when nsjail is unavailable.

Spec: tool-execution-sandboxing §1.9
"""
from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path

from .config import SandboxConfig
from .result import SandboxResult

log = logging.getLogger(__name__)
_warned = False


class FallbackExecutor:
    """Executes commands via asyncio.create_subprocess_shell (no isolation).

    Logs a warning on the first call to alert operators that sandboxing
    is not active.
    """

    async def run(
        self,
        command: list[str] | str,
        workspace_path: Path | None = None,
        scratch_path: Path | None = None,
        env: dict[str, str] | None = None,
        config: SandboxConfig | None = None,
        permissions: list[str] | None = None,
    ) -> SandboxResult:
        global _warned
        if not _warned:
            log.warning(
                "sandbox: nsjail not available — running WITHOUT isolation (FallbackExecutor). "
                "Install nsjail inside the brain container to enable per-execution sandboxing."
            )
            _warned = True

        merged_env = {**os.environ}
        if env:
            merged_env.update(env)

        cwd = str(workspace_path) if workspace_path and workspace_path.exists() else None

        if isinstance(command, list):
            proc = await asyncio.create_subprocess_exec(
                *command,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=merged_env,
                cwd=cwd,
            )
        else:
            proc = await asyncio.create_subprocess_shell(
                command,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=merged_env,
                cwd=cwd,
            )

        timeout = (config.cpu_seconds if config else 30) + 5  # small grace period
        try:
            stdout_b, stderr_b = await asyncio.wait_for(proc.communicate(), timeout=timeout)
            exit_code = proc.returncode or 0
            killed_by = None
        except asyncio.TimeoutError:
            proc.kill()
            stdout_b, stderr_b = b"", b"[killed: timeout]"
            exit_code = -1
            killed_by = "timeout"

        return SandboxResult(
            stdout=stdout_b.decode("utf-8", errors="replace"),
            stderr=stderr_b.decode("utf-8", errors="replace"),
            exit_code=exit_code,
            sandbox_active=False,
            killed_by=killed_by,
        )
