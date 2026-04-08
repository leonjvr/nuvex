"""Unit tests — governance: approval gate tool detection."""
from __future__ import annotations

import pytest
from unittest.mock import patch, MagicMock
from src.brain.governance.approval import needs_approval, _DESTRUCTIVE_TOOLS


def _mock_config(tier: str = "T2"):
    cfg = MagicMock()
    agent = MagicMock()
    agent.tier = tier
    cfg.agents.get.return_value = agent
    return cfg


class TestNeedsApproval:
    def _state(self, agent_id="maya"):
        from src.brain.state import AgentState
        return AgentState(agent_id=agent_id, thread_id="t1", messages=[])

    def test_shell_always_requires_approval(self):
        state = self._state()
        with patch("src.brain.governance.approval.get_cached_config", return_value=_mock_config("T2")):
            assert needs_approval(state, "shell") is True

    def test_write_file_always_requires_approval(self):
        state = self._state()
        with patch("src.brain.governance.approval.get_cached_config", return_value=_mock_config("T2")):
            assert needs_approval(state, "write_file") is True

    def test_delete_file_always_requires_approval(self):
        state = self._state()
        with patch("src.brain.governance.approval.get_cached_config", return_value=_mock_config("T2")):
            assert needs_approval(state, "delete_file") is True

    def test_execute_code_always_requires_approval(self):
        state = self._state()
        with patch("src.brain.governance.approval.get_cached_config", return_value=_mock_config("T2")):
            assert needs_approval(state, "execute_code") is True

    def test_read_file_does_not_require_approval(self):
        state = self._state()
        with patch("src.brain.governance.approval.get_cached_config", return_value=_mock_config("T2")):
            assert needs_approval(state, "read_file") is False

    def test_web_fetch_does_not_require_approval(self):
        state = self._state()
        with patch("src.brain.governance.approval.get_cached_config", return_value=_mock_config("T2")):
            assert needs_approval(state, "web_fetch") is False

    def test_always_require_set_is_non_empty(self):
        assert len(_DESTRUCTIVE_TOOLS) >= 4

    def test_t1_skips_approval_for_all_tools(self):
        state = self._state()
        with patch("src.brain.governance.approval.get_cached_config", return_value=_mock_config("T1")):
            assert needs_approval(state, "shell") is False
            assert needs_approval(state, "write_file") is False

    def test_t3_requires_approval_for_all_tools(self):
        state = self._state()
        with patch("src.brain.governance.approval.get_cached_config", return_value=_mock_config("T3")):
            assert needs_approval(state, "read_file") is True
            assert needs_approval(state, "web_fetch") is True
