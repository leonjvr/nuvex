"""Unit tests for edge-aware retrieval (§38.6)."""
from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, MagicMock, patch


def _make_ann_row(id_: int, score: float = 0.85, content: str = "A fact") -> dict:
    return {
        "id": id_,
        "content": content,
        "scope": "personal",
        "owner_id": "agent-1",
        "confidence": 1.0,
        "retrieval_count": 0,
        "cosine_score": score,
    }


class TestRetrieveWithGraphUseGraphFalse:
    @pytest.mark.asyncio
    async def test_use_graph_false_returns_ann_only(self):
        """When use_graph=False, no BFS expansion occurs; returns ANN seeds only."""
        from src.brain.memory.retriever import MemoryRetriever

        retriever = MemoryRetriever(agent_id="agent-1", agent_tier=4, k=5)
        ann_rows = [_make_ann_row(i) for i in range(3)]

        with patch.object(retriever, "retrieve", AsyncMock(return_value=ann_rows)):
            result = await retriever.retrieve_with_graph("query", use_graph=False)

        assert len(result) == 3
        for row in result:
            assert row["retrieval_source"] == "ann"


class TestRetrieveWithGraphExpansion:
    @pytest.mark.asyncio
    async def test_hop1_neighbours_get_lower_weight(self):
        """Hop-1 expanded nodes have weighted_score = 0.8 * their cosine (≤ 0.8)."""
        from src.brain.memory.retriever import MemoryRetriever

        retriever = MemoryRetriever(agent_id="agent-1", agent_tier=4, k=5)
        seed = _make_ann_row(1, score=0.9)

        async def fake_retrieve(_query: str):
            return [seed]

        async def fake_neighbours(mem_id: int, limit: int = 8):
            if mem_id == 1:
                return [(10, 99, "related_to")]
            return []

        async def fake_fetch(mem_id: int):
            if mem_id == 99:
                return {"id": 99, "content": "Expanded fact", "scope": "personal",
                        "owner_id": "a", "confidence": 1.0}
            return None

        with patch.object(retriever, "retrieve", fake_retrieve):
            with patch.object(retriever, "_get_edge_neighbours", fake_neighbours):
                with patch.object(retriever, "_fetch_memory_row", fake_fetch):
                    with patch.object(retriever, "_mark_edges_traversed", AsyncMock()):
                        result = await retriever.retrieve_with_graph("query", use_graph=True)

        ids = {r["id"] for r in result}
        assert 1 in ids
        assert 99 in ids
        hop1 = next(r for r in result if r["id"] == 99)
        assert hop1["retrieval_source"] == "hop1"
        assert hop1["weighted_score"] == pytest.approx(0.8)

    @pytest.mark.asyncio
    async def test_results_capped_at_20(self):
        """Result list never exceeds 20 entries."""
        from src.brain.memory.retriever import MemoryRetriever

        retriever = MemoryRetriever(agent_id="agent-1", agent_tier=4, k=5)
        ann_rows = [_make_ann_row(i, score=0.9) for i in range(5)]

        # Each seed expands to 4 neighbours
        async def fake_neighbours(mem_id: int, limit: int = 8):
            return [(100 + mem_id * 10 + j, 200 + mem_id * 10 + j, "related_to") for j in range(4)]

        async def fake_fetch(mem_id: int):
            return {"id": mem_id, "content": f"f{mem_id}", "scope": "personal",
                    "owner_id": "a", "confidence": 1.0}

        with patch.object(retriever, "retrieve", AsyncMock(return_value=ann_rows)):
            with patch.object(retriever, "_get_edge_neighbours", fake_neighbours):
                with patch.object(retriever, "_fetch_memory_row", fake_fetch):
                    with patch.object(retriever, "_mark_edges_traversed", AsyncMock()):
                        result = await retriever.retrieve_with_graph("q")

        assert len(result) <= 20

    @pytest.mark.asyncio
    async def test_no_ann_results_returns_empty(self):
        """Empty ANN results → no BFS and empty return."""
        from src.brain.memory.retriever import MemoryRetriever

        retriever = MemoryRetriever(agent_id="agent-1", agent_tier=4, k=5)
        with patch.object(retriever, "retrieve", AsyncMock(return_value=[])):
            result = await retriever.retrieve_with_graph("query")
        assert result == []


class TestEdgeAnnotations:
    @pytest.mark.asyncio
    async def test_ann_seed_annotated_with_retrieval_source(self):
        """ANN seed rows get retrieval_source='ann'."""
        from src.brain.memory.retriever import MemoryRetriever

        retriever = MemoryRetriever(agent_id="agent-1", agent_tier=4)
        seed = _make_ann_row(1, score=0.88)
        with patch.object(retriever, "retrieve", AsyncMock(return_value=[seed])):
            with patch.object(retriever, "_get_edge_neighbours", AsyncMock(return_value=[])):
                with patch.object(retriever, "_mark_edges_traversed", AsyncMock()):
                    result = await retriever.retrieve_with_graph("query")

        assert result[0]["retrieval_source"] == "ann"
        assert "edge_path" in result[0]
        assert "weighted_score" in result[0]


class TestTraversedAtUpdate:
    @pytest.mark.asyncio
    async def test_traversed_edges_are_marked(self):
        """Edge ids actually traversed are passed to _mark_edges_traversed."""
        from src.brain.memory.retriever import MemoryRetriever

        retriever = MemoryRetriever(agent_id="agent-1", agent_tier=4)
        seed = _make_ann_row(1, score=0.9)

        async def fake_neighbours(mem_id: int, limit: int = 8):
            return [(55, 2, "supports")]

        async def fake_fetch(mem_id: int):
            return {"id": mem_id, "content": "fact", "scope": "personal", "owner_id": "a", "confidence": 1.0}

        mark_mock = AsyncMock()
        with patch.object(retriever, "retrieve", AsyncMock(return_value=[seed])):
            with patch.object(retriever, "_get_edge_neighbours", fake_neighbours):
                with patch.object(retriever, "_fetch_memory_row", fake_fetch):
                    with patch.object(retriever, "_mark_edges_traversed", mark_mock):
                        await retriever.retrieve_with_graph("q")

        mark_mock.assert_called_once()
        called_ids = mark_mock.call_args[0][0]
        assert 55 in called_ids


class TestMergeAndRerank:
    @pytest.mark.asyncio
    async def test_results_sorted_by_weighted_score_desc(self):
        """Results are sorted descending by weighted_score."""
        from src.brain.memory.retriever import MemoryRetriever

        retriever = MemoryRetriever(agent_id="agent-1", agent_tier=4)
        # Two seeds with different cosine scores
        seeds = [_make_ann_row(1, score=0.6), _make_ann_row(2, score=0.95)]
        with patch.object(retriever, "retrieve", AsyncMock(return_value=seeds)):
            with patch.object(retriever, "_get_edge_neighbours", AsyncMock(return_value=[])):
                with patch.object(retriever, "_mark_edges_traversed", AsyncMock()):
                    result = await retriever.retrieve_with_graph("q", use_graph=True)

        scores = [r["weighted_score"] for r in result]
        assert scores == sorted(scores, reverse=True)
