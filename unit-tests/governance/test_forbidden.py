"""Unit tests — governance: forbidden tool blocking."""
from __future__ import annotations

import pytest
from unittest.mock import patch, MagicMock

from langchain_core.messages import AIMessage


def _make_ai_with_tool_calls(*tool_names: str):
    """Build an AIMessage with the given tool calls."""
    tool_calls = [{"name": n, "id": n, "args": {}} for n in tool_names]
    msg = AIMessage(content="", tool_calls=tool_calls)
    return msg


def _make_state(agent_id: str, *tool_names: str, forbidden: list[str] | None = None):
    from src.brain.state import AgentState

    messages = []
    if tool_names:
        messages.append(_make_ai_with_tool_calls(*tool_names))

    state = AgentState(agent_id=agent_id, thread_id="t1", messages=messages)
    return state, forbidden or []


class TestCheckForbidden:
    def _mock_cfg(self, forbidden: list[str]):
        cfg = MagicMock()
        agent = MagicMock()
        agent.forbidden_tools = forbidden
        cfg.agents.get.return_value = agent
        return cfg

    def test_blocks_forbidden_tool(self):
        from src.brain.governance.forbidden import check_forbidden

        state, _ = _make_state("maya", "shell", "write_file")

        with patch("src.brain.governance.forbidden.get_cached_config", return_value=self._mock_cfg(["shell"])):
            result = check_forbidden(state)

        assert result.get("finished") is True
        assert "shell" in result.get("error", "")

    def test_allows_non_forbidden_tool(self):
        from src.brain.governance.forbidden import check_forbidden

        state, _ = _make_state("maya", "read_file")

        with patch("src.brain.governance.forbidden.get_cached_config", return_value=self._mock_cfg(["shell"])):
            result = check_forbidden(state)

        assert result == {}

    def test_no_tool_calls_passes_through(self):
        from src.brain.governance.forbidden import check_forbidden
        from src.brain.state import AgentState

        state = AgentState(agent_id="maya", thread_id="t1", messages=[])

        with patch("src.brain.governance.forbidden.get_cached_config", return_value=self._mock_cfg(["shell"])):
            result = check_forbidden(state)

        assert result == {}

    def test_unknown_agent_passes_through(self):
        from src.brain.governance.forbidden import check_forbidden

        state, _ = _make_state("mystery-agent", "shell")
        cfg = MagicMock()
        cfg.agents.get.return_value = None

        with patch("src.brain.governance.forbidden.get_cached_config", return_value=cfg):
            result = check_forbidden(state)

        assert result == {}

    def test_multiple_forbidden_tools_all_reported(self):
        from src.brain.governance.forbidden import check_forbidden

        state, _ = _make_state("maya", "shell", "delete_file")

        with patch("src.brain.governance.forbidden.get_cached_config",
                   return_value=self._mock_cfg(["shell", "delete_file"])):
            result = check_forbidden(state)

        assert result.get("finished") is True
        error = result.get("error", "")
        assert "shell" in error
        assert "delete_file" in error

    def test_config_exception_passes_through(self):
        from src.brain.governance.forbidden import check_forbidden

        state, _ = _make_state("maya", "shell")

        with patch("src.brain.governance.forbidden.get_cached_config", side_effect=RuntimeError("cfg broken")):
            result = check_forbidden(state)

        assert result == {}
