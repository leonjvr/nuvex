"""Unit tests for MemoryEdge model and EdgeType enum (§36.5)."""
from __future__ import annotations

import pytest
from datetime import datetime, timezone


class TestEdgeTypeEnum:
    def test_all_required_values_present(self):
        from src.brain.models.memory_edge import EdgeType
        values = {e.value for e in EdgeType}
        assert values == {"supports", "contradicts", "evolved_into", "depends_on", "related_to"}

    def test_enum_values_are_strings(self):
        from src.brain.models.memory_edge import EdgeType
        for e in EdgeType:
            assert isinstance(e.value, str)

    def test_edge_type_is_str_enum(self):
        from src.brain.models.memory_edge import EdgeType
        assert EdgeType.supports == "supports"
        assert EdgeType.contradicts == "contradicts"
        assert EdgeType.evolved_into == "evolved_into"
        assert EdgeType.depends_on == "depends_on"
        assert EdgeType.related_to == "related_to"


class TestMemoryEdgeModel:
    def test_tablename(self):
        from src.brain.models.memory_edge import MemoryEdge
        assert MemoryEdge.__tablename__ == "memory_edges"

    def test_instantiation_with_required_fields(self):
        from src.brain.models.memory_edge import MemoryEdge
        edge = MemoryEdge(
            source_id=1,
            target_id=2,
            edge_type="supports",
            agent_id="agent-1",
        )
        assert edge.source_id == 1
        assert edge.target_id == 2
        assert edge.edge_type == "supports"
        assert edge.agent_id == "agent-1"

    def test_default_confidence_is_one(self):
        from src.brain.models.memory_edge import MemoryEdge
        edge = MemoryEdge(source_id=1, target_id=2, edge_type="related_to", agent_id="a")
        assert edge.confidence == 1.0

    def test_traversed_at_defaults_to_none(self):
        from src.brain.models.memory_edge import MemoryEdge
        edge = MemoryEdge(source_id=1, target_id=2, edge_type="supports", agent_id="a")
        assert edge.traversed_at is None

    def test_exported_from_models_init(self):
        from src.brain.models import MemoryEdge, EdgeType
        assert MemoryEdge is not None
        assert EdgeType is not None

    def test_custom_confidence(self):
        from src.brain.models.memory_edge import MemoryEdge
        edge = MemoryEdge(source_id=10, target_id=20, edge_type="contradicts", confidence=0.7, agent_id="x")
        assert edge.confidence == pytest.approx(0.7)
