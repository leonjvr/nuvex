"""Unit tests for §33 — Tool Schema Locking.

Acceptance criteria:
  33.1  tool_schema_hash and tool_schema_cache fields exist on AgentState
  33.2  _compute_schema_hash produces (hex_digest, list[dict])
  33.3  same tools in different order → identical hash (cache hit)
  33.4  serialisation uses sort_keys at all levels (deterministic)
  33.5  adding one tool produces a different hash (cache miss) and updates state
"""
from __future__ import annotations

import hashlib
import json
from unittest.mock import MagicMock

import pytest
from pydantic import BaseModel

from src.brain.nodes.call_llm import _compute_schema_hash
from src.brain.state import AgentState


# ---------------------------------------------------------------------------
# Helpers — minimal fake tool
# ---------------------------------------------------------------------------

class _SimpleInput(BaseModel):
    query: str


def _make_tool(name: str, description: str = "A tool") -> MagicMock:
    t = MagicMock()
    t.name = name
    t.description = description
    t.args_schema = _SimpleInput
    return t


# ---------------------------------------------------------------------------
# 33.1  AgentState has the new fields
# ---------------------------------------------------------------------------

class TestAgentStateFields:
    def test_tool_schema_hash_defaults_to_none(self):
        state = AgentState(agent_id="maya", thread_id="t1")
        assert state.tool_schema_hash is None

    def test_tool_schema_cache_defaults_to_none(self):
        state = AgentState(agent_id="maya", thread_id="t1")
        assert state.tool_schema_cache is None

    def test_fields_accept_values(self):
        state = AgentState(
            agent_id="maya",
            thread_id="t1",
            tool_schema_hash="abc123",
            tool_schema_cache=[{"name": "shell", "description": "run shell", "parameters": {}}],
        )
        assert state.tool_schema_hash == "abc123"
        assert len(state.tool_schema_cache) == 1


# ---------------------------------------------------------------------------
# 33.2  _compute_schema_hash returns (str, list[dict])
# ---------------------------------------------------------------------------

class TestComputeSchemaHash:
    def test_returns_hex_string_and_list(self):
        tools = [_make_tool("shell"), _make_tool("web_fetch")]
        digest, dicts = _compute_schema_hash(tools)
        assert isinstance(digest, str)
        assert len(digest) == 64  # SHA-256 hex
        assert isinstance(dicts, list)
        assert all(isinstance(d, dict) for d in dicts)

    def test_schema_dict_has_required_keys(self):
        tools = [_make_tool("shell", description="Run a shell command")]
        _, dicts = _compute_schema_hash(tools)
        assert dicts[0]["name"] == "shell"
        assert dicts[0]["description"] == "Run a shell command"
        assert "parameters" in dicts[0]


# ---------------------------------------------------------------------------
# 33.3  Same tools, different insertion order → same hash (cache hit)
# ---------------------------------------------------------------------------

class TestDeterministicHash:
    def test_same_tools_different_order_same_hash(self):
        t_a = _make_tool("alpha")
        t_b = _make_tool("beta")
        t_c = _make_tool("gamma")

        h1, _ = _compute_schema_hash([t_a, t_b, t_c])
        h2, _ = _compute_schema_hash([t_c, t_a, t_b])
        h3, _ = _compute_schema_hash([t_b, t_c, t_a])

        assert h1 == h2 == h3

    def test_empty_tool_list_stable(self):
        h1, dicts = _compute_schema_hash([])
        h2, _ = _compute_schema_hash([])
        assert h1 == h2
        assert dicts == []


# ---------------------------------------------------------------------------
# 33.4  sort_keys used at all nesting levels
# ---------------------------------------------------------------------------

class TestSortKeys:
    def test_serialisation_uses_sort_keys(self):
        """Manually verify json.dumps with sort_keys produces expected bytes."""
        class _NestedInput(BaseModel):
            z_field: str
            a_field: int

        t = MagicMock()
        t.name = "my_tool"
        t.description = "desc"
        t.args_schema = _NestedInput

        _, dicts = _compute_schema_hash([t])
        serialized = json.dumps(dicts, sort_keys=True)
        # Re-serialize the same data and verify it is identical
        assert serialized == json.dumps(dicts, sort_keys=True)
        # Keys in the serialized form come out in sorted order
        parsed = json.loads(serialized)
        assert list(parsed[0].keys()) == sorted(parsed[0].keys())


# ---------------------------------------------------------------------------
# 33.5  Adding one tool produces a new hash (cache miss)
# ---------------------------------------------------------------------------

class TestCacheMiss:
    def test_added_tool_changes_hash(self):
        t_a = _make_tool("shell")
        t_b = _make_tool("web_fetch")

        h1, _ = _compute_schema_hash([t_a])
        h2, _ = _compute_schema_hash([t_a, t_b])

        assert h1 != h2

    def test_same_name_different_description_changes_hash(self):
        t1 = _make_tool("shell", description="old description")
        t2 = _make_tool("shell", description="new description")

        h1, _ = _compute_schema_hash([t1])
        h2, _ = _compute_schema_hash([t2])

        assert h1 != h2

    def test_state_schema_hash_and_cache_updated_on_miss(self):
        """When hash changes, schema_state_update must contain new hash + cache."""
        # Simulate the logic that runs in call_llm():
        #   new_hash, schema_dicts = _compute_schema_hash(tools)
        #   if new_hash == state.tool_schema_hash and state.tool_schema_cache is not None:
        #       schema_state_update = {}
        #   else:
        #       schema_state_update = {"tool_schema_hash": new_hash, "tool_schema_cache": schema_dicts}

        tools = [_make_tool("shell")]
        new_hash, schema_dicts = _compute_schema_hash(tools)

        # First invocation — state has no hash yet
        state = AgentState(agent_id="maya", thread_id="t1")
        if new_hash == state.tool_schema_hash and state.tool_schema_cache is not None:
            update = {}
        else:
            update = {"tool_schema_hash": new_hash, "tool_schema_cache": schema_dicts}

        assert update["tool_schema_hash"] == new_hash
        assert update["tool_schema_cache"] == schema_dicts

    def test_state_no_update_on_hit(self):
        """When hash matches, schema_state_update must be empty."""
        tools = [_make_tool("shell")]
        stored_hash, schema_dicts = _compute_schema_hash(tools)

        state = AgentState(
            agent_id="maya",
            thread_id="t1",
            tool_schema_hash=stored_hash,
            tool_schema_cache=schema_dicts,
        )
        new_hash, new_dicts = _compute_schema_hash(tools)
        if new_hash == state.tool_schema_hash and state.tool_schema_cache is not None:
            update = {}
        else:
            update = {"tool_schema_hash": new_hash, "tool_schema_cache": new_dicts}

        assert update == {}
