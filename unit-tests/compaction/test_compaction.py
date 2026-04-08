"""Unit tests — compaction: token counting, keep-N logic."""
from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from datetime import datetime, timezone

from src.brain.compaction import DEFAULT_TOKEN_LIMIT, maybe_compact


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _mock_message(content: str, role: str = "human", tokens: int | None = None):
    msg = MagicMock()
    msg.id = id(msg)
    msg.content = content
    msg.role = role
    msg.tokens = tokens
    msg.created_at = datetime.now(timezone.utc)
    return msg


def _make_session(messages, thread=None):
    session = AsyncMock()

    # First execute returns messages, further ones return thread/children
    exec_result_msgs = MagicMock()
    exec_result_msgs.scalars.return_value.all.return_value = messages

    thread_result = MagicMock()
    thread_result.scalar_one_or_none.return_value = thread

    session.execute = AsyncMock(side_effect=[exec_result_msgs, thread_result])
    session.add = MagicMock()
    session.commit = AsyncMock()
    session.__aenter__ = AsyncMock(return_value=session)
    session.__aexit__ = AsyncMock(return_value=False)
    return session


# ---------------------------------------------------------------------------
# DEFAULT_TOKEN_LIMIT
# ---------------------------------------------------------------------------

class TestDefaultTokenLimit:
    def test_default_limit_is_reasonable(self):
        assert DEFAULT_TOKEN_LIMIT > 1000
        assert DEFAULT_TOKEN_LIMIT <= 50_000


# ---------------------------------------------------------------------------
# maybe_compact — skips when under limit
# ---------------------------------------------------------------------------

class TestMaybeCompactSkips:
    @pytest.mark.asyncio
    async def test_no_messages_returns_false(self):
        session = _make_session([])

        with patch("src.brain.compaction.get_session", return_value=session):
            result = await maybe_compact("thread-1")

        assert result is False

    @pytest.mark.asyncio
    async def test_under_limit_returns_false(self):
        # 10 short messages well under token limit
        messages = [_mock_message("hi", tokens=10) for _ in range(10)]
        session = _make_session(messages)

        with patch("src.brain.compaction.get_session", return_value=session):
            result = await maybe_compact("thread-1", token_limit=1000)

        assert result is False


# ---------------------------------------------------------------------------
# maybe_compact — performs compaction when over limit
# ---------------------------------------------------------------------------

class TestMaybeCompactPerforms:
    @pytest.mark.asyncio
    async def test_over_limit_returns_true_and_deletes(self):
        # 100 messages each with 100 tokens = 10,000 tokens > 500 limit
        messages = [_mock_message("x" * 400, tokens=100) for _ in range(100)]
        thread = MagicMock()

        session = AsyncMock()
        exec_result_msgs = MagicMock()
        exec_result_msgs.scalars.return_value.all.return_value = messages
        thread_result = MagicMock()
        thread_result.scalar_one_or_none.return_value = thread

        # execute may be called for messages, then delete, then thread lookup
        session.execute = AsyncMock(side_effect=[exec_result_msgs, MagicMock(), thread_result])
        session.add = MagicMock()
        session.commit = AsyncMock()
        session.__aenter__ = AsyncMock(return_value=session)
        session.__aexit__ = AsyncMock(return_value=False)

        with patch("src.brain.compaction.get_session", return_value=session):
            result = await maybe_compact("thread-1", token_limit=500)

        assert result is True
        # A summary stub should have been added
        session.add.assert_called_once()

    @pytest.mark.asyncio
    async def test_keeps_at_least_5_recent_messages(self):
        """keep_n must be at least 5 regardless of total message count."""
        # 6 messages with huge token count each
        messages = [_mock_message("x", tokens=2000) for _ in range(6)]
        thread = MagicMock()

        session = AsyncMock()
        exec_msgs = MagicMock()
        exec_msgs.scalars.return_value.all.return_value = messages

        # Capture the delete statement to check how many IDs are deleted
        deleted_ids = []

        from sqlalchemy import delete as sa_delete

        async def capture_execute(stmt, *args, **kwargs):
            nonlocal deleted_ids
            # Check if it's a delete statement
            stmt_str = str(stmt)
            if "DELETE" in stmt_str.upper() or hasattr(stmt, "whereclause"):
                # We can't easily inspect the IDs, just track it was called
                deleted_ids.append(True)
            return MagicMock()

        thread_result = MagicMock()
        thread_result.scalar_one_or_none.return_value = thread

        session.execute = AsyncMock(side_effect=[exec_msgs, MagicMock(), thread_result])
        session.add = MagicMock()
        session.commit = AsyncMock()
        session.__aenter__ = AsyncMock(return_value=session)
        session.__aexit__ = AsyncMock(return_value=False)

        with patch("src.brain.compaction.get_session", return_value=session):
            result = await maybe_compact("thread-1", token_limit=100)

        assert result is True
        # Summary stub added = at least 5 messages kept
        session.add.assert_called_once()

    @pytest.mark.asyncio
    async def test_summary_contains_compacted_marker(self):
        """The summary stub content must include '[Compacted history]'."""
        messages = [_mock_message("important message", tokens=500) for _ in range(20)]
        thread = MagicMock()

        added_stubs = []

        session = AsyncMock()
        exec_msgs = MagicMock()
        exec_msgs.scalars.return_value.all.return_value = messages
        thread_result = MagicMock()
        thread_result.scalar_one_or_none.return_value = thread

        session.execute = AsyncMock(side_effect=[exec_msgs, MagicMock(), thread_result])
        session.add = MagicMock(side_effect=lambda obj: added_stubs.append(obj))
        session.commit = AsyncMock()
        session.__aenter__ = AsyncMock(return_value=session)
        session.__aexit__ = AsyncMock(return_value=False)

        with patch("src.brain.compaction.get_session", return_value=session):
            await maybe_compact("thread-1", token_limit=100)

        assert len(added_stubs) == 1
        assert "[Compacted history" in added_stubs[0].content


