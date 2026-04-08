"""SQLAlchemy model for thread snips (§31 snip compaction)."""
from __future__ import annotations

import uuid as _uuid
from datetime import datetime

from sqlalchemy import DateTime, Integer, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base


class ThreadSnip(Base):
    __tablename__ = "thread_snips"

    id: Mapped[_uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=_uuid.uuid4
    )
    thread_id: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    agent_id: Mapped[str] = mapped_column(Text, nullable=False)
    turn_index: Mapped[int] = mapped_column(Integer, nullable=False)
    role: Mapped[str] = mapped_column(Text, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    token_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # embedding stored as Text for DB compat; actual vector ops use raw SQL
    embedding: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
