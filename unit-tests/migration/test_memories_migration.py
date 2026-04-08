"""Unit tests — 3.7: pgvector extension + memories migration."""
from __future__ import annotations

import importlib
import importlib.util
from pathlib import Path

import pytest

from src.brain.models.memory import Memory


# ---------------------------------------------------------------------------
# Load the migration module dynamically (filename starts with a digit)
# ---------------------------------------------------------------------------

_MIGRATION_FILE = (
    Path(__file__).parent.parent.parent
    / "src/brain/migrations/versions/0005_add_memories_pgvector.py"
)


def _load_migration():
    spec = importlib.util.spec_from_file_location("migration_0005", _MIGRATION_FILE)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# ---------------------------------------------------------------------------
# Migration metadata
# ---------------------------------------------------------------------------

class TestMigrationMetadata:
    def test_revision_is_0005(self):
        mod = _load_migration()
        assert mod.revision == "0005"

    def test_down_revision_is_0004(self):
        mod = _load_migration()
        assert mod.down_revision == "0004"

    def test_upgrade_is_callable(self):
        mod = _load_migration()
        assert callable(mod.upgrade)

    def test_downgrade_is_callable(self):
        mod = _load_migration()
        assert callable(mod.downgrade)


# ---------------------------------------------------------------------------
# Memory ORM model
# ---------------------------------------------------------------------------

class TestMemoryModel:
    def test_tablename(self):
        assert Memory.__tablename__ == "memories"

    def test_has_id_column(self):
        assert hasattr(Memory, "id")

    def test_has_agent_id_column(self):
        assert hasattr(Memory, "agent_id")

    def test_has_content_column(self):
        assert hasattr(Memory, "content")

    def test_has_embedding_column(self):
        assert hasattr(Memory, "embedding")

    def test_has_source_column(self):
        assert hasattr(Memory, "source")

    def test_has_metadata_column(self):
        assert hasattr(Memory, "metadata_")

    def test_has_created_at_column(self):
        assert hasattr(Memory, "created_at")

    def test_can_instantiate_without_embedding(self):
        m = Memory(agent_id="maya", content="This is a test memory.")
        assert m.content == "This is a test memory."
        assert m.embedding is None

    def test_can_set_source(self):
        m = Memory(agent_id="maya", content="hello", source="conversation")
        assert m.source == "conversation"

    def test_can_set_metadata(self):
        m = Memory(agent_id="maya", content="fact", metadata_={"importance": "high"})
        assert m.metadata_["importance"] == "high"
