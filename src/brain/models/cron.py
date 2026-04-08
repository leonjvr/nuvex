"""SQLAlchemy models for cron registry, service health, and recovery log."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base


class CronEntry(Base):
    __tablename__ = "cron_entries"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False, unique=True)
    agent_id: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    schedule: Mapped[str] = mapped_column(String(100), nullable=False)  # cron expression
    task_payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    next_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class ServiceHealth(Base):
    __tablename__ = "service_health"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    service: Mapped[str] = mapped_column(String(100), nullable=False, unique=True, index=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False)  # healthy | degraded | down
    latency_ms: Mapped[float | None] = mapped_column(nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    checked_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class RecoveryLog(Base):
    __tablename__ = "recovery_log"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    agent_id: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    thread_id: Mapped[str] = mapped_column(String(200), nullable=False)
    trigger: Mapped[str] = mapped_column(String(100), nullable=False)  # heartbeat | error | manual
    strategy: Mapped[str] = mapped_column(String(500), nullable=False)  # comma-separated recovery steps
    outcome: Mapped[str] = mapped_column(String(20), nullable=False)  # success | failed
    details: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
