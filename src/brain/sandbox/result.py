"""SandboxResult model (tool-execution-sandboxing §1.11)."""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class SandboxResult:
    """Result of a sandboxed process execution."""

    stdout: str
    stderr: str
    exit_code: int
    sandbox_active: bool
    cpu_ms: int = 0
    memory_peak_mb: float = 0.0
    network_bytes_out: int = 0
    killed_by: str | None = None  # "timeout" | "oom" | "seccomp" | None
