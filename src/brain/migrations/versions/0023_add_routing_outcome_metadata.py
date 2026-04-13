"""Add routing outcome metadata columns for routing telemetry.

Revision ID: 0023
Revises: 0022
Create Date: 2026-04-10
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "0023"
down_revision = "0022"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "routing_outcomes",
        sa.Column("invocation_id", sa.String(length=100), nullable=True),
    )
    op.add_column(
        "routing_outcomes",
        sa.Column("route_metadata", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
    )
    op.create_index(
        "ix_routing_outcomes_invocation_id",
        "routing_outcomes",
        ["invocation_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_routing_outcomes_invocation_id", table_name="routing_outcomes")
    op.drop_column("routing_outcomes", "route_metadata")
    op.drop_column("routing_outcomes", "invocation_id")
