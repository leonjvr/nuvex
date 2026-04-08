"""Add actions_queue table.

Revision ID: 0002
Revises: 0001
Create Date: 2025-01-02 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "actions_queue",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("agent_id", sa.String(100), nullable=False),
        sa.Column("action_type", sa.String(100), nullable=False),
        sa.Column("target_channel", sa.String(50), nullable=False),
        sa.Column("payload", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_actions_queue_agent_id", "actions_queue", ["agent_id"])
    op.create_index("ix_actions_queue_status", "actions_queue", ["status"])
    op.create_index("ix_actions_queue_created_at", "actions_queue", ["created_at"])


def downgrade() -> None:
    op.drop_table("actions_queue")
