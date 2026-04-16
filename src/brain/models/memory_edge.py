"""SQLAlchemy model for memory_edges table (§36)."""
from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import DateTime, Float, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base


class EdgeType(str, enum.Enum):
    supports = "supports"
    contradicts = "contradicts"
    evolved_into = "evolved_into"
    depends_on = "depends_on"
    related_to = "related_to"


class MemoryEdge(Base):
    """Directed typed edge between two memory facts (§36.2)."""

    __tablename__ = "memory_edges"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    source_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    target_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    edge_type: Mapped[str] = mapped_column(String(30), nullable=False)
    confidence: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    agent_id: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    traversed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    def __init__(self, **kwargs: object) -> None:
        kwargs.setdefault("confidence", 1.0)
        super().__init__(**kwargs)
