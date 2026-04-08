"""execute_tools node — run tool calls from the last AI message."""
from __future__ import annotations

import json
import logging
import os
from contextlib import contextmanager
from typing import Any

from langchain_core.messages import ToolMessage
from langchain_core.tools import BaseTool

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
    new_messages = []

    with _skill_env(state.workspace_path):
        for tc in last_msg.tool_calls:
            tool_name = tc.get("name", "")
            tool_id = tc.get("id", tool_name)
            args = tc.get("args", {})

            # §35 — quota check before subprocess launch
            if not _quota_ok:
                new_messages.append(ToolMessage(
                    content="SCRATCH_QUOTA_EXCEEDED: scratch directory is over quota",
                    tool_call_id=tool_id,
                ))
                continue

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
                    # §10.3 — create pending approval record so dashboard can act on it
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
                new_messages.append(ToolMessage(content=msg, tool_call_id=tool_id))
                continue

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
                try:
                    result = await tool.ainvoke(effective_args)
                    if not isinstance(result, str):
                        result = json.dumps(result, default=str)
                    ctx.tool_output = result
                except Exception as exc:
                    log.error("Tool %s failed: %s", tool_name, exc)
                    result = f"[error] {exc}"
                    ctx.error = exc

            # §34 — run post-tool hooks; honour result_override and skip_model_feedback
            original_result = result
            effective_result = await run_post_hooks(ctx)
            if effective_result is None:
                # skip_model_feedback=True — do not append tool result to LLM stream
                log.debug("execute_tools: tool %s result suppressed by post-hook", tool_name)
            else:
                if effective_result != original_result:
                    log.debug(
                        "execute_tools: tool %s result overridden by post-hook (original logged)",
                        tool_name,
                    )
                new_messages.append(ToolMessage(content=effective_result, tool_call_id=tool_id))

    return {"messages": new_messages}
