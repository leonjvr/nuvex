"""SQLAlchemy model for agent lifecycle transition events."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base


class AgentLifecycleEvent(Base):
    __tablename__ = "agent_lifecycle"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    agent_id: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    from_state: Mapped[str | None] = mapped_column(String(50), nullable=True)
    to_state: Mapped[str] = mapped_column(String(50), nullable=False)
    invocation_id: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    org_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True, server_default="default")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
