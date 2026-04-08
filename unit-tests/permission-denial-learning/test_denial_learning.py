"""Unit tests for permission denial learning (§32)."""
from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from datetime import datetime, timezone


def _make_state(**overrides):
    from src.brain.state import AgentState
    defaults = dict(
        agent_id="test-agent",
        thread_id="thread-1",
        denied_actions=[],
        invocation_id="inv-1",
    )
    defaults.update(overrides)
    return AgentState(**defaults)


def _ai_message_with_tool(tool_name: str):
    from langchain_core.messages import AIMessage
    return AIMessage(
        content="",
        tool_calls=[{"name": tool_name, "id": "tc-1", "args": {}}],
    )


class TestForbiddenDenialRecording:
    def test_forbidden_tool_appends_denied_action(self):
        from src.brain.governance.forbidden import check_forbidden
        state = _make_state()
        state.messages.append(_ai_message_with_tool("exec"))

        with patch("src.brain.governance.forbidden.get_cached_config") as mock_cfg:
            mock_cfg.return_value = MagicMock(
                agents={"test-agent": MagicMock(forbidden_tools=["exec"])}
            )
            result = check_forbidden(state)

        assert result.get("finished") is True
        denied = result.get("denied_actions", [])
        assert len(denied) == 1
        assert denied[0].tool_name == "exec"
        assert denied[0].governance_stage == "forbidden"

    def test_no_denial_when_not_forbidden(self):
        from src.brain.governance.forbidden import check_forbidden
        state = _make_state()
        state.messages.append(_ai_message_with_tool("web_fetch"))

        with patch("src.brain.governance.forbidden.get_cached_config") as mock_cfg:
            mock_cfg.return_value = MagicMock(
                agents={"test-agent": MagicMock(forbidden_tools=["exec"])}
            )
            result = check_forbidden(state)

        assert result == {}

    def test_multiple_denials_accumulate(self):
        from src.brain.governance.forbidden import check_forbidden
        from src.brain.models.denied_action import DeniedAction
        prior = DeniedAction(
            tool_name="shell",
            reason="forbidden",
            governance_stage="forbidden",
            timestamp=datetime.now(timezone.utc),
        )
        state = _make_state(denied_actions=[prior])
        state.messages.append(_ai_message_with_tool("exec"))

        with patch("src.brain.governance.forbidden.get_cached_config") as mock_cfg:
            mock_cfg.return_value = MagicMock(
                agents={"test-agent": MagicMock(forbidden_tools=["exec"])}
            )
            result = check_forbidden(state)

        denied = result.get("denied_actions", [])
        assert len(denied) == 2
        assert denied[0].tool_name == "shell"
        assert denied[1].tool_name == "exec"


class TestDeniedBlockInSystemPrompt:
    def test_denied_block_present_when_list_nonempty(self):
        from src.brain.workspace import _build_denied_block
        from src.brain.models.denied_action import DeniedAction
        denials = [
            DeniedAction(
                tool_name="exec",
                reason="in forbidden list",
                governance_stage="forbidden",
                timestamp=datetime.now(timezone.utc),
            )
        ]
        block = _build_denied_block(denials)
        assert "[DENIED ACTIONS THIS SESSION]" in block
        assert "exec" in block
        assert "forbidden" in block

    def test_denied_block_absent_when_list_empty(self):
        from src.brain.workspace import assemble_system_prompt
        import tempfile, os
        with tempfile.TemporaryDirectory() as tmp:
            result = assemble_system_prompt(tmp, denied_actions=[])
        assert "[DENIED ACTIONS THIS SESSION]" not in result

    def test_denied_block_capped_at_ten(self):
        from src.brain.workspace import _build_denied_block
        from src.brain.models.denied_action import DeniedAction
        denials = [
            DeniedAction(
                tool_name=f"tool_{i}",
                reason="denied",
                governance_stage="forbidden",
                timestamp=datetime.now(timezone.utc),
            )
            for i in range(12)
        ]
        block = _build_denied_block(denials)
        # 12 total, 10 shown, 2 omitted
        assert "2 older denial" in block
        # Only the last 10 should appear
        assert "tool_2" in block   # 12 - 10 = 2, so indices 2-11 shown
        assert "tool_0" not in block

    def test_overflow_note_singular(self):
        from src.brain.workspace import _build_denied_block
        from src.brain.models.denied_action import DeniedAction
        denials = [
            DeniedAction(
                tool_name=f"tool_{i}",
                reason="denied",
                governance_stage="forbidden",
                timestamp=datetime.now(timezone.utc),
            )
            for i in range(11)
        ]
        block = _build_denied_block(denials)
        assert "1 older denial omitted" in block
