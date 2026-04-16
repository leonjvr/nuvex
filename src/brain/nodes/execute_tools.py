"""execute_tools node — run tool calls from the last AI message."""
from __future__ import annotations

import json
import logging
import os
from contextlib import contextmanager
from typing import Any

from langchain_core.messages import ToolMessage
from langchain_core.tools import BaseTool
from langgraph.errors import GraphBubbleUp

from ..hooks import HookContext, run_post_hooks, run_pre_hooks
from ..state import AgentState
from ..tools_registry import get_tools_for_agent

log = logging.getLogger(__name__)


@contextmanager
def _skill_env(workspace_path: str | None):
    """Temporarily inject skill credential env vars into os.environ.

    Reads _meta.json from every skill in the workspace and loads their
    declared env_file credentials so shell commands can find them.
    Restores the original environment on exit.
    """
    if not workspace_path:
        yield
        return
    try:
        from ..workspace import load_skill_metas, resolve_skill_env
        metas = load_skill_metas(workspace_path)
        injected: dict[str, str] = {}
        for meta in metas.values():
            for k, v in resolve_skill_env(meta).items():
                if k not in os.environ:  # don't overwrite explicit env
                    injected[k] = v
                    os.environ[k] = v
        yield
    except Exception as exc:
        log.debug("execute_tools: skill env injection failed (non-fatal): %s", exc)
        yield
        return
    finally:
        for k in injected:
            os.environ.pop(k, None)


def _load_parallel_config():
    """Load ParallelConfig from nuvex.yaml; returns defaults on failure."""
    try:
        from ...shared.config import get_cached_config
        cfg = get_cached_config()
        return cfg.tools.parallel
    except Exception:
        return None


def _load_result_budget_config():
    """Load ResultBudgetConfig from nuvex.yaml; returns defaults on failure."""
    try:
        from ...shared.config import get_cached_config
        cfg = get_cached_config()
        return cfg.tools.result_budget
    except Exception:
        return None


