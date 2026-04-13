"""Migration: add plugin_registry and agent_plugin_config tables (§4).

Revision ID: 0019
Revises: 0018
Create Date: 2026-04-09
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "0019"
down_revision = "0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "plugin_registry",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("plugin_id", sa.String(200), nullable=False, unique=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("version", sa.String(50), nullable=False),
        sa.Column("source", sa.String(500), nullable=True),
        sa.Column("trust_tier", sa.String(50), nullable=False, server_default="community"),
        sa.Column("permissions", JSONB, nullable=True),
        sa.Column("manifest_hash", sa.Text(), nullable=True),
        sa.Column(
            "installed_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index("ix_plugin_registry_plugin_id", "plugin_registry", ["plugin_id"])

    op.create_table(
        "agent_plugin_config",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("agent_id", sa.String(100), nullable=False),
        sa.Column("plugin_id", sa.String(200), nullable=False),
        sa.Column("plugin_type", sa.String(50), nullable=False, server_default="plugin"),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("env_encrypted", sa.LargeBinary(), nullable=True),
        sa.Column("config_json", JSONB, nullable=True),
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
        sa.UniqueConstraint("agent_id", "plugin_id", name="uq_agent_plugin"),
    )
    op.create_index("ix_agent_plugin_config_agent_id", "agent_plugin_config", ["agent_id"])
    op.create_index("ix_agent_plugin_config_plugin_id", "agent_plugin_config", ["plugin_id"])


def downgrade() -> None:
    op.drop_index("ix_agent_plugin_config_plugin_id", "agent_plugin_config")
    op.drop_index("ix_agent_plugin_config_agent_id", "agent_plugin_config")
    op.drop_table("agent_plugin_config")
    op.drop_index("ix_plugin_registry_plugin_id", "plugin_registry")
    op.drop_table("plugin_registry")
