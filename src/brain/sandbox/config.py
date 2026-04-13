"""Sandbox config model (tool-execution-sandboxing §1.3)."""
from __future__ import annotations

from pydantic import BaseModel, Field, field_validator


class SandboxConfig(BaseModel):
    """Resource limits and permissions for a sandboxed tool execution."""

    cpu_seconds: int = Field(default=30, ge=1)
    memory_mb: int = Field(default=256, ge=1)
    max_pids: int = Field(default=32, ge=1)
    network: bool = False
    allow_paths: list[str] = Field(default_factory=list)
    tmpfs_mb: int = Field(default=50, ge=1)

    @field_validator("cpu_seconds", "memory_mb", "max_pids", "tmpfs_mb", mode="before")
    @classmethod
    def _positive(cls, v: int) -> int:
        if v < 1:
            raise ValueError(f"Value must be >= 1, got {v}")
        return v
