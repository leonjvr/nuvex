"""SQLAlchemy model for contact_context table (per-agent learned facts about contacts)."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Float, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base


class ContactContext(Base):
    __tablename__ = "contact_context"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    agent_id: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    contact_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    key: Mapped[str] = mapped_column(String(200), nullable=False)
    value: Mapped[str] = mapped_column(Text, nullable=False)
    # Current confidence level (decays at decay_factor^days_since_referenced)
    confidence: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    decay_factor: Mapped[float] = mapped_column(Float, nullable=False, default=0.95)
    last_referenced: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
