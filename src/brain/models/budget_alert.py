"""SQLAlchemy model for budget alert configuration (§36.5)."""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Numeric, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base


class BudgetAlert(Base):
    __tablename__ = "budget_alerts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    agent_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    division: Mapped[str | None] = mapped_column(String(100), nullable=True)
    threshold_pct: Mapped[float] = mapped_column(Numeric(5, 2), nullable=False)
    window: Mapped[str] = mapped_column(String(50), nullable=False, default="month")
    channels: Mapped[dict | None] = mapped_column(JSONB(), nullable=True)
    last_fired_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
