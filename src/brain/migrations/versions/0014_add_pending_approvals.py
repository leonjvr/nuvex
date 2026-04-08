"""Migration: add pending_approvals table (§10).

Revision ID: 0014
Revises: 0013
Create Date: 2026-04-08
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "pending_approvals",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("agent_id", sa.String(100), nullable=False),
        sa.Column("thread_id", sa.Text(), nullable=False),
        sa.Column("tool_name", sa.String(200), nullable=False),
        sa.Column("tool_input", postgresql.JSONB(), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_by", sa.String(100), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_pending_approvals_agent_id",
        "pending_approvals",
        ["agent_id"],
    )
    op.create_index(
        "ix_pending_approvals_status",
        "pending_approvals",
        ["status"],
    )


def downgrade() -> None:
    op.drop_index("ix_pending_approvals_status", table_name="pending_approvals")
    op.drop_index("ix_pending_approvals_agent_id", table_name="pending_approvals")
    op.drop_table("pending_approvals")
