"""SQLAlchemy model for agent_plugin_config table.

Separate from AgentSkillConfig — plugin config is for installed plugin packages,
skill config is for legacy skill directories.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, LargeBinary, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base


class AgentPluginConfig(Base):
    __tablename__ = "agent_plugin_config"
    __table_args__ = (
        UniqueConstraint("agent_id", "plugin_id", name="uq_agent_plugin"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    agent_id: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    plugin_id: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    plugin_type: Mapped[str] = mapped_column(String(50), nullable=False, server_default="plugin")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    env_encrypted: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    config_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
