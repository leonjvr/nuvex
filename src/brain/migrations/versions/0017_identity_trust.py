"""Migration: identity & trust subsystem — principals, contacts, contact_handles,
contact_relationships, contact_context tables; add system flag to agents.

Revision ID: 0017
Revises: 0016
Create Date: 2026-04-09
"""
from alembic import op
import sqlalchemy as sa

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add system flag to agents table
    op.add_column(
        "agents",
        sa.Column("system", sa.Boolean(), nullable=False, server_default="false"),
    )

    # Principals table
    op.create_table(
        "principals",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("org_id", sa.String(100), nullable=False, index=True),
        sa.Column("contact_id", sa.String(36), nullable=True),
        sa.Column("role", sa.String(20), nullable=False),  # owner | admin | operator
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )

    # Contacts table
    op.create_table(
        "contacts",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("org_id", sa.String(100), nullable=False, index=True),
        sa.Column("display_name", sa.String(200), nullable=False),
        sa.Column("trust_tier", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("sanction", sa.String(30), nullable=True),
        sa.Column("sanction_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sanction_reason", sa.Text(), nullable=True),
        sa.Column("message_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )

    # Contact handles (one contact → many channel handles)
    op.create_table(
        "contact_handles",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("contact_id", sa.String(36), nullable=False, index=True),
        sa.Column("channel_type", sa.String(30), nullable=False),
        sa.Column("handle", sa.String(200), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.UniqueConstraint("channel_type", "handle", name="uq_contact_handles_channel_handle"),
    )

    # Contact relationships
    op.create_table(
        "contact_relationships",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("contact_id_a", sa.String(36), nullable=False, index=True),
        sa.Column("contact_id_b", sa.String(36), nullable=False, index=True),
        sa.Column("relationship_type", sa.String(50), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_by_agent", sa.String(100), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )

    # Contact context (per-agent, per-contact learned facts)
    op.create_table(
        "contact_context",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("agent_id", sa.String(100), nullable=False, index=True),
        sa.Column("contact_id", sa.String(36), nullable=False, index=True),
        sa.Column("key", sa.String(200), nullable=False),
        sa.Column("value", sa.Text(), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False, server_default="1.0"),
        sa.Column("decay_factor", sa.Float(), nullable=False, server_default="0.95"),
        sa.Column("last_referenced", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )


def downgrade() -> None:
    op.drop_table("contact_context")
    op.drop_table("contact_relationships")
    op.drop_table("contact_handles")
    op.drop_table("contacts")
    op.drop_table("principals")
    op.drop_column("agents", "system")
