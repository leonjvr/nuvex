"""SQLAlchemy model for channel_bindings with optional agent scoping."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base


class ChannelBinding(Base):
    __tablename__ = "channel_bindings"
    __table_args__ = (
        UniqueConstraint("channel_type", "channel_identity", name="uq_channel_bindings_type_identity"),
        UniqueConstraint("org_id", "agent_id", "channel_type", name="uq_channel_bindings_org_agent_channel"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    org_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("organisations.org_id"), nullable=False, index=True
    )
    agent_id: Mapped[str | None] = mapped_column(
        String(100), ForeignKey("agents.id"), nullable=True, index=True
    )
    channel_type: Mapped[str] = mapped_column(String(50), nullable=False)
    channel_identity: Mapped[str] = mapped_column(String(200), nullable=False)
    config: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
