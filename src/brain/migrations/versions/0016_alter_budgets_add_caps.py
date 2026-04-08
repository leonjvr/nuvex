"""Migration: add hard_cap_usd, warn_at_pct, period_start to budgets table (§36.3).

Revision ID: 0016
Revises: 0015
Create Date: 2026-04-08
"""
from alembic import op
import sqlalchemy as sa

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "budgets",
        sa.Column("hard_cap_usd", sa.Numeric(12, 8), nullable=True),
    )
    op.add_column(
        "budgets",
        sa.Column(
            "warn_at_pct",
            sa.Numeric(5, 2),
            nullable=False,
            server_default="80.0",
        ),
    )
    op.add_column(
        "budgets",
        sa.Column(
            "period_start",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )


def downgrade() -> None:
    op.drop_column("budgets", "period_start")
    op.drop_column("budgets", "warn_at_pct")
    op.drop_column("budgets", "hard_cap_usd")
