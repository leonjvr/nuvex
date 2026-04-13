"""Unit tests for parallel tool execution (hermes-inspired-runtime §1)."""
from __future__ import annotations

import asyncio
import time
from unittest.mock import AsyncMock, MagicMock

import pytest

from src.brain.tools.parallel import (
    ToolClassification,
    classify_tool,
    execute_parallel_batch,
)


class TestClassifyTool:
    def test_known_safe_tool_is_parallel(self):
        assert classify_tool("read_file") == ToolClassification.PARALLEL_SAFE

    def test_web_fetch_is_parallel(self):
        assert classify_tool("web_fetch") == ToolClassification.PARALLEL_SAFE

    def test_unknown_tool_is_sequential(self):
        assert classify_tool("delete_everything") == ToolClassification.SEQUENTIAL

    def test_mcp_readonly_annotation_is_parallel(self):
        schema = {"annotations": {"readOnly": True}}
        assert classify_tool("mcp_tool_x", schema) == ToolClassification.PARALLEL_SAFE

    def test_mcp_no_annotation_is_sequential(self):
        schema = {"annotations": {"readOnly": False}}
        assert classify_tool("mcp_tool_x", schema) == ToolClassification.SEQUENTIAL

    def test_extra_safe_tool(self):
        assert classify_tool("my_custom_reader", extra_safe=["my_custom_reader"]) == ToolClassification.PARALLEL_SAFE

    def test_shell_is_sequential(self):
        assert classify_tool("shell") == ToolClassification.SEQUENTIAL


class TestExecuteParallelBatch:
    @pytest.mark.asyncio
    async def test_empty_batch_returns_empty(self):
        result = await execute_parallel_batch([], execute_one=AsyncMock(return_value="x"))
        assert result == []

    @pytest.mark.asyncio
    async def test_sequential_fallback_when_disabled(self):
        calls = []

        async def fake_execute(tc):
            calls.append(tc["name"])
            return tc["name"]

        tc_list = [
            {"name": "shell", "id": "1", "args": {}},
            {"name": "read_file", "id": "2", "args": {}},
        ]
        results = await execute_parallel_batch(tc_list, fake_execute, enabled=False)
        assert results == ["shell", "read_file"]
        assert calls == ["shell", "read_file"]

    @pytest.mark.asyncio
    async def test_parallel_safe_tools_run_concurrently(self):
        """3 parallel-safe tools should finish in ~max(durations), not sum."""

        async def fake_slow(tc):
            await asyncio.sleep(0.1)
            return tc["name"]

        tc_list = [
            {"name": "read_file", "id": "1", "args": {}},
            {"name": "web_fetch", "id": "2", "args": {}},
            {"name": "session_search", "id": "3", "args": {}},
        ]
        start = time.monotonic()
        results = await execute_parallel_batch(tc_list, fake_slow)
        elapsed = time.monotonic() - start

        assert results == ["read_file", "web_fetch", "session_search"]
        # Should be ~0.1s (parallel), not ~0.3s (serial)
        assert elapsed < 0.25, f"Took {elapsed:.2f}s — expected <0.25s (parallel)"

    @pytest.mark.asyncio
    async def test_result_order_matches_call_order(self):
        """Results must be in the same order as calls even if B finishes before A."""
        completion_times = {}

        async def fake_execute(tc):
            delay = 0.1 if tc["name"] == "read_file" else 0.01
            await asyncio.sleep(delay)
            completion_times[tc["name"]] = time.monotonic()
            return tc["name"]

        tc_list = [
            {"name": "read_file", "id": "1", "args": {}},
            {"name": "web_fetch", "id": "2", "args": {}},
        ]
        results = await execute_parallel_batch(tc_list, fake_execute)
        assert results[0] == "read_file"
        assert results[1] == "web_fetch"

    @pytest.mark.asyncio
    async def test_exception_in_parallel_tool_does_not_cancel_others(self):
        async def fake_execute(tc):
            if tc["name"] == "bad_tool":
                raise RuntimeError("boom")
            return tc["name"]

        from langchain_core.messages import ToolMessage

        tc_list = [
            {"name": "bad_tool", "id": "1", "args": {}},
            {"name": "read_file", "id": "2", "args": {}},
        ]
        results = await execute_parallel_batch(tc_list, fake_execute)
        # bad_tool becomes an error ToolMessage; read_file succeeds
        assert isinstance(results[0], ToolMessage)
        assert "[error]" in results[0].content
        assert results[1] == "read_file"

    @pytest.mark.asyncio
    async def test_mixed_batch_runs_parallel_first(self):
        """Parallel-safe tools must complete before sequential ones are dispatched."""
        order: list[str] = []

        async def fake_execute(tc):
            order.append(tc["name"])
            await asyncio.sleep(0.01)
            return tc["name"]

        tc_list = [
            {"name": "shell", "id": "1", "args": {}},       # sequential
            {"name": "read_file", "id": "2", "args": {}},   # parallel
            {"name": "web_fetch", "id": "3", "args": {}},   # parallel
        ]
        results = await execute_parallel_batch(tc_list, fake_execute)
        # Results in original order
        assert results[0] == "shell"
        assert results[1] == "read_file"
        assert results[2] == "web_fetch"
        # read_file and web_fetch ran before shell
        shell_pos = order.index("shell")
        assert shell_pos >= 2, "Sequential tool should run after parallel batch"
