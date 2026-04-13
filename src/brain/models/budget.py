"""SQLAlchemy model for per-agent token/cost budget tracking."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base


class Budget(Base):
    __tablename__ = "budgets"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    agent_id: Mapped[str] = mapped_column(String(100), nullable=False, unique=True, index=True)
    org_id: Mapped[str] = mapped_column(String(64), nullable=False, server_default="default", index=True)
    division: Mapped[str] = mapped_column(String(100), nullable=False)

    daily_usd_used: Mapped[float] = mapped_column(default=0.0)
    daily_usd_limit: Mapped[float | None] = mapped_column(nullable=True)
    daily_reset_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    monthly_usd_used: Mapped[float] = mapped_column(default=0.0)
    monthly_usd_limit: Mapped[float | None] = mapped_column(nullable=True)
    monthly_reset_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    total_usd_used: Mapped[float] = mapped_column(default=0.0)
    total_usd_limit: Mapped[float | None] = mapped_column(nullable=True)

    last_updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
