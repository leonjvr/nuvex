"""Unit tests — A2A (agent-to-agent) delegation via DelegateToAgentTool.

Coverage:
  DelegateToAgentTool._arun
    - happy path: returns "[target_id] <reply>"
    - caller identity is forwarded to _invoke_internal
    - thread_id forwarded when provided
    - empty thread_id coerced to None
    - exception from _invoke_internal surfaces as "[error]" prefix
    - _run (sync shim) delegates to _arun via asyncio.run
  get_tools_for_agent
    - T1 agent includes delegate_to_agent
    - T2 agent excludes delegate_to_agent
    - delegate tool on T1 agent has _caller_agent_id set correctly
  _invoke_internal (via integration contract)
    - persists delegation thread with delegated=True in metadata
    - returns reply text extracted from final state messages
"""
from __future__ import annotations

import asyncio
import sys
import types
from unittest.mock import AsyncMock, MagicMock, patch, call

import pytest

# ── stub problematic optional deps ───────────────────────────────────────────
for _mod in ("aioimaplib", "aiosmtplib"):
    sys.modules.setdefault(_mod, types.ModuleType(_mod))


# Patch target: delegate_tool imports _invoke_internal via a local import
# from ..routers.invoke import _invoke_internal
# We patch at the *source* module since delegate_tool re-imports inside _arun.
_INVOKE_INTERNAL = "src.brain.routers.invoke._invoke_internal"


# =============================================================================
# DelegateToAgentTool._arun
# =============================================================================

class TestDelegateToAgentTool:
    def _tool(self, caller: str | None = None):
        from src.brain.tools.delegate_tool import DelegateToAgentTool
        t = DelegateToAgentTool()
        if caller:
            t._caller_agent_id = caller  # type: ignore[attr-defined]
        return t

    async def test_happy_path_returns_prefixed_reply(self):
        """Reply is wrapped with [<agent_id>] prefix — checks the '[agent_id] reply' format."""
        from src.brain.tools.delegate_tool import DelegateToAgentTool
        tool = DelegateToAgentTool()
        tool._caller_agent_id = "maya"  # type: ignore[attr-defined]

        mock_invoke = AsyncMock(return_value="four")
        with patch(_INVOKE_INTERNAL, mock_invoke):
            result = await tool._arun("research", "what is 2+2?", "")

        assert result == "[research] four"

    async def test_happy_path_calls_invoke_internal(self):
        """_invoke_internal is called for every delegation request."""
        tool = self._tool(caller="maya")
        mock_invoke = AsyncMock(return_value="pong")
        with patch(_INVOKE_INTERNAL, mock_invoke):
            await tool._arun("research", "ping", "")
        assert mock_invoke.called

        mock_invoke = AsyncMock(return_value="ok")
        with patch("src.brain.routers.invoke._invoke_internal", mock_invoke):
            await tool._arun("research", "hello", "existing-thread-123")

        _, kwargs = mock_invoke.call_args
        assert kwargs.get("thread_id") == "existing-thread-123"

    async def test_empty_thread_id_becomes_none(self):
        """Empty string thread_id is coerced to None so _invoke_internal creates a new thread."""
        from src.brain.tools.delegate_tool import DelegateToAgentTool

        tool = DelegateToAgentTool()
        tool._caller_agent_id = "maya"  # type: ignore[attr-defined]

        mock_invoke = AsyncMock(return_value="ok")
        with patch("src.brain.routers.invoke._invoke_internal", mock_invoke):
            await tool._arun("research", "hello", "")

        _, kwargs = mock_invoke.call_args
        assert kwargs.get("thread_id") is None

    async def test_invoke_internal_exception_returns_error_prefix(self):
        """Exceptions from _invoke_internal become '[error] delegation to <id> failed: …'."""
        from src.brain.tools.delegate_tool import DelegateToAgentTool

        tool = DelegateToAgentTool()
        tool._caller_agent_id = "maya"  # type: ignore[attr-defined]

        mock_invoke = AsyncMock(side_effect=RuntimeError("network timeout"))
        with patch("src.brain.routers.invoke._invoke_internal", mock_invoke):
            result = await tool._arun("research", "hello", "")

        assert result.startswith("[error]")
        assert "research" in result
        assert "network timeout" in result

    def test_sync_run_returns_result(self):
        """The sync _run shim returns the same result as _arun via asyncio.run."""
        from src.brain.tools.delegate_tool import DelegateToAgentTool

        tool = DelegateToAgentTool()
        tool._caller_agent_id = "maya"  # type: ignore[attr-defined]

        mock_invoke = AsyncMock(return_value="sync result")
        with patch("src.brain.routers.invoke._invoke_internal", mock_invoke):
            result = tool._run("research", "hello", "")

        assert result == "[research] sync result"

    async def test_no_caller_set_still_works(self):
        """When _caller_agent_id is not set, delegation still succeeds with caller=None."""
        from src.brain.tools.delegate_tool import DelegateToAgentTool

        tool = DelegateToAgentTool()  # no _caller_agent_id set

        mock_invoke = AsyncMock(return_value="response without caller")
        with patch("src.brain.routers.invoke._invoke_internal", mock_invoke):
            result = await tool._arun("research", "hello", "")

        assert result == "[research] response without caller"
        _, kwargs = mock_invoke.call_args
        assert kwargs.get("caller_agent_id") is None


