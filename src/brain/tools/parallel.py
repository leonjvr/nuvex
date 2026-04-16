"""Parallel tool execution — classify and batch concurrent tool calls.

Spec: hermes-inspired-runtime §1
"""
from __future__ import annotations

import asyncio
import logging
from enum import Enum
from typing import Any, Callable

log = logging.getLogger(__name__)

# Default set of tools that are safe to execute concurrently.
# A tool is parallel-safe when it has no side-effects that depend on the
# output of another tool in the same batch.
_DEFAULT_SAFE_TOOLS: frozenset[str] = frozenset(
    {
        "read_file",
        "web_fetch",
        "web_search",
        "session_search",
        "read_tool_result",
        "memory_retrieve",
    }
)


class ToolClassification(str, Enum):
    PARALLEL_SAFE = "parallel_safe"
    SEQUENTIAL = "sequential"


def classify_tool(
    tool_name: str,
    tool_schema: dict | None = None,
    extra_safe: list[str] | None = None,
) -> ToolClassification:
    """Return PARALLEL_SAFE or SEQUENTIAL for *tool_name*.

    Checks (in order):
    1. MCP tool with ``readOnly: true`` in its schema annotations
    2. Tool name in the combined safe-list (defaults + config safe_tools)
    3. Otherwise → SEQUENTIAL
    """
    safe_names = _DEFAULT_SAFE_TOOLS | set(extra_safe or [])

    # MCP readOnly annotation
    if tool_schema:
        annotations = tool_schema.get("annotations") or {}
        if annotations.get("readOnly") is True:
            return ToolClassification.PARALLEL_SAFE

    if tool_name in safe_names:
        return ToolClassification.PARALLEL_SAFE

    return ToolClassification.SEQUENTIAL


async def execute_parallel_batch(
    tool_calls: list[dict],
    execute_one: Callable[[dict], Any],
    classify_fn: Callable[[str, dict | None], ToolClassification] = classify_tool,
    max_concurrency: int = 8,
    extra_safe: list[str] | None = None,
    enabled: bool = True,
) -> list[Any]:
    """Execute *tool_calls* with parallelism for safe tools.

    Args:
        tool_calls: List of tool call dicts, each has ``name``, ``id``, ``args``.
        execute_one: Async callable that executes a single tool call dict and
            returns a ToolMessage (or any result).
        classify_fn: Classifier function.  Defaults to module-level
            ``classify_tool``.
        max_concurrency: Maximum simultaneous parallel executions.
        extra_safe: Extra tool names treated as parallel-safe.
        enabled: If False, all tools run sequentially (disables feature).

    Returns:
        Results in the **same order** as *tool_calls*, regardless of completion
        order.
    """
    if not tool_calls:
        return []

    if not enabled:
        # Fully sequential fallback
        results = []
        for tc in tool_calls:
            results.append(await execute_one(tc))
        return results

    # Classify each call
    parallel_indices: list[int] = []
    sequential_indices: list[int] = []
    for idx, tc in enumerate(tool_calls):
        name = tc.get("name", "")
        schema = tc.get("_schema")  # may be injected by caller
        cls = classify_fn(name, schema, extra_safe)
        if cls == ToolClassification.PARALLEL_SAFE:
            parallel_indices.append(idx)
        else:
            sequential_indices.append(idx)

    results: list[Any] = [None] * len(tool_calls)
    sem = asyncio.Semaphore(max_concurrency)

    async def _run_one(idx: int, tc: dict) -> tuple[int, Any]:
        async with sem:
            try:
                result = await execute_one(tc)
            except Exception as exc:
                log.error("parallel_batch: tool[%d] %s failed: %s", idx, tc.get("name"), exc)
                from langchain_core.messages import ToolMessage
                result = ToolMessage(
                    content=f"[error] {exc}",
                    tool_call_id=tc.get("id", tc.get("name", "")),
                )
        return idx, result

    # Run parallel batch first
    if parallel_indices:
        tasks = [
            asyncio.create_task(_run_one(i, tool_calls[i]))
            for i in parallel_indices
        ]
        done = await asyncio.gather(*tasks, return_exceptions=False)
        for idx, result in done:
            results[idx] = result

    # Run sequential tools in order
    for idx in sequential_indices:
        _, result = await _run_one(idx, tool_calls[idx])
        results[idx] = result

    return results
