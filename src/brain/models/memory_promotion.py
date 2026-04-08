"""SQLAlchemy model for the memory_promotions table."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base


class MemoryPromotion(Base):
    __tablename__ = "memory_promotions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    source_memory_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    target_scope: Mapped[str] = mapped_column(String(20), nullable=False)
    requested_by: Mapped[str] = mapped_column(String(100), nullable=False)
    requested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    approved_by: Mapped[str | None] = mapped_column(String(100), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