# =============================================================================
# get_tools_for_agent — tier filtering for delegation
# =============================================================================

# get_cached_config is a *local import* inside get_tools_for_agent, so the
# correct patch target is the canonical module, not tools_registry.
_GET_CACHED_CFG = "src.shared.config.get_cached_config"
_MCP_LOADER = "src.brain.tools_registry.load_mcp_tools_for_agent"


class TestGetToolsForAgentDelegation:
    """T1 gets delegate_to_agent; T2 does not; caller identity is injected."""

    def _mock_config(self, tier: str):
        cfg = MagicMock()
        agent_def = MagicMock()
        agent_def.tier = tier
        agent_def.mcp_servers = {}
        cfg.agents = {"maya": agent_def, "research": MagicMock(tier="T2", mcp_servers={})}
        return cfg

    async def test_t1_agent_has_delegate_tool(self):
        cfg = self._mock_config("T1")
        with (
            patch(_GET_CACHED_CFG, return_value=cfg),
            patch(_MCP_LOADER, AsyncMock(return_value=[])),
        ):
            from src.brain.tools_registry import get_tools_for_agent
            tools = await get_tools_for_agent("maya")

        names = {t.name for t in tools}
        assert "delegate_to_agent" in names

    async def test_t2_agent_lacks_delegate_tool(self):
        cfg = self._mock_config("T2")
        with patch(_GET_CACHED_CFG, return_value=cfg):
            from src.brain.tools_registry import get_tools_for_agent
            tools = await get_tools_for_agent("research")

        names = {t.name for t in tools}
        assert "delegate_to_agent" not in names

    async def test_delegate_tool_has_caller_set(self):
        """The delegate_tool instance returned for T1 has _caller_agent_id == agent_id."""
        cfg = self._mock_config("T1")
        with (
            patch(_GET_CACHED_CFG, return_value=cfg),
            patch(_MCP_LOADER, AsyncMock(return_value=[])),
        ):
            from src.brain.tools_registry import get_tools_for_agent
            tools = await get_tools_for_agent("maya")

        delegate = next((t for t in tools if t.name == "delegate_to_agent"), None)
        assert delegate is not None
        assert getattr(delegate, "_caller_agent_id", None) == "maya"

    async def test_t2_research_has_no_delegate(self):
        """T2 agent excludes delegate tool regardless of name."""
        cfg = self._mock_config("T2")
        with patch(_GET_CACHED_CFG, return_value=cfg):
            from src.brain.tools_registry import get_tools_for_agent
            tools = await get_tools_for_agent("research")

        assert not any(t.name == "delegate_to_agent" for t in tools)


# =============================================================================
# _invoke_internal — delegation metadata + reply extraction
# =============================================================================

async def _fake_queue(agent_id: str, fn):
    """Replacement for queue_invocation that just awaits fn() directly."""
    return await fn()


