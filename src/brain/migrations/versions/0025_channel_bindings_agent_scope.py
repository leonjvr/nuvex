"""Alembic migration: add agent scope to channel bindings.

Revision ID: 0025
Revises: 0024
Create Date: 2026-04-16
"""

from alembic import op
import sqlalchemy as sa

revision = "0025"
down_revision = "0024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("channel_bindings", sa.Column("agent_id", sa.String(length=100), nullable=True))
    op.create_foreign_key(
        "fk_channel_bindings_agent_id_agents",
        "channel_bindings",
        "agents",
        ["agent_id"],
        ["id"],
    )
    op.create_index("ix_channel_bindings_agent_id", "channel_bindings", ["agent_id"])
    op.create_unique_constraint(
        "uq_channel_bindings_org_agent_channel",
        "channel_bindings",
        ["org_id", "agent_id", "channel_type"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_channel_bindings_org_agent_channel", "channel_bindings", type_="unique")
    op.drop_index("ix_channel_bindings_agent_id", table_name="channel_bindings")
    op.drop_constraint("fk_channel_bindings_agent_id_agents", "channel_bindings", type_="foreignkey")
    op.drop_column("channel_bindings", "agent_id")
