"""Add llm_providers table.

Revision ID: 0007
Revises: 0006
Create Date: 2026-04-06
"""
from alembic import op
import sqlalchemy as sa

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None

_DEFAULT_PROVIDERS = [
    ("anthropic/claude-sonnet-4", "anthropic", "claude-sonnet-4-20250514", None, None),
    ("openai/gpt-4o", "openai", "gpt-4o", None, None),
    ("groq/llama-3.3-70b", "groq", "llama-3.3-70b-versatile", None, None),
    ("deepseek/deepseek-chat", "deepseek", "deepseek-chat", None, "https://api.deepseek.com"),
]


def upgrade() -> None:
    op.create_table(
        "llm_providers",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(100), nullable=False, unique=True, index=True),
        sa.Column("provider", sa.String(50), nullable=False),
        sa.Column("model", sa.String(200), nullable=False),
        sa.Column("api_key", sa.Text, nullable=True),
        sa.Column("base_url", sa.String(500), nullable=True),
        sa.Column("enabled", sa.Boolean, default=True, nullable=False, server_default="true"),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    # Seed default providers (no API keys stored — they come from env vars)
    providers_table = sa.table(
        "llm_providers",
        sa.column("name", sa.String),
        sa.column("provider", sa.String),
        sa.column("model", sa.String),
        sa.column("api_key", sa.Text),
        sa.column("base_url", sa.String),
        sa.column("enabled", sa.Boolean),
    )
    op.bulk_insert(providers_table, [
        {"name": name, "provider": prov, "model": model, "api_key": api_key,
         "base_url": base_url, "enabled": True}
        for name, prov, model, api_key, base_url in _DEFAULT_PROVIDERS
    ])


def downgrade() -> None:
    op.drop_table("llm_providers")
