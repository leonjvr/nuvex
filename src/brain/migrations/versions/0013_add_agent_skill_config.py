"""Migration: add agent_skill_config table.

Revision ID: 0013
Revises: 0012
Create Date: 2026-04-08
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "agent_skill_config",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("agent_id", sa.String(100), nullable=False),
        sa.Column("skill_name", sa.String(200), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("env_encrypted", sa.LargeBinary(), nullable=True),
        sa.Column("config_json", postgresql.JSONB(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("agent_id", "skill_name", name="uq_agent_skill"),
    )
    op.create_index(
        "ix_agent_skill_config_agent_id",
        "agent_skill_config",
        ["agent_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_agent_skill_config_agent_id", table_name="agent_skill_config")
    op.drop_table("agent_skill_config")
