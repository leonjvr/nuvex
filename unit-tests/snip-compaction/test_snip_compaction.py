"""Unit tests for snip compaction (§31)."""
from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, MagicMock, patch, call
from datetime import datetime, timezone


def _mock_snip(turn_index: int, role: str = "user", content: str = "msg", token_count: int = 10):
    s = MagicMock()
    s.turn_index = turn_index
    s.role = role
    s.content = content
    s.token_count = token_count
    return s


def _make_session_with_snips(snips):
    session = AsyncMock()
    exec_result = MagicMock()
    exec_result.scalars.return_value.all.return_value = snips
    session.execute = AsyncMock(return_value=exec_result)
    session.add = MagicMock()
    session.commit = AsyncMock()
    session.__aenter__ = AsyncMock(return_value=session)
    session.__aexit__ = AsyncMock(return_value=False)
    return session


class TestBuildHistoricalContextBlock:
    def test_empty_snips_returns_empty_string(self):
        from src.brain.workspace import build_historical_context_block
        result = build_historical_context_block([])
        assert result == ""

    def test_block_contains_header(self):
        from src.brain.workspace import build_historical_context_block
        snips = [{"role": "user", "content": "Hello from the past", "turn_index": 1}]
        result = build_historical_context_block(snips)
        assert "[HISTORICAL CONTEXT]" in result

    def test_block_contains_content(self):
        from src.brain.workspace import build_historical_context_block
        snips = [
            {"role": "user", "content": "What is 2+2?", "turn_index": 1},
            {"role": "assistant", "content": "It is 4.", "turn_index": 2},
        ]
        result = build_historical_context_block(snips)
        assert "What is 2+2?" in result
        assert "It is 4." in result


class TestSnipCompactorCompact:
    @pytest.mark.asyncio
    async def test_compact_noop_when_not_enough_messages(self):
        """When messages <= preserve_recent, nothing archived."""
        from src.brain.compaction import SnipCompactor

        mock_msgs = [MagicMock(id=i, role="human", content=f"msg {i}", tokens=10,
                               created_at=datetime.now(timezone.utc)) for i in range(2)]
        session = AsyncMock()
        exec_result = MagicMock()
        exec_result.scalars.return_value.all.return_value = mock_msgs
        session.execute = AsyncMock(return_value=exec_result)
        session.add = MagicMock()
        session.commit = AsyncMock()
        session.__aenter__ = AsyncMock(return_value=session)
        session.__aexit__ = AsyncMock(return_value=False)

        with patch("src.brain.compaction.get_session", return_value=session):
            compactor = SnipCompactor(
                thread_id="thread-1",
                agent_id="agent-1",
                preserve_recent=3,
            )
            archived = await compactor.compact()

        assert archived == 0
        session.add.assert_not_called()

    @pytest.mark.asyncio
    async def test_compact_archives_older_messages(self):
        """When 8 messages exist and preserve_recent=3, 5 should be archived."""
        from src.brain.compaction import SnipCompactor

        mock_msgs = [MagicMock(id=i, role="human", content=f"msg {i}", tokens=10,
                               created_at=datetime.now(timezone.utc)) for i in range(8)]
        session = AsyncMock()
        exec_result = MagicMock()
        exec_result.scalars.return_value.all.return_value = mock_msgs
        del_result = MagicMock()
        session.execute = AsyncMock(side_effect=[exec_result, del_result])
        session.add = MagicMock()
        session.commit = AsyncMock()
        session.__aenter__ = AsyncMock(return_value=session)
        session.__aexit__ = AsyncMock(return_value=False)

        with patch("src.brain.compaction.get_session", return_value=session):
            compactor = SnipCompactor(
                thread_id="thread-1",
                agent_id="agent-1",
                preserve_recent=3,
            )
            archived = await compactor.compact()

        # 8 - 3 = 5 archived
        assert archived == 5
        assert session.add.call_count == 5


