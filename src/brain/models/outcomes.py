"""SQLAlchemy models for outcome feedback loop and arousal state (Sections 29-30)."""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base


class Outcome(Base):
    __tablename__ = "outcomes"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    thread_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    agent_id: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    task_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    invocation_id: Mapped[str] = mapped_column(String(100), nullable=False)
    succeeded: Mapped[bool] = mapped_column(Boolean, nullable=False)
    user_confirmed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    cost_usd: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    duration_s: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    tools_used: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    denial_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    iteration_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error_class: Mapped[str | None] = mapped_column(String(50), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class MemoryRetrieval(Base):
    __tablename__ = "memory_retrievals"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    thread_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    memory_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    retrieved_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    cosine_score: Mapped[float | None] = mapped_column(Float, nullable=True)


class PolicyCandidate(Base):
    __tablename__ = "policy_candidates"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    agent_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    division_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    condition_tree: Mapped[dict] = mapped_column(JSONB, nullable=False)
    action: Mapped[str] = mapped_column(String(50), nullable=False)
    rationale: Mapped[str] = mapped_column(Text, nullable=False)
    source_threads: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="pending_review")
    reviewed_by: Mapped[str | None] = mapped_column(String(100), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class RoutingOutcome(Base):
    __tablename__ = "routing_outcomes"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    agent_id: Mapped[str] = mapped_column(String(100), nullable=False)
    task_type: Mapped[str] = mapped_column(String(50), nullable=False)
    model_name: Mapped[str] = mapped_column(String(100), nullable=False)
    succeeded: Mapped[bool] = mapped_column(Boolean, nullable=False)
    cost_usd: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    duration_s: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class ArousalState(Base):
    __tablename__ = "arousal_state"

    agent_id: Mapped[str] = mapped_column(String(100), primary_key=True)
    idle_seconds: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    pending_task_pressure: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    budget_burn_3day_avg: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    unread_channel_messages: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    recovery_event_count_24h: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_arousal_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    last_invocation_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