async def execute_tools(state: AgentState) -> dict[str, Any]:
    """Execute all tool calls in the last AI message and return ToolMessages."""
    last_msg = state.messages[-1] if state.messages else None
    if not last_msg or not getattr(last_msg, "tool_calls", None):
        return {"finished": True}

    # §35 — resolve scratch dir and inject NUVEX_SCRATCH_DIR for all tool subprocesses
    try:
        from ..tools.executor import ensure_scratch_dir, check_scratch_quota
        from ...shared.config import get_cached_config, get_agent as _get_agent
        _cfg = get_cached_config()
        _agent_def = _get_agent(_cfg, state.agent_id)
        quota_mb = _agent_def.scratch.quota_mb if _agent_def else 100
        scratch_path = ensure_scratch_dir(state.thread_id)
        os.environ["NUVEX_SCRATCH_DIR"] = str(scratch_path)
        _quota_ok, _quota_msg = check_scratch_quota(state.thread_id, quota_mb)
    except Exception as exc:
        log.debug("execute_tools: scratch dir setup failed (non-fatal): %s", exc)
        _quota_ok = True
        _quota_msg = None

    tools: dict[str, BaseTool] = {t.name: t for t in await get_tools_for_agent(state.agent_id)}

    # Load configs for parallel execution and result budget
    parallel_cfg = _load_parallel_config()
    budget_cfg = _load_result_budget_config()
    parallel_enabled = getattr(parallel_cfg, "enabled", True)
    max_concurrency = getattr(parallel_cfg, "max_concurrency", 8)
    extra_safe = list(getattr(parallel_cfg, "safe_tools", []))
    budget_enabled = getattr(budget_cfg, "enabled", True)
    default_max_chars = getattr(budget_cfg, "default_max_chars", 30000)
    turn_budget_chars = getattr(budget_cfg, "turn_budget_chars", 200000)
    per_tool_limits: dict[str, int] = dict(getattr(budget_cfg, "per_tool", {}) or {})

    async def _execute_single(tc: dict) -> ToolMessage | None:
        """Execute one tool call (pre-hooks, invocation, post-hooks, budget)."""
        tool_name = tc.get("name", "")
        tool_id = tc.get("id", tool_name)
        args = tc.get("args", {})

        # §35 — quota check before subprocess launch
        if not _quota_ok:
            return ToolMessage(
                content="SCRATCH_QUOTA_EXCEEDED: scratch directory is over quota",
                tool_call_id=tool_id,
            )

        ctx = HookContext(
            agent_id=state.agent_id,
            thread_id=state.thread_id,
            tool_name=tool_name,
            tool_input=args,
        )
        await run_pre_hooks(ctx)

        # 21.7 — abort if a pre-hook requests it
        if ctx.abort:
            log.info("Tool %s aborted by pre-hook: %s", tool_name, ctx.abort_reason)
            if ctx.require_approval:
                try:
                    from ..db import get_session
                    from ..models.approval import PendingApproval
                    async with get_session() as session:
                        record = PendingApproval(
                            agent_id=state.agent_id,
                            thread_id=state.thread_id,
                            tool_name=tool_name,
                            tool_input=args,
                            reason=ctx.abort_reason,
                        )
                        session.add(record)
                        await session.commit()
                except Exception as _exc:
                    log.warning("Could not persist pending approval: %s", _exc)
                msg = f"[approval-required] {ctx.abort_reason or 'awaiting approval'}"
            else:
                msg = f"[aborted] {ctx.abort_reason or 'pre-hook abort'}"
            return ToolMessage(content=msg, tool_call_id=tool_id)

        # 21.6 — use mutated input if a pre-hook provided one
        effective_args = ctx.mutated_input if ctx.mutated_input is not None else args

        # §6.4 — inject skill_env into shell tool args when available
        if ctx.skill_env and tool_name == "shell":
            effective_args = dict(effective_args)
            existing_env = effective_args.get("env") or {}
            effective_args["env"] = {**ctx.skill_env, **existing_env}

        tool = tools.get(tool_name)
        if tool is None:
            result = f"[error] Unknown tool: {tool_name}"
            ctx.error = ValueError(result)
        else:
            # Inject thread_id into ReadToolResultTool so overflow lookups are scoped correctly
            if tool_name == "read_tool_result" and hasattr(tool, "_thread_id"):
                tool._thread_id = state.thread_id  # type: ignore[attr-defined]
            try:
                result = await tool.ainvoke(effective_args)
                if not isinstance(result, str):
                    result = json.dumps(result, default=str)
                ctx.tool_output = result
            except GraphBubbleUp:
                raise
            except Exception as exc:
                log.error("Tool %s failed: %s", tool_name, exc)
                result = f"[error] {exc}"
                ctx.error = exc

        # §2 — per-tool result budget enforcement
        if budget_enabled and isinstance(result, str) and not result.startswith("[error]"):
            max_chars = per_tool_limits.get(tool_name, default_max_chars)
            result, _ref = _enforce_budget(tool_name, result, state.thread_id, max_chars)

        # §34 — run post-tool hooks
        original_result = result
        effective_result = await run_post_hooks(ctx)
        if effective_result is None:
            log.debug("execute_tools: tool %s result suppressed by post-hook", tool_name)
            return None
        if effective_result != original_result:
            log.debug("execute_tools: tool %s result overridden by post-hook", tool_name)
        return ToolMessage(content=effective_result, tool_call_id=tool_id)

    with _skill_env(state.workspace_path):
        from ..tools.parallel import execute_parallel_batch, classify_tool

        raw_results = await execute_parallel_batch(
            tool_calls=list(last_msg.tool_calls),
            execute_one=_execute_single,
            classify_fn=lambda name, schema, extra=None: classify_tool(name, schema, extra_safe),
            max_concurrency=max_concurrency,
            enabled=parallel_enabled,
        )

    new_messages = [r for r in raw_results if r is not None]

    # §2 — per-turn budget enforcement (replace oldest results with handles)
    if budget_enabled and new_messages:
        try:
            from ..tools.result_budget import enforce_turn_budget
            pairs = [(m.tool_call_id or "", m.content) for m in new_messages]
            trimmed = enforce_turn_budget(pairs, state.thread_id, turn_budget_chars, default_max_chars)
            for i, content in enumerate(trimmed):
                new_messages[i] = ToolMessage(
                    content=content,
                    tool_call_id=new_messages[i].tool_call_id,
                )
        except Exception as exc:
            log.debug("execute_tools: turn budget failed (non-fatal): %s", exc)

    return {"messages": new_messages}


def _enforce_budget(
    tool_name: str, result: str, thread_id: str, max_chars: int
) -> tuple[str, object]:
    """Thin wrapper so the import stays inside the function scope."""
    try:
        from ..tools.result_budget import enforce_tool_budget
        return enforce_tool_budget(tool_name, result, thread_id, max_chars)
    except Exception as exc:
        log.debug("execute_tools: budget enforcement failed (non-fatal): %s", exc)
        return result, None

