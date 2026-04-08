"""SQLAlchemy model for the memories table (pgvector-backed)."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Float, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base


class Memory(Base):
    __tablename__ = "memories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    agent_id: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    # Embedding stored as TEXT in ORM layer; actual DB column is vector(1536).
    # Use raw SQL / pgvector helpers (pgvector-python) for similarity queries.
    embedding: Mapped[str | None] = mapped_column(Text, nullable=True)
    source: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    metadata_: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    # Organisational memory columns (migration 0008)
    scope: Mapped[str] = mapped_column(String(20), nullable=False, default="personal", index=True)
    owner_id: Mapped[str] = mapped_column(String(100), nullable=False, default="", index=True)
    confidence: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    source_agent: Mapped[str | None] = mapped_column(String(100), nullable=True)
    source_thread: Mapped[str | None] = mapped_column(String(100), nullable=True)
    access_tier: Mapped[int] = mapped_column(Integer, nullable=False, default=4)
    promoted_from: Mapped[int | None] = mapped_column(Integer, nullable=True)
    approved_by: Mapped[str | None] = mapped_column(String(100), nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    retrieval_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
