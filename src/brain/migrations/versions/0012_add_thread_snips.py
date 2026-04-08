"""Migration: create thread_snips table for snip compaction mode (§31).

Revision ID: 0012
Revises: 0011
Create Date: 2026-04-08

Creates:
  - thread_snips table with vector(1536) embedding column (requires pgvector)
"""
from alembic import op
import sqlalchemy as sa

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "thread_snips",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("thread_id", sa.Text(), nullable=False),
        sa.Column("agent_id", sa.Text(), nullable=False),
        sa.Column("turn_index", sa.Integer(), nullable=False),
        sa.Column("role", sa.Text(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("token_count", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    # Add embedding column via DDL — pgvector must already be enabled (0005)
    op.execute("ALTER TABLE thread_snips ADD COLUMN IF NOT EXISTS embedding vector(1536)")
    op.create_index("ix_thread_snips_thread_id", "thread_snips", ["thread_id"])


def downgrade() -> None:
    op.drop_table("thread_snips")
