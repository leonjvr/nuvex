"""Unit tests — LangGraph routing functions: _should_continue, _check_budget, _policy_gate."""
from __future__ import annotations

import pytest

from src.brain.graph import _should_continue, _check_budget, _policy_gate
from src.brain.state import AgentState
from langchain_core.messages import AIMessage, HumanMessage


def _state(**kwargs) -> AgentState:
    defaults = dict(
        agent_id="maya",
        thread_id="t-1",
        invocation_id="inv-1",
        messages=[HumanMessage(content="hello")],
    )
    defaults.update(kwargs)
    return AgentState(**defaults)


# ---------------------------------------------------------------------------
# _should_continue
# ---------------------------------------------------------------------------

class TestShouldContinue:
    def test_no_tool_calls_returns_end(self):
        state = _state(messages=[AIMessage(content="hi")])
        assert _should_continue(state) == "end"

    def test_tool_calls_returns_tools(self):
        ai_msg = AIMessage(content="", tool_calls=[{"name": "shell", "args": {"command": "ls"}, "id": "c1"}])
        state = _state(messages=[ai_msg])
        assert _should_continue(state) == "tools"

    def test_finished_flag_returns_end(self):
        ai_msg = AIMessage(content="", tool_calls=[{"name": "shell", "args": {}, "id": "c1"}])
        state = _state(messages=[ai_msg], finished=True)
        assert _should_continue(state) == "end"

    def test_error_returns_end(self):
        ai_msg = AIMessage(content="", tool_calls=[{"name": "shell", "args": {}, "id": "c1"}])
        state = _state(messages=[ai_msg], error="something broke")
        assert _should_continue(state) == "end"

    def test_budget_exceeded_returns_end(self):
        ai_msg = AIMessage(content="", tool_calls=[{"name": "shell", "args": {}, "id": "c1"}])
        state = _state(messages=[ai_msg], budget_exceeded=True)
        assert _should_continue(state) == "end"

    def test_max_iterations_reached_returns_end(self):
        ai_msg = AIMessage(content="", tool_calls=[{"name": "shell", "args": {}, "id": "c1"}])
        state = _state(messages=[ai_msg], iteration=30, max_iterations=30)
        assert _should_continue(state) == "end"

    def test_within_iterations_with_tools_returns_tools(self):
        ai_msg = AIMessage(content="", tool_calls=[{"name": "shell", "args": {}, "id": "c1"}])
        state = _state(messages=[ai_msg], iteration=5, max_iterations=30)
        assert _should_continue(state) == "tools"

    def test_empty_messages_returns_end(self):
        state = _state(messages=[])
        assert _should_continue(state) == "end"


# ---------------------------------------------------------------------------
# _check_budget
# ---------------------------------------------------------------------------

class TestCheckBudget:
    def test_normal_state_returns_llm(self):
        state = _state()
        assert _check_budget(state) == "llm"

    def test_budget_exceeded_returns_end(self):
        state = _state(budget_exceeded=True)
        assert _check_budget(state) == "end"

    def test_not_budget_exceeded_false_is_llm(self):
        state = _state(budget_exceeded=False)
        assert _check_budget(state) == "llm"


# ---------------------------------------------------------------------------
# _policy_gate
# ---------------------------------------------------------------------------

class TestPolicyGate:
    def test_normal_state_proceeds(self):
        state = _state()
        assert _policy_gate(state) == "execute_tools"

    def test_finished_stops(self):
        state = _state(finished=True)
        assert _policy_gate(state) == "end"

    def test_error_stops(self):
        state = _state(error="policy denied: rm -rf")
        assert _policy_gate(state) == "end"

    def test_both_finished_and_error_stop(self):
        state = _state(finished=True, error="denied")
        assert _policy_gate(state) == "end"
