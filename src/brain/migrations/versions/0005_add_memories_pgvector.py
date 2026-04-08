"""Migration: enable pgvector extension and create memories table.

Revision ID: 0005
Revises: 0004
Create Date: 2026-04-05

Creates:
  - pgvector extension (idempotent)
  - memories table with a vector(1536) embedding column

Column notes:
  agent_id   — which agent owns this memory
  content    — raw text of the memory
  embedding  — 1536-dimensional vector embedding (text-embedding-ada-002 / 3-small)
  source     — optional tag: 'conversation', 'skill', 'user', etc.
  metadata_  — arbitrary JSONB bag
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Enable pgvector extension (idempotent)
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    op.create_table(
        "memories",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("agent_id", sa.String(100), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        # 1536-dimensional float vector — matches text-embedding-ada-002 / text-embedding-3-small
        sa.Column(
            "embedding",
            sa.Text(),  # stored as text; actual vector type applied via raw DDL below
            nullable=True,
        ),
        sa.Column("source", sa.String(100), nullable=True),
        sa.Column("metadata_", postgresql.JSONB(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )

    # Swap the placeholder TEXT column for the real vector(1536) type
    op.execute("ALTER TABLE memories ALTER COLUMN embedding TYPE vector(1536) USING embedding::vector")

    # ivfflat index for approximate nearest-neighbour search (cosine distance)
    op.execute(
        "CREATE INDEX ix_memories_embedding_ivfflat "
        "ON memories USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)"
    )
    op.create_index("ix_memories_agent_id", "memories", ["agent_id"])
    op.create_index("ix_memories_source", "memories", ["source"])
    op.create_index("ix_memories_created_at", "memories", ["created_at"])


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_memories_embedding_ivfflat")
    op.drop_index("ix_memories_created_at", "memories")
    op.drop_index("ix_memories_source", "memories")
    op.drop_index("ix_memories_agent_id", "memories")
    op.drop_table("memories")
    # Note: we intentionally do NOT drop the vector extension as other tables may use it
