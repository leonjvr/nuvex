"""Unit tests — events: subscribe/publish (in-memory), failure classification."""
from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, MagicMock, patch


from src.brain.events import subscribe, _subscriptions, _classify_failure_class


@pytest.fixture(autouse=True)
def clear_subscriptions():
    _subscriptions.clear()
    yield
    _subscriptions.clear()


# ---------------------------------------------------------------------------
# subscribe / fan-out (in-memory only — DB mocked)
# ---------------------------------------------------------------------------

class TestSubscribePublish:
    @pytest.mark.asyncio
    async def test_subscriber_receives_published_payload(self):
        from src.brain.events import publish

        received = []

        async def handler(payload):
            received.append(payload)

        subscribe("test.lane", handler)

        mock_event = MagicMock()
        mock_event.status = "pending"

        session = AsyncMock()
        session.add = MagicMock()
        session.commit = AsyncMock()
        session.get = AsyncMock(return_value=mock_event)
        session.__aenter__ = AsyncMock(return_value=session)
        session.__aexit__ = AsyncMock(return_value=False)

        with patch("src.brain.events.get_session", return_value=session):
            await publish("test.lane", {"key": "value"}, agent_id="maya")

        assert len(received) == 1
        assert received[0]["key"] == "value"

    @pytest.mark.asyncio
    async def test_multiple_subscribers_all_called(self):
        from src.brain.events import publish

        calls = []

        async def h1(p):
            calls.append("h1")

        async def h2(p):
            calls.append("h2")

        subscribe("multi.lane", h1)
        subscribe("multi.lane", h2)

        mock_event = MagicMock()
        mock_event.status = "pending"

        session = AsyncMock()
        session.add = MagicMock()
        session.commit = AsyncMock()
        session.get = AsyncMock(return_value=mock_event)
        session.__aenter__ = AsyncMock(return_value=session)
        session.__aexit__ = AsyncMock(return_value=False)

        with patch("src.brain.events.get_session", return_value=session):
            await publish("multi.lane", {})

        assert set(calls) == {"h1", "h2"}

    @pytest.mark.asyncio
    async def test_no_subscribers_does_not_error(self):
        from src.brain.events import publish

        mock_event = MagicMock()
        mock_event.status = "pending"

        session = AsyncMock()
        session.add = MagicMock()
        session.commit = AsyncMock()
        session.get = AsyncMock(return_value=mock_event)
        session.__aenter__ = AsyncMock(return_value=session)
        session.__aexit__ = AsyncMock(return_value=False)

        with patch("src.brain.events.get_session", return_value=session):
            await publish("empty.lane", {"x": 1})  # should not raise

    @pytest.mark.asyncio
    async def test_failing_handler_does_not_stop_others(self):
        from src.brain.events import publish

        calls = []

        async def bad(p):
            raise RuntimeError("bad handler")

        async def good(p):
            calls.append("good")

        subscribe("mixed.lane", bad)
        subscribe("mixed.lane", good)

        mock_event = MagicMock()
        mock_event.status = "pending"
        mock_event.failure_class = None

        session = AsyncMock()
        session.add = MagicMock()
        session.commit = AsyncMock()
        session.get = AsyncMock(return_value=mock_event)
        session.__aenter__ = AsyncMock(return_value=session)
        session.__aexit__ = AsyncMock(return_value=False)

        with patch("src.brain.events.get_session", return_value=session):
            await publish("mixed.lane", {})

        assert "good" in calls


# ---------------------------------------------------------------------------
# _classify_failure_class
# ---------------------------------------------------------------------------

class TestClassifyFailureClass:
    def test_401_is_permanent(self):
        result = _classify_failure_class({"status": "error", "http_status": 401})
        assert result == "permanent"

    def test_429_is_transient(self):
        result = _classify_failure_class({"status": "error", "http_status": 429})
        assert result in ("transient", "degraded")

    def test_timeout_is_transient(self):
        result = _classify_failure_class({"status": "error", "error": "connection timeout"})
        assert result == "transient"

    def test_503_is_transient(self):
        # 5xx server errors are classified as transient (retry-able)
        result = _classify_failure_class({"status": "error", "http_status": 503})
        assert result == "transient"

    def test_unknown_error_is_unknown(self):
        result = _classify_failure_class({"status": "error", "error": "mysterious failure xyz"})
        assert result == "unknown"

    def test_auto_classification_on_publish(self):
        """publish() should auto-classify failure_class when status=error."""
        from src.brain.events import publish

        captured_events = []

        class CaptureMeta:
            """Mock session that captures the Event object passed to session.add()."""

        mock_event_obj = None

        session = AsyncMock()

        def capture_add(obj):
            nonlocal mock_event_obj
            mock_event_obj = obj

        session.add = MagicMock(side_effect=capture_add)
        session.commit = AsyncMock()
        mock_db_event = MagicMock()
        mock_db_event.status = "pending"
        session.get = AsyncMock(return_value=mock_db_event)
        session.__aenter__ = AsyncMock(return_value=session)
        session.__aexit__ = AsyncMock(return_value=False)

        import asyncio

        async def run():
            with patch("src.brain.events.get_session", return_value=session):
                await publish(
                    "llm.invocation",
                    {"status": "error", "error": "timeout"},
                    agent_id="maya",
                )

        asyncio.get_event_loop().run_until_complete(run())

        # The Event added to session should have a failure_class set
        assert mock_event_obj is not None
        assert mock_event_obj.failure_class is not None
