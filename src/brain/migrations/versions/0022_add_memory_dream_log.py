"""Add memory_dream_log table for per-agent dream tracking.

Revision ID: 0022
Revises: 0021
Create Date: 2026-04-09 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0022"
down_revision: Union[str, None] = "0021"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "memory_dream_log",
        sa.Column("agent_id", sa.String(100), primary_key=True),
        sa.Column("last_dream_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("threads_since_dream", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("dream_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            onupdate=sa.text("now()"),
        ),
    )


def downgrade() -> None:
    op.drop_table("memory_dream_log")
