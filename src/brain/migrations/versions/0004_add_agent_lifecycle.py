"""Migration: create agent_lifecycle table.

Revision ID: 0004
Revises: 0003
Create Date: 2026-04-05
"""
from alembic import op
import sqlalchemy as sa

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "agent_lifecycle",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("agent_id", sa.String(100), nullable=False),
        sa.Column("from_state", sa.String(50), nullable=True),
        sa.Column("to_state", sa.String(50), nullable=False),
        sa.Column("invocation_id", sa.String(100), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_agent_lifecycle_agent_id", "agent_lifecycle", ["agent_id"])
    op.create_index("ix_agent_lifecycle_invocation_id", "agent_lifecycle", ["invocation_id"])
    op.create_index("ix_agent_lifecycle_created_at", "agent_lifecycle", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_agent_lifecycle_created_at", "agent_lifecycle")
    op.drop_index("ix_agent_lifecycle_invocation_id", "agent_lifecycle")
    op.drop_index("ix_agent_lifecycle_agent_id", "agent_lifecycle")
    op.drop_table("agent_lifecycle")
