"""Migration: create memory_promotions table and add memory.promotion_pending event lane.

Revision ID: 0009
Revises: 0008
Create Date: 2026-04-08

Creates memory_promotions table for cross-scope promotion workflow (Section 28.5).
"""
from alembic import op
import sqlalchemy as sa

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "memory_promotions",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("source_memory_id", sa.Integer(), nullable=False, index=True),
        sa.Column("target_scope", sa.String(20), nullable=False),
        sa.Column("requested_by", sa.String(100), nullable=False),
        sa.Column(
            "requested_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("approved_by", sa.String(100), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
    )
    op.create_index(
        "ix_memory_promotions_status", "memory_promotions", ["status"]
    )


def downgrade() -> None:
    op.drop_index("ix_memory_promotions_status", "memory_promotions")
    op.drop_table("memory_promotions")
