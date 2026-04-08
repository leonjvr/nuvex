"""Initial schema — all NUVEX tables.

Revision ID: 0001
Revises:
Create Date: 2025-01-01 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "agents",
        sa.Column("id", sa.String(100), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("tier", sa.String(20), nullable=False),
        sa.Column("division", sa.String(100), nullable=False),
        sa.Column("workspace_path", sa.String(500), nullable=True),
        sa.Column("config_snapshot", postgresql.JSONB(), nullable=True),
        sa.Column("lifecycle_state", sa.String(20), nullable=False, server_default="idle"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_agents_division", "agents", ["division"])

    op.create_table(
        "threads",
        sa.Column("id", sa.String(200), primary_key=True),
        sa.Column("agent_id", sa.String(100), sa.ForeignKey("agents.id"), nullable=False),
        sa.Column("channel", sa.String(50), nullable=False),
        sa.Column("participants", postgresql.JSONB(), nullable=True),
        sa.Column("message_count", sa.Integer(), server_default="0"),
        sa.Column("last_compacted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_threads_agent_id", "threads", ["agent_id"])

    op.create_table(
        "messages",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("thread_id", sa.String(200), sa.ForeignKey("threads.id"), nullable=False),
        sa.Column("role", sa.String(20), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("metadata_", postgresql.JSONB(), nullable=True),
        sa.Column("tokens", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_messages_thread_id", "messages", ["thread_id"])
    op.create_index("ix_messages_created_at", "messages", ["created_at"])

    op.create_table(
        "governance_audit",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("agent_id", sa.String(100), nullable=False),
        sa.Column("invocation_id", sa.String(100), nullable=False),
        sa.Column("thread_id", sa.String(200), nullable=False),
        sa.Column("action", sa.Text(), nullable=False),
        sa.Column("tool_name", sa.String(200), nullable=True),
        sa.Column("decision", sa.String(20), nullable=False),
        sa.Column("stage", sa.String(50), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("sha256_hash", sa.String(64), nullable=False),
        sa.Column("prev_hash", sa.String(64), nullable=True),
        sa.Column("cost_usd", sa.Float(), server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_gov_agent_id", "governance_audit", ["agent_id"])
    op.create_index("ix_gov_invocation_id", "governance_audit", ["invocation_id"])
    op.create_index("ix_gov_created_at", "governance_audit", ["created_at"])

    op.create_table(
        "budgets",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("agent_id", sa.String(100), nullable=False),
        sa.Column("division", sa.String(100), nullable=False),
        sa.Column("daily_usd_used", sa.Float(), server_default="0"),
        sa.Column("daily_usd_limit", sa.Float(), nullable=True),
        sa.Column("daily_reset_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("monthly_usd_used", sa.Float(), server_default="0"),
        sa.Column("monthly_usd_limit", sa.Float(), nullable=True),
        sa.Column("monthly_reset_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("total_usd_used", sa.Float(), server_default="0"),
        sa.Column("total_usd_limit", sa.Float(), nullable=True),
        sa.Column("last_updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("agent_id"),
    )
    op.create_index("ix_budgets_agent_id", "budgets", ["agent_id"])

    op.create_table(
        "events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("lane", sa.String(100), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("failure_class", sa.String(50), nullable=True),
        sa.Column("agent_id", sa.String(100), nullable=True),
        sa.Column("invocation_id", sa.String(100), nullable=True),
        sa.Column("payload", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("retry_count", sa.Integer(), server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_events_lane", "events", ["lane"])
    op.create_index("ix_events_status", "events", ["status"])
    op.create_index("ix_events_agent_id", "events", ["agent_id"])
    op.create_index("ix_events_created_at", "events", ["created_at"])

    op.create_table(
        "tasks",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("parent_task_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("assigned_agent", sa.String(100), nullable=False),
        sa.Column("priority", sa.Integer(), server_default="5"),
        sa.Column("acceptance_criteria", postgresql.JSONB(), server_default="[]"),
        sa.Column("verification_level", sa.String(20), server_default="auto"),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("result", postgresql.JSONB(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_tasks_assigned_agent", "tasks", ["assigned_agent"])
    op.create_index("ix_tasks_status", "tasks", ["status"])
    op.create_index("ix_tasks_created_at", "tasks", ["created_at"])

    op.create_table(
        "cron_entries",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("agent_id", sa.String(100), nullable=False),
        sa.Column("schedule", sa.String(100), nullable=False),
        sa.Column("task_payload", postgresql.JSONB(), server_default="{}"),
        sa.Column("enabled", sa.Boolean(), server_default="true"),
        sa.Column("last_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("next_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("name"),
    )
    op.create_index("ix_cron_agent_id", "cron_entries", ["agent_id"])

    op.create_table(
        "service_health",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("service", sa.String(100), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("latency_ms", sa.Float(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("checked_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("service"),
    )

    op.create_table(
        "recovery_log",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("agent_id", sa.String(100), nullable=False),
        sa.Column("thread_id", sa.String(200), nullable=False),
        sa.Column("trigger", sa.String(100), nullable=False),
        sa.Column("strategy", sa.String(50), nullable=False),
        sa.Column("outcome", sa.String(20), nullable=False),
        sa.Column("details", postgresql.JSONB(), server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_recovery_agent_id", "recovery_log", ["agent_id"])
    op.create_index("ix_recovery_created_at", "recovery_log", ["created_at"])


def downgrade() -> None:
    op.drop_table("recovery_log")
    op.drop_table("service_health")
    op.drop_table("cron_entries")
    op.drop_table("tasks")
    op.drop_table("events")
    op.drop_table("budgets")
    op.drop_table("governance_audit")
    op.drop_table("messages")
    op.drop_table("threads")
    op.drop_table("agents")
