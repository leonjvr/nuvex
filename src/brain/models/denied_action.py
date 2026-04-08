"""DeniedAction — records a governance denial in session state (§32)."""
from __future__ import annotations

from datetime import datetime, timezone

from pydantic import BaseModel, Field


class DeniedAction(BaseModel):
    """A structured record of a tool call blocked by the governance pipeline."""

    tool_name: str
    reason: str
    governance_stage: str  # forbidden | approval | budget | classification | policy
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    invocation_id: str = ""
