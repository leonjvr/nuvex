"""SQLAlchemy model for governance audit trail (SHA-256 chained)."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base


class GovernanceAudit(Base):
    __tablename__ = "governance_audit"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    agent_id: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    invocation_id: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    thread_id: Mapped[str] = mapped_column(String(200), nullable=False)
    action: Mapped[str] = mapped_column(Text, nullable=False)
    tool_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    decision: Mapped[str] = mapped_column(String(20), nullable=False)  # approved | denied
    stage: Mapped[str] = mapped_column(String(50), nullable=False)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    sha256_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    prev_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    cost_usd: Mapped[float] = mapped_column(default=0.0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
