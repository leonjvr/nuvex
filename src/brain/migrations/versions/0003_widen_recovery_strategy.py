"""Widen recovery_log.strategy from VARCHAR(50) to VARCHAR(500).

Revision ID: 0003
Revises: 0002
Create Date: 2026-04-05
"""
from alembic import op
import sqlalchemy as sa

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "recovery_log",
        "strategy",
        existing_type=sa.String(50),
        type_=sa.String(500),
        existing_nullable=False,
    )


def downgrade() -> None:
    op.alter_column(
        "recovery_log",
        "strategy",
        existing_type=sa.String(500),
        type_=sa.String(50),
        existing_nullable=False,
    )
