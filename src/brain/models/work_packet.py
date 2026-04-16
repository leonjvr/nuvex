"""SQLAlchemy model for inter-org work packets."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base


class WorkPacket(Base):
    __tablename__ = "work_packets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    source_org_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("organisations.org_id"), nullable=False, index=True
    )
    target_org_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("organisations.org_id"), nullable=False, index=True
    )
    packet_type: Mapped[str] = mapped_column(String(100), nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default="pending", index=True
    )  # pending | processing | completed | failed | timeout
    mode: Mapped[str] = mapped_column(String(10), nullable=False, server_default="async")  # sync | async
    result: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
