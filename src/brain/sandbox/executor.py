"""nsjail-based SandboxExecutor (Linux only).

Spec: tool-execution-sandboxing §1.4, §1.8
"""
from __future__ import annotations

import asyncio
import logging
import shutil
import tempfile
from pathlib import Path

from .config import SandboxConfig
from .result import SandboxResult

log = logging.getLogger(__name__)

_NSJAIL_BIN = "/usr/local/bin/nsjail"


def nsjail_available() -> bool:
    """Return True when nsjail binary is present and executable."""
    return shutil.which(_NSJAIL_BIN) is not None or shutil.which("nsjail") is not None


def _nsjail_path() -> str:
    return shutil.which(_NSJAIL_BIN) or shutil.which("nsjail") or _NSJAIL_BIN


def _build_nsjail_args(
    command: list[str],
    workspace_path: Path | None,
    scratch_path: Path | None,
    cfg: SandboxConfig,
    env: dict[str, str] | None,
) -> list[str]:
    """Build the nsjail command-line argument list."""
    args = [
        _nsjail_path(),
        "--mode", "o",  # once — run one command and exit
        "--time_limit", str(cfg.cpu_seconds),
        "--rlimit_as", str(cfg.memory_mb),
        "--max_cpus", "1",
        "--log_fd", "3",  # send nsjail logs to fd 3 (not stdout/stderr)
    ]

    # PID limit
    args += ["--rlimit_nproc", str(cfg.max_pids)]

    # Filesystem mounts
    # Read-only system dirs
    for sys_dir in ("/usr", "/lib", "/lib64", "/bin", "/sbin"):
        if Path(sys_dir).exists():
            args += ["--bindmount_ro", sys_dir]

    # Workspace (read-only)
    if workspace_path and workspace_path.exists():
        args += ["--bindmount_ro", f"{workspace_path}:/workspace:ro"]
        args += ["--cwd", "/workspace"]

    # Scratch dir (read-write)
    if scratch_path and scratch_path.exists():
        args += ["--bindmount", f"{scratch_path}:/scratch"]

    # Extra allowed paths
    for p in cfg.allow_paths:
        if Path(p).exists():
            args += ["--bindmount_ro", p]

    # tmpfs for temp files
    args += ["--tmpfsmount", f"/tmp"]
    args += ["--tmpfs_size", str(cfg.tmpfs_mb * 1024 * 1024)]

    # Network
    if not cfg.network:
        args += ["--iface_no_lo"]

    # Environment
    if env:
        for k, v in env.items():
            args += ["--env", f"{k}={v}"]

    args += ["--"] + command
    return args


class SandboxExecutor:
    """Execute commands inside an nsjail namespace."""

    async def run(
        self,
        command: list[str] | str,
        workspace_path: Path | None = None,
        scratch_path: Path | None = None,
        env: dict[str, str] | None = None,
        config: SandboxConfig | None = None,
        permissions: list[str] | None = None,
    ) -> SandboxResult:
        cfg = config or SandboxConfig()

        if isinstance(command, str):
            cmd_list = ["sh", "-c", command]
        else:
            cmd_list = list(command)

        nsjail_args = _build_nsjail_args(cmd_list, workspace_path, scratch_path, cfg, env)

        try:
            proc = await asyncio.create_subprocess_exec(
                *nsjail_args,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                pass_fds=(3,) if False else (),  # fd 3 not available here; logged to stderr
            )
        except FileNotFoundError:
            log.error("sandbox: nsjail binary not found at %s", _nsjail_path())
            from .fallback import FallbackExecutor
            return await FallbackExecutor().run(command, workspace_path, scratch_path, env, cfg)

        timeout = cfg.cpu_seconds + 10
        killed_by: str | None = None
        try:
            stdout_b, stderr_b = await asyncio.wait_for(proc.communicate(), timeout=timeout)
            exit_code = proc.returncode or 0
        except asyncio.TimeoutError:
            proc.kill()
            stdout_b, stderr_b = b"", b"[killed: timeout]"
            exit_code = -1
            killed_by = "timeout"

        # nsjail signals OOM and seccomp via exit code patterns or stderr markers
        stderr_str = stderr_b.decode("utf-8", errors="replace")
        if killed_by is None:
            if "oom" in stderr_str.lower() or exit_code == 137:
                killed_by = "oom"
            elif "seccomp" in stderr_str.lower():
                killed_by = "seccomp"

        return SandboxResult(
            stdout=stdout_b.decode("utf-8", errors="replace"),
            stderr=stderr_str,
            exit_code=exit_code,
            sandbox_active=True,
            killed_by=killed_by,
        )
