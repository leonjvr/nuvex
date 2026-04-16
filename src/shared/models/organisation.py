"""Pydantic models for Organisation — used across brain, gateways, and CLI."""
from __future__ import annotations

import re
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field, field_validator

_ORG_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]*[a-z0-9]$")

# Valid forward status transitions
_VALID_TRANSITIONS: dict[str, set[str]] = {
    "active": {"suspended"},
    "suspended": {"archived", "active"},
    "archived": set(),
}


class Organisation(BaseModel):
    org_id: str
    name: str
    status: str = "active"
    config: dict[str, Any] = Field(default_factory=dict)
    policies: dict[str, Any] = Field(default_factory=dict)
    communication_links: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime | None = None
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}

    @field_validator("config", "policies", "communication_links", mode="before")
    @classmethod
    def _coerce_none_to_dict(cls, v: Any) -> Any:
        """JSONB columns may be None in DB rows — coerce to empty dict."""
        return v if v is not None else {}


class OrganisationCreate(BaseModel):
    org_id: str = Field(..., max_length=64)
    name: str = Field(..., min_length=1)
    config: dict[str, Any] = Field(default_factory=dict)
    policies: dict[str, Any] = Field(default_factory=dict)
    communication_links: dict[str, Any] = Field(default_factory=dict)

    @field_validator("org_id")
    @classmethod
    def validate_org_id(cls, v: str) -> str:
        if len(v) < 2:
            raise ValueError("org_id must be at least 2 characters")
        if len(v) > 64:
            raise ValueError("org_id must be at most 64 characters")
        if not _ORG_ID_RE.match(v):
            raise ValueError(
                "org_id must be lowercase alphanumeric with hyphens, "
                "starting and ending with alphanumeric character"
            )
        return v


class OrganisationUpdate(BaseModel):
    name: str | None = None
    status: str | None = None
    config: dict[str, Any] | None = None
    policies: dict[str, Any] | None = None
    communication_links: dict[str, Any] | None = None

    @field_validator("status")
    @classmethod
    def validate_status(cls, v: str | None) -> str | None:
        if v is not None and v not in {"active", "suspended", "archived"}:
            raise ValueError(f"Invalid status: {v!r}")
        return v


def validate_status_transition(current: str, new: str) -> bool:
    """Return True if transitioning from current → new is allowed."""
    return new in _VALID_TRANSITIONS.get(current, set())
