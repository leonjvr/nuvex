"""SQLAlchemy model for managed LLM providers."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base


class LLMProvider(Base):
    __tablename__ = "llm_providers"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False, unique=True, index=True)
    provider: Mapped[str] = mapped_column(String(50), nullable=False)  # anthropic|openai|groq|deepseek|minimax|custom
    model: Mapped[str] = mapped_column(String(200), nullable=False)   # e.g. claude-sonnet-4-20250514
    api_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    base_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
