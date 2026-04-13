"""Alembic migration: add desktop device orchestration tables.

Revision ID: 0024
Revises: 0023
Create Date: 2026-04-10
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "0024"
down_revision = "0023"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TYPE desktop_task_status AS ENUM (
            'queued', 'dispatched', 'waiting_idle', 'waiting_permission',
            'running', 'succeeded', 'failed', 'cancelled'
        )
    """)

    op.create_table(
        "desktop_devices",
        sa.Column("id", sa.String(100), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("platform", sa.String(50), nullable=False, server_default="windows"),
        sa.Column("owner", sa.String(100), nullable=True),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_connected", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )

    op.create_table(
        "desktop_device_tokens",
        sa.Column("id", sa.String(100), primary_key=True),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("device_id", sa.String(100), nullable=True),
        sa.Column("created_by", sa.String(100), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_desktop_device_tokens_hash", "desktop_device_tokens", ["token_hash"])

    op.create_table(
        "desktop_agent_assignments",
        sa.Column("agent_id", sa.String(100), primary_key=True),
        sa.Column("device_id", sa.String(100), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("ix_desktop_agent_assignments_device", "desktop_agent_assignments", ["device_id"])

    op.create_table(
        "desktop_task_queue",
        sa.Column("id", sa.String(100), primary_key=True),
        sa.Column("agent_id", sa.String(100), nullable=False),
        sa.Column("device_id", sa.String(100), nullable=False),
        sa.Column("graph_thread_id", sa.String(200), nullable=True),
        sa.Column("tool_name", sa.String(200), nullable=False),
        sa.Column("payload_json", JSONB(), nullable=False, server_default="{}"),
        sa.Column("status", sa.Text(), nullable=False, server_default="queued"),
        sa.Column("call_id", sa.String(100), nullable=False, unique=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("result_json", JSONB(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
    )
    op.create_index("ix_desktop_task_queue_agent", "desktop_task_queue", ["agent_id"])
    op.create_index("ix_desktop_task_queue_device", "desktop_task_queue", ["device_id"])
    op.create_index("ix_desktop_task_queue_status", "desktop_task_queue", ["status"])
    op.create_index("ix_desktop_task_queue_call_id", "desktop_task_queue", ["call_id"])


def downgrade() -> None:
    op.drop_table("desktop_task_queue")
    op.drop_table("desktop_agent_assignments")
    op.drop_table("desktop_device_tokens")
    op.drop_table("desktop_devices")
    op.execute("DROP TYPE IF EXISTS desktop_task_status")
