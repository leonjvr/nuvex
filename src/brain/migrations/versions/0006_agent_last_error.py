"""Add last_error/last_error_at to agents; add reason to agent_lifecycle.

Revision ID: 0006
Revises: 0005
Create Date: 2026-04-06
"""
from alembic import op
import sqlalchemy as sa

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("agents", sa.Column("last_error", sa.Text, nullable=True))
    op.add_column("agents", sa.Column("last_error_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("agent_lifecycle", sa.Column("reason", sa.Text, nullable=True))


def downgrade() -> None:
    op.drop_column("agents", "last_error")
    op.drop_column("agents", "last_error_at")
    op.drop_column("agent_lifecycle", "reason")
