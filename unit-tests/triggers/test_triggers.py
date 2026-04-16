"""Unit tests — brain triggers (cron.execution and arousal.proactive_wake).

Acceptance criteria:
  - cron.execution with valid agent_id invokes _invoke_internal with channel='cron'
  - cron.execution without agent_id does NOT invoke
  - cron.execution uses payload task text as message when present
  - cron.execution falls back to generic message when task absent
  - cron.execution exception is caught and does not propagate
  - arousal.proactive_wake with valid agent_id invokes _invoke_internal with channel='arousal'
  - arousal.proactive_wake without agent_id does NOT invoke
  - arousal.proactive_wake includes reason and score in message
  - arousal.proactive_wake exception is caught and does not propagate
  - register_trigger_subscribers subscribes both lanes
"""
from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, MagicMock, patch, call


# ---------------------------------------------------------------------------
# S-TRG-1: _handle_cron_execution
# ---------------------------------------------------------------------------
class TestHandleCronExecution:
    @pytest.mark.asyncio
    async def test_invokes_with_correct_channel(self):
        from src.brain.triggers import _handle_cron_execution
        invoke_mock = AsyncMock(return_value="")
        with patch("src.brain.triggers._handle_cron_execution.__module__"), \
             patch("src.brain.routers.invoke._invoke_internal", invoke_mock):
            # Patch inside the module under test
            with patch("src.brain.triggers._invoke_internal", invoke_mock, create=True):
                pass

        # Import fresh with the invoke patched at the right path
        import importlib
        import src.brain.triggers as trig
        importlib.reload(trig)

        invoke_mock = AsyncMock(return_value="")
        with patch("src.brain.triggers._handle_cron_execution",
                   wraps=trig._handle_cron_execution) as _w:
            # Directly patch the lazy import inside the function
            with patch("src.brain.routers.invoke._invoke_internal", invoke_mock):
                await trig._handle_cron_execution({
                    "agent_id": "maya",
                    "cron_name": "daily-digest",
                    "task": "Send daily summary",
                })

        invoke_mock.assert_awaited_once()
        kw = invoke_mock.call_args[1]
        assert kw["agent_id"] == "maya"
        assert kw["channel"] == "cron"
        assert kw["sender"] == "system"
        assert kw["thread_id"] == "cron:maya:daily-digest"

    @pytest.mark.asyncio
    async def test_uses_task_text_as_message(self):
        import src.brain.triggers as trig
        invoke_mock = AsyncMock(return_value="")
        with patch("src.brain.routers.invoke._invoke_internal", invoke_mock):
            await trig._handle_cron_execution({
                "agent_id": "maya",
                "cron_name": "digest",
                "task": "Send the daily report",
            })
        assert "Send the daily report" in invoke_mock.call_args[1]["message"]

    @pytest.mark.asyncio
    async def test_fallback_message_when_no_task(self):
        import src.brain.triggers as trig
        invoke_mock = AsyncMock(return_value="")
        with patch("src.brain.routers.invoke._invoke_internal", invoke_mock):
            await trig._handle_cron_execution({"agent_id": "maya", "cron_name": "noop"})
        msg = invoke_mock.call_args[1]["message"]
        assert "noop" in msg

    @pytest.mark.asyncio
    async def test_missing_agent_id_does_not_invoke(self):
        import src.brain.triggers as trig
        invoke_mock = AsyncMock(return_value="")
        with patch("src.brain.routers.invoke._invoke_internal", invoke_mock):
            await trig._handle_cron_execution({"cron_name": "orphan"})
        invoke_mock.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_invoke_exception_is_caught(self):
        import src.brain.triggers as trig
        invoke_mock = AsyncMock(side_effect=RuntimeError("graph down"))
        with patch("src.brain.routers.invoke._invoke_internal", invoke_mock):
            # Must not raise
            await trig._handle_cron_execution({"agent_id": "maya", "cron_name": "x"})


# ---------------------------------------------------------------------------
# S-TRG-2: _handle_proactive_wake
# ---------------------------------------------------------------------------
class TestHandleProactiveWake:
    @pytest.mark.asyncio
    async def test_invokes_with_correct_channel(self):
        import src.brain.triggers as trig
        invoke_mock = AsyncMock(return_value="")
        with patch("src.brain.routers.invoke._invoke_internal", invoke_mock):
            await trig._handle_proactive_wake({
                "agent_id": "maya",
                "trigger_reason": "idle_with_pending_tasks",
                "arousal_score": 0.85,
            })
        kw = invoke_mock.call_args[1]
        assert kw["agent_id"] == "maya"
        assert kw["channel"] == "arousal"
        assert kw["sender"] == "system"
        assert kw["thread_id"] == "arousal:maya:proactive"

    @pytest.mark.asyncio
    async def test_message_includes_reason_and_score(self):
        import src.brain.triggers as trig
        invoke_mock = AsyncMock(return_value="")
        with patch("src.brain.routers.invoke._invoke_internal", invoke_mock):
            await trig._handle_proactive_wake({
                "agent_id": "maya",
                "trigger_reason": "idle_with_pending_tasks",
                "arousal_score": 0.75,
            })
        msg = invoke_mock.call_args[1]["message"]
        assert "idle_with_pending_tasks" in msg
        assert "0.75" in msg

    @pytest.mark.asyncio
    async def test_missing_agent_id_does_not_invoke(self):
        import src.brain.triggers as trig
        invoke_mock = AsyncMock(return_value="")
        with patch("src.brain.routers.invoke._invoke_internal", invoke_mock):
            await trig._handle_proactive_wake({"trigger_reason": "orphan"})
        invoke_mock.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_invoke_exception_is_caught(self):
        import src.brain.triggers as trig
        invoke_mock = AsyncMock(side_effect=RuntimeError("graph down"))
        with patch("src.brain.routers.invoke._invoke_internal", invoke_mock):
            await trig._handle_proactive_wake({"agent_id": "maya", "trigger_reason": "test"})


# ---------------------------------------------------------------------------
# S-TRG-3: register_trigger_subscribers
# ---------------------------------------------------------------------------
class TestRegisterTriggerSubscribers:
    def test_subscribes_both_lanes(self):
        import src.brain.triggers as trig
        subscribed: dict[str, list] = {}

        def fake_subscribe(lane, handler):
            subscribed.setdefault(lane, []).append(handler)

        # subscribe is imported lazily inside register_trigger_subscribers,
        # so patch the source — src.brain.events.subscribe.
        with patch("src.brain.events.subscribe", fake_subscribe):
            trig.register_trigger_subscribers()

        assert "cron.execution" in subscribed
        assert "arousal.proactive_wake" in subscribed
        assert subscribed["cron.execution"][0] is trig._handle_cron_execution
        assert subscribed["arousal.proactive_wake"][0] is trig._handle_proactive_wake