class TestInvokeInternal:
    """_invoke_internal populates the delegation thread correctly."""

    @pytest.fixture()
    def mock_graph_and_state(self):
        from langchain_core.messages import AIMessage

        final_state = {
            "messages": [
                AIMessage(content="The answer is 4.", id="ai-1", type="ai"),
            ],
            "finished": True,
            "error": None,
            "tokens_used": 10,
        }
        mock_graph = MagicMock()
        mock_graph.ainvoke = AsyncMock(return_value=final_state)
        return mock_graph, final_state

    async def test_returns_ai_reply_text(self, mock_graph_and_state):
        mock_graph, _ = mock_graph_and_state

        with (
            patch("src.brain.routers.invoke.get_compiled_graph", return_value=mock_graph),
            patch("src.brain.routers.invoke.queue_invocation", new=_fake_queue),
            patch("src.brain.routers.invoke._persist_invocation", new=AsyncMock()),
        ):
            from src.brain.routers.invoke import _invoke_internal
            result = await _invoke_internal(
                agent_id="research",
                message="what is 2+2?",
                caller_agent_id="maya",
            )

        assert result == "The answer is 4."

    async def test_persist_called_with_delegated_true(self, mock_graph_and_state):
        mock_graph, _ = mock_graph_and_state

        persist_mock = AsyncMock()
        with (
            patch("src.brain.routers.invoke.get_compiled_graph", return_value=mock_graph),
            patch("src.brain.routers.invoke.queue_invocation", new=_fake_queue),
            patch("src.brain.routers.invoke._persist_invocation", new=persist_mock),
        ):
            from src.brain.routers.invoke import _invoke_internal
            await _invoke_internal(
                agent_id="research",
                message="what is 2+2?",
                caller_agent_id="maya",
            )

        assert persist_mock.called
        call_kwargs = persist_mock.call_args.kwargs
        assert call_kwargs.get("metadata", {}).get("delegated") is True
        assert call_kwargs.get("metadata", {}).get("caller_agent_id") == "maya"

    async def test_persist_sender_is_caller_agent(self, mock_graph_and_state):
        mock_graph, _ = mock_graph_and_state

        persist_mock = AsyncMock()
        with (
            patch("src.brain.routers.invoke.get_compiled_graph", return_value=mock_graph),
            patch("src.brain.routers.invoke.queue_invocation", new=_fake_queue),
            patch("src.brain.routers.invoke._persist_invocation", new=persist_mock),
        ):
            from src.brain.routers.invoke import _invoke_internal
            await _invoke_internal(
                agent_id="research",
                message="delegate me",
                caller_agent_id="maya",
            )

        call_kwargs = persist_mock.call_args.kwargs
        assert call_kwargs.get("sender") == "maya"

    async def test_empty_messages_returns_empty_string(self):
        """If no AI message is in the final state, returns empty string (does not crash)."""
        final_state = {"messages": [], "finished": True, "error": None, "tokens_used": 0}
        mock_graph = MagicMock()
        mock_graph.ainvoke = AsyncMock(return_value=final_state)

        with (
            patch("src.brain.routers.invoke.get_compiled_graph", return_value=mock_graph),
            patch("src.brain.routers.invoke.queue_invocation", new=_fake_queue),
            patch("src.brain.routers.invoke._persist_invocation", new=AsyncMock()),
        ):
            from src.brain.routers.invoke import _invoke_internal
            result = await _invoke_internal("research", "hello")

        assert result == ""

    async def test_channel_is_delegation(self, mock_graph_and_state):
        """Channel is always 'delegation' for A2A calls."""
        mock_graph, _ = mock_graph_and_state
        persist_mock = AsyncMock()

        with (
            patch("src.brain.routers.invoke.get_compiled_graph", return_value=mock_graph),
            patch("src.brain.routers.invoke.queue_invocation", new=_fake_queue),
            patch("src.brain.routers.invoke._persist_invocation", new=persist_mock),
        ):
            from src.brain.routers.invoke import _invoke_internal
            await _invoke_internal("research", "hello", caller_agent_id="maya")

        call_kwargs = persist_mock.call_args.kwargs
        assert call_kwargs.get("channel") == "delegation"
