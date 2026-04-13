"""SQLAlchemy models for contacts and contact_handles tables."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Float, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base


class Contact(Base):
    __tablename__ = "contacts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    org_id: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    display_name: Mapped[str] = mapped_column(String(200), nullable=False)
    # 0=T0(new), 1=T1(verified), 2=T2(trusted), 3=T3(privileged), 4=T4(owner)
    trust_tier: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # NULL | temp_ban | hard_ban | shadowban | under_review
    sanction: Mapped[str | None] = mapped_column(String(30), nullable=True)
    sanction_until: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    sanction_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    message_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_seen_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class ContactHandle(Base):
    __tablename__ = "contact_handles"
    __table_args__ = (
        UniqueConstraint("channel_type", "handle", name="uq_contact_handles_channel_handle"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    contact_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    channel_type: Mapped[str] = mapped_column(String(30), nullable=False)
    handle: Mapped[str] = mapped_column(String(200), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
