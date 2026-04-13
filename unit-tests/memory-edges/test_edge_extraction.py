"""Unit tests for consolidator edge extraction (§37.5)."""
from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, MagicMock, patch


class TestEdgeExtractionSkipCondition:
    @pytest.mark.asyncio
    async def test_skip_when_fewer_than_2_facts(self):
        """extract_edges returns 0 immediately when < 2 facts (§37.1)."""
        from src.brain.memory.consolidator import MemoryConsolidator
        c = MemoryConsolidator(agent_id="a", fast_model="gpt-4o-mini")
        result = await c.extract_edges(fact_ids=[1], fact_contents=["only one fact"])
        assert result == 0

    @pytest.mark.asyncio
    async def test_skip_when_zero_facts(self):
        from src.brain.memory.consolidator import MemoryConsolidator
        c = MemoryConsolidator(agent_id="a", fast_model="gpt-4o-mini")
        result = await c.extract_edges(fact_ids=[], fact_contents=[])
        assert result == 0


class TestEdgeUpsertLogic:
    @pytest.mark.asyncio
    async def test_valid_edge_is_written(self):
        """With a mocked LLM returning a valid edge, one edge is written to DB."""
        from src.brain.memory.consolidator import MemoryConsolidator

        mock_response = MagicMock()
        mock_response.content = '{"source": 1, "target": 2, "edge_type": "supports", "confidence": 0.9}'

        mock_llm = MagicMock()
        mock_llm.ainvoke = AsyncMock(return_value=mock_response)

        mock_session = AsyncMock()
        exec_result = MagicMock()
        mock_session.execute = AsyncMock(return_value=exec_result)
        mock_session.commit = AsyncMock()
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)

        c = MemoryConsolidator(agent_id="a", fast_model="gpt-4o-mini")
        with patch("src.brain.memory.consolidator.get_session", return_value=mock_session):
            with patch("langchain_openai.ChatOpenAI", return_value=mock_llm):
                count = await c.extract_edges(
                    fact_ids=[1, 2],
                    fact_contents=["Fact A", "Fact B"],
                )
        assert count == 1

    @pytest.mark.asyncio
    async def test_invalid_edge_type_is_rejected(self):
        """Edges with unknown edge_type must not be written."""
        from src.brain.memory.consolidator import MemoryConsolidator

        mock_response = MagicMock()
        mock_response.content = '{"source": 1, "target": 2, "edge_type": "unknown_type", "confidence": 0.9}'
        mock_llm = MagicMock()
        mock_llm.ainvoke = AsyncMock(return_value=mock_response)

        mock_session = AsyncMock()
        mock_session.execute = AsyncMock()
        mock_session.commit = AsyncMock()
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)

        c = MemoryConsolidator(agent_id="a", fast_model="gpt-4o-mini")
        with patch("src.brain.memory.consolidator.get_session", return_value=mock_session):
            with patch("langchain_openai.ChatOpenAI", return_value=mock_llm):
                count = await c.extract_edges(fact_ids=[1, 2], fact_contents=["A", "B"])
        assert count == 0

    @pytest.mark.asyncio
    async def test_self_loop_edge_is_rejected(self):
        """An edge from a fact to itself must be skipped."""
        from src.brain.memory.consolidator import MemoryConsolidator

        mock_response = MagicMock()
        mock_response.content = '{"source": 1, "target": 1, "edge_type": "supports", "confidence": 0.9}'
        mock_llm = MagicMock()
        mock_llm.ainvoke = AsyncMock(return_value=mock_response)

        mock_session = AsyncMock()
        mock_session.execute = AsyncMock()
        mock_session.commit = AsyncMock()
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)

        c = MemoryConsolidator(agent_id="a", fast_model="gpt-4o-mini")
        with patch("src.brain.memory.consolidator.get_session", return_value=mock_session):
            with patch("langchain_openai.ChatOpenAI", return_value=mock_llm):
                count = await c.extract_edges(fact_ids=[1, 2], fact_contents=["A", "B"])
        assert count == 0


class TestEdgeExtractionFailureIsolation:
    @pytest.mark.asyncio
    async def test_llm_failure_returns_zero_not_raises(self):
        """LLM failure in edge extraction must return 0, not propagate (§37.4)."""
        from src.brain.memory.consolidator import MemoryConsolidator

        mock_llm = MagicMock()
        mock_llm.ainvoke = AsyncMock(side_effect=RuntimeError("Model unavailable"))

        c = MemoryConsolidator(agent_id="a", fast_model="gpt-4o-mini")
        with patch("langchain_openai.ChatOpenAI", return_value=mock_llm):
            count = await c.extract_edges(fact_ids=[1, 2], fact_contents=["A", "B"])
        assert count == 0

    @pytest.mark.asyncio
    async def test_db_failure_returns_zero_not_raises(self):
        """DB write failure must return 0, not propagate (§37.4)."""
        from src.brain.memory.consolidator import MemoryConsolidator

        mock_response = MagicMock()
        mock_response.content = '[{"source": 1, "target": 2, "edge_type": "supports", "confidence": 0.9}]'
        mock_llm = MagicMock()
        mock_llm.ainvoke = AsyncMock(return_value=mock_response)

        mock_session = AsyncMock()
        mock_session.execute = AsyncMock(side_effect=RuntimeError("DB down"))
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)

        c = MemoryConsolidator(agent_id="a", fast_model="gpt-4o-mini")
        with patch("src.brain.memory.consolidator.get_session", return_value=mock_session):
            with patch("langchain_openai.ChatOpenAI", return_value=mock_llm):
                count = await c.extract_edges(fact_ids=[1, 2], fact_contents=["A", "B"])
        assert count == 0