class TestSnipSelectorTokenCap:
    @pytest.mark.asyncio
    async def test_select_snips_respects_max_replay_via_recency_fallback(self):
        """When model call fails, recency fallback must respect max_replay."""
        from src.brain.compaction import SnipCompactor

        snips = [_mock_snip(i, token_count=10) for i in range(6)]
        session = _make_session_with_snips(snips)

        with patch("src.brain.compaction.get_session", return_value=session):
            compactor = SnipCompactor(
                thread_id="thread-1",
                agent_id="agent-1",
                preserve_recent=3,
            )
            result = await compactor.select_relevant_snips(
                current_message="help me",
                fast_model=None,
                max_replay=2,
                max_tokens=9999,
            )

        assert len(result) <= 2

    @pytest.mark.asyncio
    async def test_select_snips_respects_token_cap(self):
        """Token cap should limit the total token count of returned snips."""
        from src.brain.compaction import SnipCompactor

        # 5 snips, each 30 tokens — token cap of 50 allows at most 1 snip
        snips = [_mock_snip(i, token_count=30) for i in range(5)]
        session = _make_session_with_snips(snips)

        with patch("src.brain.compaction.get_session", return_value=session):
            compactor = SnipCompactor(
                thread_id="thread-1",
                agent_id="agent-1",
                preserve_recent=3,
            )
            result = await compactor.select_relevant_snips(
                current_message="help me",
                fast_model=None,
                max_replay=5,
                max_tokens=50,
            )

        total_tokens = sum(s.get("token_count", 0) for s in result)
        assert total_tokens <= 50

    @pytest.mark.asyncio
    async def test_select_snips_returns_empty_for_no_snips(self):
        from src.brain.compaction import SnipCompactor

        session = _make_session_with_snips([])

        with patch("src.brain.compaction.get_session", return_value=session):
            compactor = SnipCompactor(
                thread_id="thread-1",
                agent_id="agent-1",
                preserve_recent=3,
            )
            result = await compactor.select_relevant_snips(
                current_message="help",
                fast_model=None,
            )

        assert result == []


def _make_human_msg(content: str = "question"):
    from langchain_core.messages import HumanMessage
    return HumanMessage(content=content)


class TestBuildHistoricalContextBlock:
    def test_empty_snips_returns_empty_string(self):
        from src.brain.workspace import build_historical_context_block
        result = build_historical_context_block([])
        assert result == ""

    def test_block_contains_header(self):
        from src.brain.workspace import build_historical_context_block
        snips = [{"role": "user", "content": "Hello from the past", "turn_index": 1}]
        result = build_historical_context_block(snips)
        assert "[HISTORICAL CONTEXT]" in result

    def test_block_contains_content(self):
        from src.brain.workspace import build_historical_context_block
        snips = [
            {"role": "user", "content": "What is 2+2?", "turn_index": 1},
            {"role": "assistant", "content": "It is 4.", "turn_index": 1},
        ]
        result = build_historical_context_block(snips)
        assert "What is 2+2?" in result
        assert "It is 4." in result


