"""Migration: topic segmentation columns and message_segments table.

Revision ID: 0010
Revises: 0009
Create Date: 2026-04-08

Adds per-message embedding + segment tracking columns (Section 28.10).
Creates message_segments table for segment lifecycle management.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add segmentation columns to messages table
    op.add_column(
        "messages",
        sa.Column(
            "msg_embedding",
            sa.Text(),
            nullable=True,
            comment="vector(1536) stored as text; use raw SQL for cosine ops",
        ),
    )
    op.add_column(
        "messages",
        sa.Column(
            "segment_id",
            UUID(as_uuid=True),
            nullable=True,
            index=True,
            comment="FK to message_segments.id",
        ),
    )
    op.add_column(
        "messages",
        sa.Column(
            "segment_boundary",
            sa.Boolean(),
            nullable=False,
            server_default="false",
            comment="True when cosine drop to previous message exceeds threshold",
        ),
    )
    op.add_column(
        "messages",
        sa.Column(
            "segment_summary",
            sa.Text(),
            nullable=True,
            comment="One-line summary injected into prompt for closed segments",
        ),
    )
    op.add_column(
        "messages",
        sa.Column(
            "relevance_score",
            sa.Float(),
            nullable=True,
            comment="Agent relevance score for group-chat compression",
        ),
    )

    # Create message_segments table
    op.create_table(
        "message_segments",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("thread_id", sa.String(255), nullable=False, index=True),
        sa.Column("agent_id", sa.String(100), nullable=False),
        sa.Column("start_message_id", sa.Integer(), nullable=True),
        sa.Column("end_message_id", sa.Integer(), nullable=True),
        sa.Column("state", sa.String(20), nullable=False, server_default="open"),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_message_segments_thread_state",
        "message_segments",
        ["thread_id", "state"],
    )


def downgrade() -> None:
    op.drop_index("ix_message_segments_thread_state", "message_segments")
    op.drop_table("message_segments")
    for col in ["relevance_score", "segment_summary", "segment_boundary", "segment_id", "msg_embedding"]:
        op.drop_column("messages", col)
