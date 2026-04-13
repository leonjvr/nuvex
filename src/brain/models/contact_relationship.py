"""SQLAlchemy model for contact_relationships table."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base


class ContactRelationship(Base):
    __tablename__ = "contact_relationships"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    contact_id_a: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    contact_id_b: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    relationship_type: Mapped[str] = mapped_column(String(50), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_agent: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
