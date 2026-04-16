"""SQLAlchemy model for organisations table."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base

# Valid status transitions: active → suspended → archived
VALID_TRANSITIONS: dict[str, set[str]] = {
    "active": {"suspended"},
    "suspended": {"archived", "active"},
    "archived": set(),
}


class Organisation(Base):
    __tablename__ = "organisations"

    org_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, server_default="active")
    config: Mapped[dict] = mapped_column(JSONB, default=dict)
    policies: Mapped[dict] = mapped_column(JSONB, default=dict)
    communication_links: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    def can_transition_to(self, new_status: str) -> bool:
        """Return True if the status transition is allowed."""
        return new_status in VALID_TRANSITIONS.get(self.status, set())
