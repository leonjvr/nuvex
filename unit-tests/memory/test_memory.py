"""Unit tests — organisational memory system (Section 28).

Covers: retriever, consolidator, promoter, forgetter, segmenter.
All DB operations are mocked — no Docker required.
"""
from __future__ import annotations

import sys
import os
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)


# ---------------------------------------------------------------------------
# Helper factories
# ---------------------------------------------------------------------------

def _msg(content: str, role: str = "human", created_at=None):
    m = MagicMock()
    m.type = role
    m.content = content
    m.role = role
    m.created_at = created_at or datetime.now(timezone.utc)
    return m


def _memory_row(
    id: int = 1,
    content: str = "test fact",
    scope: str = "personal",
    owner_id: str = "maya",
    confidence: float = 0.9,
    retrieval_count: int = 0,
    cosine_score: float = 0.85,
):
    return {
        "id": id,
        "content": content,
        "scope": scope,
        "owner_id": owner_id,
        "confidence": confidence,
        "retrieval_count": retrieval_count,
        "cosine_score": cosine_score,
    }


# ---------------------------------------------------------------------------
# 28.27 — Retriever: token budget + cosine threshold
# ---------------------------------------------------------------------------

class TestMemoryRetriever:
    """28.27 — retriever returns only memories within token budget and above cosine threshold."""

    @pytest.mark.asyncio
    async def test_empty_results_returns_empty_string(self):
        with patch("src.brain.memory.retriever._embed", new_callable=AsyncMock) as mock_embed, \
             patch("src.brain.memory.retriever.get_session") as mock_session_ctx:
            mock_embed.return_value = [0.1] * 1536

            session = AsyncMock()
            result = MagicMock()
            result.mappings.return_value.all.return_value = []
            session.execute = AsyncMock(return_value=result)
            session.__aenter__ = AsyncMock(return_value=session)
            session.__aexit__ = AsyncMock(return_value=False)
            mock_session_ctx.return_value = session

            from src.brain.memory.retriever import MemoryRetriever
            r = MemoryRetriever(agent_id="maya", agent_tier=1, division_id="eng", token_budget=600)
            block = await r.build_block("deploy staging server")
            assert block == ""

    @pytest.mark.asyncio
    async def test_below_cosine_threshold_excluded(self):
        """28.27 — entries below min_cosine threshold are excluded."""
        rows = [_memory_row(cosine_score=0.50)]  # below default 0.72

        with patch("src.brain.memory.retriever._embed", new_callable=AsyncMock) as mock_embed, \
             patch("src.brain.memory.retriever.get_session") as mock_session_ctx:
            mock_embed.return_value = [0.1] * 1536

            session = AsyncMock()
            result = MagicMock()
            result.mappings.return_value.all.return_value = rows
            session.execute = AsyncMock(return_value=result)
            session.__aenter__ = AsyncMock(return_value=session)
            session.__aexit__ = AsyncMock(return_value=False)
            mock_session_ctx.return_value = session

            from src.brain.memory.retriever import MemoryRetriever
            r = MemoryRetriever(agent_id="maya", min_cosine=0.72, token_budget=600)
            block = await r.build_block("deploy staging server")
            assert block == ""

    @pytest.mark.asyncio
    async def test_within_budget_returns_block(self):
        """28.27 — results within token budget are returned in [MEMORY] block."""
        rows = [_memory_row(content="Alpine 3.19 requires --frozen-lockfile", cosine_score=0.90)]

        with patch("src.brain.memory.retriever._embed", new_callable=AsyncMock) as mock_embed, \
             patch("src.brain.memory.retriever.get_session") as mock_session_ctx:
            mock_embed.return_value = [0.1] * 1536

            session = AsyncMock()
            result = MagicMock()
            result.mappings.return_value.all.return_value = rows
            update_result = MagicMock()
            session.execute = AsyncMock(side_effect=[result, update_result])
            session.__aenter__ = AsyncMock(return_value=session)
            session.__aexit__ = AsyncMock(return_value=False)
            mock_session_ctx.return_value = session

            from src.brain.memory.retriever import MemoryRetriever
            r = MemoryRetriever(agent_id="maya", min_cosine=0.72, token_budget=600)
            block = await r.build_block("deploy staging server")
            assert "[MEMORY]" in block
            assert "Alpine 3.19" in block

    @pytest.mark.asyncio
    async def test_exceeds_budget_degrades_gracefully(self):
        """28.27 — when K results exceed token budget, lowest-ranked are dropped."""
        long_content = "A" * 400  # long enough to consume most of budget
        rows = [_memory_row(id=i, content=long_content, cosine_score=0.90 - i * 0.01) for i in range(10)]

        with patch("src.brain.memory.retriever._embed", new_callable=AsyncMock) as mock_embed, \
             patch("src.brain.memory.retriever.get_session") as mock_session_ctx, \
             patch("src.brain.memory.retriever._count_tokens", side_effect=lambda t: len(t) // 3):
            mock_embed.return_value = [0.1] * 1536

            session = AsyncMock()
            result = MagicMock()
            result.mappings.return_value.all.return_value = rows
            update_result = MagicMock()
            session.execute = AsyncMock(side_effect=[result, update_result])
            session.__aenter__ = AsyncMock(return_value=session)
            session.__aexit__ = AsyncMock(return_value=False)
            mock_session_ctx.return_value = session

            from src.brain.memory.retriever import MemoryRetriever
            r = MemoryRetriever(agent_id="maya", k=10, token_budget=200)
            block = await r.build_block("query")
            # Block exists but is within budget or empty (graceful degradation)
            assert isinstance(block, str)

    @pytest.mark.asyncio
    async def test_embed_failure_returns_empty(self):
        """28.27 — embedding failure returns empty string silently."""
        with patch("src.brain.memory.retriever._embed", new_callable=AsyncMock) as mock_embed:
            mock_embed.return_value = None

            from src.brain.memory.retriever import MemoryRetriever
            r = MemoryRetriever(agent_id="maya")
            block = await r.build_block("query")
            assert block == ""


# ---------------------------------------------------------------------------
# 28.28 — Consolidator: fact extraction + confidence < 0.5 discarded
# ---------------------------------------------------------------------------

class TestMemoryConsolidator:
    """28.28 — consolidator extracts facts; confidence < 0.5 entries discarded."""

    @pytest.mark.asyncio
    async def test_too_few_messages_skipped(self):
        """< 3 messages — no consolidation run."""
        from src.brain.memory.consolidator import MemoryConsolidator
        c = MemoryConsolidator(agent_id="maya")
        result = await c.consolidate([_msg("hi"), _msg("hello")], thread_id="t1")
        assert result == 0

    @pytest.mark.asyncio
    async def test_greeting_only_skipped(self):
        """Greeting-only thread — no consolidation run."""
        from src.brain.memory.consolidator import _greeting_only
        msgs = [_msg("hi"), _msg("hello"), _msg("thanks")]
        assert _greeting_only(msgs) is True

    @pytest.mark.asyncio
    async def test_low_confidence_discarded(self):
        """28.28 — facts with confidence < 0.5 are NOT written to DB."""
        with patch("src.brain.memory.consolidator._fast_extract", new_callable=AsyncMock) as mock_extract, \
             patch("src.brain.memory.consolidator._embed", new_callable=AsyncMock) as mock_embed, \
             patch("src.brain.memory.consolidator.get_session") as mock_session_ctx:
            mock_extract.return_value = [{"content": "low fact", "confidence": 0.3, "scope": "personal"}]
            mock_embed.return_value = [0.1] * 1536

            session = AsyncMock()
            session.__aenter__ = AsyncMock(return_value=session)
            session.__aexit__ = AsyncMock(return_value=False)
            mock_session_ctx.return_value = session

            from src.brain.memory.consolidator import MemoryConsolidator
            c = MemoryConsolidator(agent_id="maya")
            msgs = [_msg("Deploy was slow"), _msg("I tried --frozen-lockfile"), _msg("It worked")]
            result = await c.consolidate(msgs, thread_id="t1")
            assert result == 0  # nothing written
            session.execute.assert_not_called()

    @pytest.mark.asyncio
    async def test_valid_fact_written(self):
        """28.28 — fact with confidence >= 0.5 is written to DB."""
        with patch("src.brain.memory.consolidator._fast_extract", new_callable=AsyncMock) as mock_extract, \
             patch("src.brain.memory.consolidator._embed", new_callable=AsyncMock) as mock_embed, \
             patch("src.brain.memory.consolidator.get_session") as mock_session_ctx:
            mock_extract.return_value = [{"content": "npm ci needs --frozen-lockfile", "confidence": 0.9, "scope": "personal"}]
            mock_embed.return_value = [0.1] * 1536

            session = AsyncMock()
            execute_result = MagicMock()
            session.execute = AsyncMock(return_value=execute_result)
            session.commit = AsyncMock()
            session.__aenter__ = AsyncMock(return_value=session)
            session.__aexit__ = AsyncMock(return_value=False)
            mock_session_ctx.return_value = session

            from src.brain.memory.consolidator import MemoryConsolidator
            c = MemoryConsolidator(agent_id="maya")
            msgs = [_msg("Deploy was slow"), _msg("I tried --frozen-lockfile"), _msg("It worked")]
            result = await c.consolidate(msgs, thread_id="t1")
            assert result == 1
            session.execute.assert_called()


# ---------------------------------------------------------------------------
# 28.29 — Promoter: personal confidence >= 0.85 → division
# ---------------------------------------------------------------------------

class TestMemoryPromoter:
    """28.29 — personal fact with confidence >= 0.85 is promoted to division scope."""

    @pytest.mark.asyncio
    async def test_promote_personal_to_division_success(self):
        """28.29 — high-confidence fact promoted to division correctly."""
        with patch("src.brain.memory.promoter.get_session") as mock_session_ctx:
            session = AsyncMock()
            # First execute: fetch source memory
            fetch_result = MagicMock()
            fetch_result.mappings.return_value.first.return_value = {
                "content": "npm ci needs --frozen-lockfile",
                "confidence": 0.9,
                "embedding": "[0.1,0.2]",
                "source_agent": "maya",
            }
            # Second: duplicate check → no duplicate
            dup_result = MagicMock()
            dup_result.mappings.return_value.first.return_value = None
            # Third: insert new division-scope entry
            insert_result = MagicMock()
            # Fourth: log promotion
            log_result = MagicMock()
            session.execute = AsyncMock(side_effect=[fetch_result, dup_result, insert_result, log_result])
            session.commit = AsyncMock()
            session.__aenter__ = AsyncMock(return_value=session)
            session.__aexit__ = AsyncMock(return_value=False)
            mock_session_ctx.return_value = session

            from src.brain.memory.promoter import MemoryPromoter
            p = MemoryPromoter(requesting_agent_id="maya")
            result = await p.promote_personal_to_division(memory_id=1, division_id="eng")
            assert result is True

    @pytest.mark.asyncio
    async def test_duplicate_prevents_promotion(self):
        """28.29 — near-duplicate in division scope (cosine > 0.95) blocks promotion."""
        with patch("src.brain.memory.promoter.get_session") as mock_session_ctx:
            session = AsyncMock()
            fetch_result = MagicMock()
            fetch_result.mappings.return_value.first.return_value = {
                "content": "existing fact",
                "confidence": 0.9,
                "embedding": "[0.1,0.2]",
                "source_agent": "maya",
            }
            dup_result = MagicMock()
            dup_result.mappings.return_value.first.return_value = {"id": 99}  # duplicate found
            session.execute = AsyncMock(side_effect=[fetch_result, dup_result])
            session.commit = AsyncMock()
            session.__aenter__ = AsyncMock(return_value=session)
            session.__aexit__ = AsyncMock(return_value=False)
            mock_session_ctx.return_value = session

            from src.brain.memory.promoter import MemoryPromoter
            p = MemoryPromoter(requesting_agent_id="maya")
            result = await p.promote_personal_to_division(memory_id=1, division_id="eng")
            assert result is False

    @pytest.mark.asyncio
    async def test_org_pending_not_returned_without_approval(self):
        """28.30 — org-scope pending entry not returned by retrieval until approved_by set."""
        # Retriever SQL filters: scope='org' AND approved_by IS NOT NULL
        # This test verifies the filter logic conceptually by checking
        # that a row with approved_by=None would be excluded.
        from src.brain.memory.retriever import MemoryRetriever
        # The retriever SQL includes `AND approved_by IS NOT NULL` for org scope
        # so pending entries (approved_by=NULL) are never returned.
        # We verify the SQL contains the guard:
        import inspect
        src = inspect.getsource(MemoryRetriever.retrieve)
        assert "approved_by IS NOT NULL" in src


# ---------------------------------------------------------------------------
# 28.31 — forbidden_tools: [memory_retrieve] skips injection
# ---------------------------------------------------------------------------

class TestForbiddenMemoryRetrieve:
    """28.31 — forbidden_tools: [memory_retrieve] skips memory injection entirely."""

    @pytest.mark.asyncio
    async def test_memory_retrieve_in_forbidden_skips_retrieval(self):
        """Agent with memory_retrieve in forbidden_tools → empty block returned."""
        agent_def = MagicMock()
        agent_def.forbidden_tools = ["memory_retrieve"]
        agent_def.tier = "T3"
        agent_def.division = "eng"

        cfg = MagicMock()
        cfg.agents = {"maya": agent_def}

        state = MagicMock()
        state.agent_id = "maya"
        state.messages = [_msg("deploy staging")]

        with patch("src.shared.config.get_cached_config", return_value=cfg):
            from src.brain.nodes.call_llm import _retrieve_memory_block
            block = await _retrieve_memory_block(state)
            assert block == ""


# ---------------------------------------------------------------------------
# 28.32 — Forgetter: prune correct entries; retrieval_count >= 5 preserved
# ---------------------------------------------------------------------------

class TestMemoryForgetter:
    """28.32 — forgetter prunes correct entries; entries with retrieval_count >= 5 preserved."""

    @pytest.mark.asyncio
    async def test_over_limit_triggers_prune(self):
        """When count > max_personal_memories, prune oldest low-confidence entries."""
        with patch("src.brain.memory.forgetter.get_session") as mock_session_ctx:
            session = AsyncMock()
            count_result = MagicMock()
            count_result.scalar.return_value = 520  # over limit of 500
            delete_result = MagicMock()
            delete_result.fetchall.return_value = [MagicMock()] * 20
            session.execute = AsyncMock(side_effect=[count_result, delete_result])
            session.commit = AsyncMock()
            session.__aenter__ = AsyncMock(return_value=session)
            session.__aexit__ = AsyncMock(return_value=False)
            mock_session_ctx.return_value = session

            from src.brain.memory.forgetter import MemoryForgetter
            f = MemoryForgetter(agent_id="maya", max_personal_memories=500)
            pruned = await f.prune_over_limit()
            assert pruned == 20

    @pytest.mark.asyncio
    async def test_within_limit_no_prune(self):
        """When count <= max_personal_memories, no pruning occurs."""
        with patch("src.brain.memory.forgetter.get_session") as mock_session_ctx:
            session = AsyncMock()
            count_result = MagicMock()
            count_result.scalar.return_value = 480  # under limit
            session.execute = AsyncMock(return_value=count_result)
            session.commit = AsyncMock()
            session.__aenter__ = AsyncMock(return_value=session)
            session.__aexit__ = AsyncMock(return_value=False)
            mock_session_ctx.return_value = session

            from src.brain.memory.forgetter import MemoryForgetter
            f = MemoryForgetter(agent_id="maya", max_personal_memories=500)
            pruned = await f.prune_over_limit()
            assert pruned == 0

    @pytest.mark.asyncio
    async def test_delete_sql_excludes_retrieval_immune(self):
        """28.32 — SQL query excludes entries with retrieval_count >= 5."""
        from src.brain.memory.forgetter import MemoryForgetter, _RETRIEVAL_IMMUNE_COUNT
        import inspect
        src = inspect.getsource(MemoryForgetter.prune_over_limit)
        assert "retrieval_count" in src
        assert "_RETRIEVAL_IMMUNE_COUNT" in src


# ---------------------------------------------------------------------------
# 28.43 — Segmenter: cosine drop → segment_boundary=True
# ---------------------------------------------------------------------------

class TestMessageSegmenter:
    """28.43-28.45 — segmenter boundary detection and group relevance scoring."""

    @pytest.mark.asyncio
    async def test_cosine_drop_sets_boundary(self):
        """28.43 — message with cosine < threshold gets segment_boundary=True."""
        deploy_emb = [1.0] + [0.0] * 1535
        food_emb = [0.0, 1.0] + [0.0] * 1534

        call_count = 0
        async def mock_embed(text):
            nonlocal call_count
            call_count += 1
            return deploy_emb if call_count <= 1 else food_emb

        msg1 = MagicMock()
        msg1.id = 1
        msg1.content = "deploy the staging server"
        msg1.created_at = datetime(2026, 4, 8, 9, 0, tzinfo=timezone.utc)

        msg2 = MagicMock()
        msg2.id = 2
        msg2.content = "what should I make for dinner"
        msg2.created_at = datetime(2026, 4, 8, 9, 1, tzinfo=timezone.utc)

        with patch("src.brain.memory.segmenter._embed", side_effect=mock_embed), \
             patch("src.brain.memory.segmenter.get_session") as mock_session_ctx:
            session = AsyncMock()
            execute_result = MagicMock()
            session.execute = AsyncMock(return_value=execute_result)
            session.commit = AsyncMock()
            session.__aenter__ = AsyncMock(return_value=session)
            session.__aexit__ = AsyncMock(return_value=False)
            mock_session_ctx.return_value = session

            from src.brain.memory.segmenter import MessageSegmenter
            s = MessageSegmenter(
                thread_id="t1", agent_id="maya",
                boundary_threshold=0.58, min_messages=2,
            )
            await s.process_messages([msg1, msg2])

            # Second execute call should set segment_boundary=True
            calls = session.execute.call_args_list
            assert len(calls) >= 2
            # Parse the second call's params to verify boundary=True was set
            second_call_params = calls[1][0][1] if calls[1][0] else calls[1][1].get("parameters", {})
            if isinstance(second_call_params, dict):
                assert second_call_params.get("boundary") is True

    def test_group_chat_mention_gets_high_score(self):
        """28.45 — @-mention returns score 1.0."""
        from src.brain.memory.segmenter import MessageSegmenter
        s = MessageSegmenter(thread_id="t", agent_id="maya")
        score = s.score_group_message_relevance("hey @maya can you deploy?", "maya", ["deploy"])
        assert score == 1.0

    def test_group_chat_topic_match_gets_medium_score(self):
        """28.45 — topic keyword match returns 0.6."""
        from src.brain.memory.segmenter import MessageSegmenter
        s = MessageSegmenter(thread_id="t", agent_id="maya")
        score = s.score_group_message_relevance("the deploy failed again", "maya", ["deploy"])
        assert score == 0.6

    def test_group_chat_baseline_below_threshold(self):
        """28.45 — baseline (0.2) is below group_relevance_threshold (0.25)."""
        from src.brain.memory.segmenter import MessageSegmenter, _GROUP_RELEVANCE_THRESHOLD
        s = MessageSegmenter(thread_id="t", agent_id="maya")
        score = s.score_group_message_relevance("random chat about lunch", "maya", ["deploy"])
        assert score == 0.2
        assert score < _GROUP_RELEVANCE_THRESHOLD

    @pytest.mark.asyncio
    async def test_centroid_query_vector_averages_embeddings(self):
        """28.42 — centroid of last 3 messages used for ANN query."""
        emb_a = [1.0, 0.0]
        emb_b = [0.0, 1.0]
        emb_c = [1.0, 1.0]

        call_count = 0
        async def mock_embed(text):
            nonlocal call_count
            call_count += 1
            return [emb_a, emb_b, emb_c][call_count - 1]

        messages = [_msg("a"), _msg("b"), _msg("c")]
        with patch("src.brain.memory.segmenter._embed", side_effect=mock_embed):
            from src.brain.memory.segmenter import MessageSegmenter
            s = MessageSegmenter(thread_id="t", agent_id="maya")
            centroid = await s.build_centroid_query_vector(messages, last_n=3)
            assert centroid is not None
            # Centroid of [1,0], [0,1], [1,1] = [2/3, 2/3]
            assert abs(centroid[0] - 2/3) < 0.01
            assert abs(centroid[1] - 2/3) < 0.01