class TestSnipCompactorCompact:
    @pytest.mark.asyncio
    async def test_compact_archives_old_messages(self):
        from src.brain.compaction import SnipCompactor
        from unittest.mock import patch, MagicMock, AsyncMock
        from sqlalchemy.ext.asyncio import AsyncSession

        preserve_recent = 3
        compactor = SnipCompactor(
            thread_id="thread-1",
            agent_id="agent-1",
            preserve_recent=preserve_recent,
        )

        # compact() returns number archived — it uses get_session internally
        mock_cm = MagicMock()
        mock_session = AsyncMock(spec=AsyncSession)
        # Simulate 8 messages: scalars().all() returns 8 message-like objects
        msgs = [MagicMock(id=i, role="user", content=f"msg {i}", tokens=10, created_at=i) for i in range(8)]
        exec_result = MagicMock()
        exec_result.scalars.return_value.all.return_value = msgs
        mock_session.execute = AsyncMock(return_value=exec_result)
        mock_session.add = MagicMock()
        mock_session.commit = AsyncMock()
        mock_cm.__aenter__ = AsyncMock(return_value=mock_session)
        mock_cm.__aexit__ = AsyncMock(return_value=False)

        with patch("src.brain.compaction.get_session", return_value=mock_cm):
            archived = await compactor.compact()

        # 8 messages - 3 preserve_recent = 5 archived
        assert archived == 5

    @pytest.mark.asyncio
    async def test_compact_noop_when_not_enough_messages(self):
        from src.brain.compaction import SnipCompactor
        from unittest.mock import patch, MagicMock, AsyncMock
        from sqlalchemy.ext.asyncio import AsyncSession

        preserve_recent = 3
        compactor = SnipCompactor(
            thread_id="thread-1",
            agent_id="agent-1",
            preserve_recent=preserve_recent,
        )

        mock_cm = MagicMock()
        mock_session = AsyncMock(spec=AsyncSession)
        # Only 2 messages — below preserve_recent=3
        msgs = [MagicMock(id=i, role="user", content=f"msg {i}", tokens=10, created_at=i) for i in range(2)]
        exec_result = MagicMock()
        exec_result.scalars.return_value.all.return_value = msgs
        mock_session.execute = AsyncMock(return_value=exec_result)
        mock_session.add = MagicMock()
        mock_session.commit = AsyncMock()
        mock_cm.__aenter__ = AsyncMock(return_value=mock_session)
        mock_cm.__aexit__ = AsyncMock(return_value=False)

        with patch("src.brain.compaction.get_session", return_value=mock_cm):
            archived = await compactor.compact()

        # Not enough to archive — 0 archived
        assert archived == 0
        mock_session.add.assert_not_called()


class TestSnipSelectorTokenCap:
    @pytest.mark.asyncio
    async def test_select_snips_respects_token_cap(self):
        from src.brain.compaction import SnipCompactor
        from unittest.mock import patch, MagicMock, AsyncMock

        compactor = SnipCompactor(
            thread_id="thread-1",
            agent_id="agent-1",
            preserve_recent=3,
        )

        # select_relevant_snips fetches from DB when called with current_message str
        snips_rows = [
            MagicMock(role="user", content="A" * 100, token_count=25, turn_index=i)
            for i in range(5)
        ]
        mock_cm = MagicMock()
        mock_session = AsyncMock()
        exec_result = MagicMock()
        exec_result.scalars.return_value.all.return_value = snips_rows
        mock_session.execute = AsyncMock(return_value=exec_result)
        mock_cm.__aenter__ = AsyncMock(return_value=mock_session)
        mock_cm.__aexit__ = AsyncMock(return_value=False)

        # Token cap of 50 should limit to at most 2 snips (25 each)
        with patch("src.brain.compaction.get_session", return_value=mock_cm):
            selected = await compactor.select_relevant_snips(
                current_message="help",
                fast_model=None,
                max_tokens=50,
            )
        total_tokens = sum(s.get("token_count", 0) for s in selected)
        assert total_tokens <= 50

    @pytest.mark.asyncio
    async def test_select_snips_max_replay_limit(self):
        from src.brain.compaction import SnipCompactor
        from unittest.mock import patch, MagicMock, AsyncMock

        compactor = SnipCompactor(
            thread_id="thread-1",
            agent_id="agent-1",
            preserve_recent=3,
        )

        snips_rows = [
            MagicMock(role="user", content=f"msg {i}", token_count=10, turn_index=i)
            for i in range(6)
        ]
        mock_cm = MagicMock()
        mock_session = AsyncMock()
        exec_result = MagicMock()
        exec_result.scalars.return_value.all.return_value = snips_rows
        mock_session.execute = AsyncMock(return_value=exec_result)
        mock_cm.__aenter__ = AsyncMock(return_value=mock_session)
        mock_cm.__aexit__ = AsyncMock(return_value=False)

        with patch("src.brain.compaction.get_session", return_value=mock_cm):
            selected = await compactor.select_relevant_snips(
                current_message="question",
                fast_model=None,
                max_replay=2,
                max_tokens=9999,
            )
        assert len(selected) <= 2
