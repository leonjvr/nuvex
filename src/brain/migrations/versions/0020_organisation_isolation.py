"""Organisation isolation — add organisations table, org_id columns, work_packets, channel_bindings.

Revision ID: 0020
Revises: 0019
Create Date: 2026-04-09 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0020"
down_revision: Union[str, None] = "0019"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# All agent-scoped tables that need org_id (excluding agents — done separately)
_ORG_TABLES = [
    "threads",
    "messages",
    "budgets",
    "tasks",
    "governance_audit",
    "cron_entries",
    "events",
    "agent_lifecycle",
    "memories",
    "actions_queue",
]


def upgrade() -> None:
    # 1. Create organisations table
    op.create_table(
        "organisations",
        sa.Column("org_id", sa.String(64), primary_key=True),
        sa.Column("name", sa.Text, nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="active"),
        sa.Column("config", postgresql.JSONB(), nullable=True),
        sa.Column("policies", postgresql.JSONB(), nullable=True),
        sa.Column("communication_links", postgresql.JSONB(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_organisations_status", "organisations", ["status"])

    # 2. Add nullable org_id to agents first (so FK can be added later)
    op.add_column("agents", sa.Column("org_id", sa.String(64), nullable=True))

    # 3. Add nullable org_id to all agent-scoped tables
    for tbl in _ORG_TABLES:
        try:
            op.add_column(tbl, sa.Column("org_id", sa.String(64), nullable=True))
        except Exception:
            pass  # column may not exist yet if table was created later

    # 4. Data migration — create default org, assign all existing rows
    op.execute("INSERT INTO organisations (org_id, name, status) VALUES ('default', 'Default Organisation', 'active') ON CONFLICT DO NOTHING")
    op.execute("UPDATE agents SET org_id = 'default' WHERE org_id IS NULL")
    for tbl in _ORG_TABLES:
        try:
            op.execute(f"UPDATE {tbl} SET org_id = 'default' WHERE org_id IS NULL")
        except Exception:
            pass

    # 5. Set NOT NULL + FK on agents
    op.alter_column("agents", "org_id", nullable=False)
    op.create_foreign_key(
        "fk_agents_org_id", "agents", "organisations", ["org_id"], ["org_id"]
    )
    op.create_unique_constraint("uq_agents_org_agent", "agents", ["org_id", "id"])

    # 6. Set NOT NULL on agent-scoped tables (best-effort — table may not exist)
    for tbl in _ORG_TABLES:
        try:
            op.alter_column(tbl, "org_id", nullable=False)
            op.create_index(f"ix_{tbl}_org_id", tbl, ["org_id"])
        except Exception:
            pass

    # 7. Create work_packets table
    op.create_table(
        "work_packets",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("source_org_id", sa.String(64), sa.ForeignKey("organisations.org_id"), nullable=False),
        sa.Column("target_org_id", sa.String(64), sa.ForeignKey("organisations.org_id"), nullable=False),
        sa.Column("packet_type", sa.String(100), nullable=False),
        sa.Column("payload", postgresql.JSONB(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("mode", sa.String(10), nullable=False, server_default="async"),
        sa.Column("result", postgresql.JSONB(), nullable=True),
        sa.Column("error", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_work_packets_source_org", "work_packets", ["source_org_id"])
    op.create_index("ix_work_packets_target_org", "work_packets", ["target_org_id"])
    op.create_index("ix_work_packets_status", "work_packets", ["status"])

    # 8. Create channel_bindings table
    op.create_table(
        "channel_bindings",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("org_id", sa.String(64), sa.ForeignKey("organisations.org_id"), nullable=False),
        sa.Column("channel_type", sa.String(50), nullable=False),
        sa.Column("channel_identity", sa.String(200), nullable=False),
        sa.Column("config", postgresql.JSONB(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_unique_constraint(
        "uq_channel_bindings_type_identity",
        "channel_bindings",
        ["channel_type", "channel_identity"],
    )
    op.create_index("ix_channel_bindings_org_id", "channel_bindings", ["org_id"])


def downgrade() -> None:
    op.drop_table("channel_bindings")
    op.drop_table("work_packets")

    for tbl in _ORG_TABLES:
        try:
            op.drop_column(tbl, "org_id")
        except Exception:
            pass

    op.drop_constraint("uq_agents_org_agent", "agents", type_="unique")
    op.drop_constraint("fk_agents_org_id", "agents", type_="foreignkey")
    op.drop_column("agents", "org_id")

    op.drop_index("ix_organisations_status", "organisations")
    op.drop_table("organisations")
