"""Migration: outcome feedback loop and arousal state tables.

Revision ID: 0011
Revises: 0010
Create Date: 2026-04-08

Adds outcomes, memory_retrievals, policy_candidates, routing_outcomes,
and arousal_state tables (Sections 29 and 30).
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ------------------------------------------------------------------ outcomes
    op.create_table(
        "outcomes",
        sa.Column(
            "id", UUID(as_uuid=True), primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("thread_id", sa.String(255), nullable=False),
        sa.Column("agent_id", sa.String(100), nullable=False),
        sa.Column("task_id", UUID(as_uuid=True), nullable=True),
        sa.Column("invocation_id", sa.String(100), nullable=False),
        sa.Column("succeeded", sa.Boolean(), nullable=False),
        sa.Column("user_confirmed", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("cost_usd", sa.Float(), nullable=False, server_default="0.0"),
        sa.Column("duration_s", sa.Float(), nullable=False, server_default="0.0"),
        sa.Column("tools_used", JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),  
        sa.Column("denial_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("iteration_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error_class", sa.String(50), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True),
            server_default=sa.text("now()"), nullable=False,
        ),
    )
    op.create_index("ix_outcomes_agent_id", "outcomes", ["agent_id"])
    op.create_index("ix_outcomes_created_at", "outcomes", ["created_at"])
    op.create_index("ix_outcomes_thread_id", "outcomes", ["thread_id"])

    # ---------------------------------------------------- memory_retrievals
    op.create_table(
        "memory_retrievals",
        sa.Column(
            "id", UUID(as_uuid=True), primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("thread_id", sa.String(255), nullable=False),
        sa.Column("memory_id", sa.Integer(), nullable=False),   # FK to memories.id (int PK)
        sa.Column(
            "retrieved_at", sa.DateTime(timezone=True),
            server_default=sa.text("now()"), nullable=False,
        ),
        sa.Column("cosine_score", sa.Float(), nullable=True),
    )
    op.create_index("ix_memory_retrievals_thread", "memory_retrievals", ["thread_id"])
    op.create_index("ix_memory_retrievals_memory", "memory_retrievals", ["memory_id"])

    # ---------------------------------------------------- policy_candidates
    op.create_table(
        "policy_candidates",
        sa.Column(
            "id", UUID(as_uuid=True), primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("agent_id", sa.String(100), nullable=True),
        sa.Column("division_id", sa.String(100), nullable=True),
        sa.Column("condition_tree", JSONB(), nullable=False),
        sa.Column("action", sa.String(50), nullable=False),
        sa.Column("rationale", sa.Text(), nullable=False),
        sa.Column("source_threads", JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column(
            "status", sa.String(30), nullable=False,
            server_default="pending_review",
        ),
        sa.Column("reviewed_by", sa.String(100), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True),
            server_default=sa.text("now()"), nullable=False,
        ),
    )

    # ----------------------------------------------------- routing_outcomes
    op.create_table(
        "routing_outcomes",
        sa.Column(
            "id", UUID(as_uuid=True), primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("agent_id", sa.String(100), nullable=False),
        sa.Column("task_type", sa.String(50), nullable=False),
        sa.Column("model_name", sa.String(100), nullable=False),
        sa.Column("succeeded", sa.Boolean(), nullable=False),
        sa.Column("cost_usd", sa.Float(), nullable=False, server_default="0.0"),
        sa.Column("duration_s", sa.Float(), nullable=False, server_default="0.0"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True),
            server_default=sa.text("now()"), nullable=False,
        ),
    )

    # ------------------------------------------------------ arousal_state
    op.create_table(
        "arousal_state",
        sa.Column("agent_id", sa.String(100), primary_key=True),
        sa.Column("idle_seconds", sa.Float(), nullable=False, server_default="0"),
        sa.Column("pending_task_pressure", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("budget_burn_3day_avg", sa.Float(), nullable=False, server_default="0.0"),
        sa.Column("unread_channel_messages", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("recovery_event_count_24h", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_arousal_score", sa.Float(), nullable=False, server_default="0.0"),
        sa.Column("last_invocation_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True),
            server_default=sa.text("now()"), nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_table("arousal_state")
    op.drop_table("routing_outcomes")
    op.drop_table("policy_candidates")
    op.drop_index("ix_memory_retrievals_memory", "memory_retrievals")
    op.drop_index("ix_memory_retrievals_thread", "memory_retrievals")
    op.drop_table("memory_retrievals")
    op.drop_index("ix_outcomes_thread_id", "outcomes")
    op.drop_index("ix_outcomes_created_at", "outcomes")
    op.drop_index("ix_outcomes_agent_id", "outcomes")
    op.drop_table("outcomes")
