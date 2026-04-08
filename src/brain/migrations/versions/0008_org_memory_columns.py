"""Migration: add organisational memory columns to memories table.

Revision ID: 0008
Revises: 0007
Create Date: 2026-04-07

Adds columns required by Section 28 — Organisational Memory:
  scope, owner_id, confidence, source_agent, source_thread,
  access_tier, promoted_from, approved_by, expires_at, retrieval_count
"""
from alembic import op
import sqlalchemy as sa

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "memories",
        sa.Column("scope", sa.String(20), nullable=False, server_default="personal"),
    )
    op.add_column(
        "memories",
        sa.Column("owner_id", sa.String(100), nullable=False, server_default=""),
    )
    op.add_column(
        "memories",
        sa.Column("confidence", sa.Float(), nullable=False, server_default="1.0"),
    )
    op.add_column("memories", sa.Column("source_agent", sa.String(100), nullable=True))
    op.add_column("memories", sa.Column("source_thread", sa.String(100), nullable=True))
    op.add_column(
        "memories",
        sa.Column("access_tier", sa.Integer(), nullable=False, server_default="4"),
    )
    op.add_column(
        "memories",
        sa.Column("promoted_from", sa.Integer(), nullable=True),
    )
    op.add_column("memories", sa.Column("approved_by", sa.String(100), nullable=True))
    op.add_column(
        "memories",
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "memories",
        sa.Column("retrieval_count", sa.Integer(), nullable=False, server_default="0"),
    )

    # Backfill owner_id from agent_id for existing rows
    op.execute("UPDATE memories SET owner_id = agent_id WHERE owner_id = ''")

    op.create_index("ix_memories_scope", "memories", ["scope"])
    op.create_index("ix_memories_owner_id", "memories", ["owner_id"])
    op.create_index("ix_memories_confidence", "memories", ["confidence"])


def downgrade() -> None:
    op.drop_index("ix_memories_confidence", "memories")
    op.drop_index("ix_memories_owner_id", "memories")
    op.drop_index("ix_memories_scope", "memories")
    for col in [
        "retrieval_count",
        "expires_at",
        "approved_by",
        "promoted_from",
        "access_tier",
        "source_thread",
        "source_agent",
        "confidence",
        "owner_id",
        "scope",
    ]:
        op.drop_column("memories", col)
