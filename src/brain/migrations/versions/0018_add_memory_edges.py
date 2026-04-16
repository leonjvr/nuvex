"""Migration: add memory_edges table with EdgeType enum (§36).

Revision ID: 0018
Revises: 0017
Create Date: 2026-04-09
"""
from alembic import op
import sqlalchemy as sa

revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None

_EDGE_TYPES = ("supports", "contradicts", "evolved_into", "depends_on", "related_to")


def upgrade() -> None:
    op.execute(
        "CREATE TYPE edge_type AS ENUM ('supports','contradicts','evolved_into','depends_on','related_to')"
    )
    op.create_table(
        "memory_edges",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("source_id", sa.Integer(), nullable=False, index=True),
        sa.Column("target_id", sa.Integer(), nullable=False, index=True),
        sa.Column("edge_type", sa.String(30), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False, server_default="1.0"),
        sa.Column("agent_id", sa.String(100), nullable=False, index=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("traversed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_memory_edges_source_id", "memory_edges", ["source_id"])
    op.create_index("ix_memory_edges_target_id", "memory_edges", ["target_id"])
    op.create_index("ix_memory_edges_agent_id", "memory_edges", ["agent_id"])


def downgrade() -> None:
    op.drop_table("memory_edges")
    op.execute("DROP TYPE IF EXISTS edge_type")