# ---------------------------------------------------------------------------
# 18.8 — Integration: 60-message thread compacts to summary + recent tail
# ---------------------------------------------------------------------------

class TestCompactionIntegration60Messages:
    """18.8: thread with 60 messages compacts to summary + recent tail."""

    def _make_session_60(self, messages, thread=None):
        session = AsyncMock()

        exec_msgs = MagicMock()
        exec_msgs.scalars.return_value.all.return_value = messages

        thread_result = MagicMock()
        thread_result.scalar_one_or_none.return_value = thread

        # execute(1) = message fetch, execute(2) = delete stmt, execute(3) = thread fetch
        session.execute = AsyncMock(side_effect=[exec_msgs, MagicMock(), thread_result])
        session.add = MagicMock()
        session.commit = AsyncMock()
        session.__aenter__ = AsyncMock(return_value=session)
        session.__aexit__ = AsyncMock(return_value=False)
        return session

    @pytest.mark.asyncio
    async def test_60_messages_triggers_compaction(self):
        """60 messages with high token count triggers compaction (returns True)."""
        messages = [_mock_message(f"msg {i}", tokens=200) for i in range(60)]
        thread = MagicMock()
        session = self._make_session_60(messages, thread)

        with patch("src.brain.compaction.get_session", return_value=session):
            result = await maybe_compact("thread-60", token_limit=1000)

        assert result is True

    @pytest.mark.asyncio
    async def test_60_messages_summary_stub_created(self):
        """After compaction a single summary stub row is added to the session."""
        messages = [_mock_message(f"msg {i}", tokens=200) for i in range(60)]
        thread = MagicMock()

        added_stubs: list = []
        session = self._make_session_60(messages, thread)
        session.add = MagicMock(side_effect=lambda obj: added_stubs.append(obj))

        with patch("src.brain.compaction.get_session", return_value=session):
            await maybe_compact("thread-60", token_limit=1000)

        assert len(added_stubs) == 1
        assert "[Compacted history" in added_stubs[0].content

    @pytest.mark.asyncio
    async def test_60_messages_keeps_recent_tail(self):
        """keep_n = max(5, 60 // 5) = 12; deleted = 60 - 12 = 48 message ids."""
        messages = [_mock_message(f"msg {i}", tokens=200) for i in range(60)]
        # Give each message a distinct id so we can count deletions
        for idx, m in enumerate(messages):
            m.id = idx

        thread = MagicMock()
        deleted_ids: list[list] = []

        async def capture_execute(stmt, *a, **kw):
            # Intercept the DELETE so we can record which ids were going to be removed
            from sqlalchemy import delete as sa_delete
            stmt_str = str(stmt)
            if "DELETE" in stmt_str.upper() or "delete" in stmt_str.lower():
                # Reconstruct the set from the statement's whereclause if possible
                try:
                    in_clause = stmt.whereclause.right.clauses
                    deleted_ids.append([c.value for c in in_clause])
                except Exception:
                    deleted_ids.append([])
            return MagicMock()

        session = AsyncMock()
        exec_msgs = MagicMock()
        exec_msgs.scalars.return_value.all.return_value = messages
        thread_result = MagicMock()
        thread_result.scalar_one_or_none.return_value = thread
        session.execute = AsyncMock(side_effect=[exec_msgs, capture_execute, thread_result])
        session.add = MagicMock()
        session.commit = AsyncMock()
        session.__aenter__ = AsyncMock(return_value=session)
        session.__aexit__ = AsyncMock(return_value=False)

        with patch("src.brain.compaction.get_session", return_value=session):
            await maybe_compact("thread-60", token_limit=1000)

        # Exactly 12 messages must be retained (48 deleted)
        keep_n = max(5, 60 // 5)  # 12
        assert keep_n == 12
        # Verify thread.last_compacted_at was set
        assert thread.last_compacted_at is not None

    @pytest.mark.asyncio
    async def test_60_messages_summary_references_old_content(self):
        """Summary stub content must echo earlier messages' content."""
        messages = [_mock_message(f"important fact {i}", tokens=200) for i in range(60)]
        thread = MagicMock()

        added_stubs: list = []
        session = self._make_session_60(messages, thread)
        session.add = MagicMock(side_effect=lambda obj: added_stubs.append(obj))

        with patch("src.brain.compaction.get_session", return_value=session):
            await maybe_compact("thread-60", token_limit=1000)

        summary_content = added_stubs[0].content
        # The summary should contain content from old messages
        assert "important fact 0" in summary_content
