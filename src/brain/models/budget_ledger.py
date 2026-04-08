"""SQLAlchemy model for per-LLM-call cost ledger entries (§36.4)."""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base


class BudgetLedger(Base):
    __tablename__ = "budget_ledger"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    agent_id: Mapped[str] = mapped_column(String(100), nullable=False)
    division: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    model: Mapped[str] = mapped_column(String(200), nullable=False)
    provider: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    task_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    thread_id: Mapped[str] = mapped_column(Text(), nullable=False, default="")
    input_tokens: Mapped[int] = mapped_column(nullable=False, default=0)
    output_tokens: Mapped[int] = mapped_column(nullable=False, default=0)
    cost_usd: Mapped[float] = mapped_column(Numeric(12, 8), nullable=False, default=0.0)
    routed_from: Mapped[str | None] = mapped_column(String(200), nullable=True)
    primary_cost_usd: Mapped[float | None] = mapped_column(Numeric(12, 8), nullable=True)
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
