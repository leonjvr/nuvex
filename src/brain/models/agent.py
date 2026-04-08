"""SQLAlchemy model for agents table."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base


class Agent(Base):
    __tablename__ = "agents"

    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    tier: Mapped[str] = mapped_column(String(10), default="T1")
    division: Mapped[str] = mapped_column(String(100), default="default")
    workspace_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    config_snapshot: Mapped[dict] = mapped_column(JSONB, default=dict)
    lifecycle_state: Mapped[str] = mapped_column(String(30), default="ready")
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_error_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
