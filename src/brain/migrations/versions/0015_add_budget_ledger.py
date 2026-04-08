"""Migration: add budget_ledger and budget_alerts tables (§36).

Revision ID: 0015
Revises: 0014
Create Date: 2026-04-08
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "budget_ledger",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("agent_id", sa.String(100), nullable=False),
        sa.Column("division", sa.String(100), nullable=False, server_default=""),
        sa.Column("model", sa.String(200), nullable=False),
        sa.Column("provider", sa.String(100), nullable=False, server_default=""),
        sa.Column("task_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("thread_id", sa.Text(), nullable=False, server_default=""),
        sa.Column("input_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("output_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("cost_usd", sa.Numeric(12, 8), nullable=False, server_default="0"),
        sa.Column("routed_from", sa.String(200), nullable=True),
        sa.Column("primary_cost_usd", sa.Numeric(12, 8), nullable=True),
        sa.Column(
            "timestamp",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_budget_ledger_agent_timestamp",
        "budget_ledger",
        ["agent_id", "timestamp"],
    )
    op.create_index(
        "ix_budget_ledger_division_timestamp",
        "budget_ledger",
        ["division", "timestamp"],
    )

    op.create_table(
        "budget_alerts",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("agent_id", sa.String(100), nullable=True),
        sa.Column("division", sa.String(100), nullable=True),
        sa.Column("threshold_pct", sa.Numeric(5, 2), nullable=False),
        sa.Column("window", sa.String(50), nullable=False, server_default="month"),
        sa.Column("channels", postgresql.JSONB(), nullable=True),
        sa.Column("last_fired_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_index("ix_budget_ledger_division_timestamp", table_name="budget_ledger")
    op.drop_index("ix_budget_ledger_agent_timestamp", table_name="budget_ledger")
    op.drop_table("budget_ledger")
    op.drop_table("budget_alerts")
