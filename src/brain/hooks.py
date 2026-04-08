"""Hook runner — pre/post tool-use hooks for audit, cost tracking, and messaging."""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

logger = logging.getLogger(__name__)

HookFn = Callable[..., Awaitable[Any]]


@dataclass
class HookResult:
    """Return value from a PostToolUse hook (§34).

    Fields:
      result_override    — if set, replaces the tool output seen by the LLM
      skip_model_feedback — if True, suppress the tool result from the LLM stream
    """

    result_override: str | None = None
    skip_model_feedback: bool = False


@dataclass
class HookContext:
    """Data passed to every hook function."""
    agent_id: str
    thread_id: str
    tool_name: str
    tool_input: dict[str, Any]
    tool_output: Any | None = None  # None for PreToolUse
    error: Exception | None = None
    # PreToolUse mutation support (21.6)
    mutated_input: dict[str, Any] | None = None
    # PreToolUse abort support (21.7)
    abort: bool = False
    abort_reason: str = ""


@dataclass
class HookRegistry:
    pre_hooks: list[HookFn] = field(default_factory=list)
    post_hooks: list[HookFn] = field(default_factory=list)

    def register_pre(self, fn: HookFn) -> None:
        self.pre_hooks.append(fn)

    def register_post(self, fn: HookFn) -> None:
        self.post_hooks.append(fn)


_registry = HookRegistry()


def register_pre_hook(fn: HookFn) -> HookFn:
    """Decorator — register a pre-tool-use hook."""
    _registry.register_pre(fn)
    return fn


def register_post_hook(fn: HookFn) -> HookFn:
    """Decorator — register a post-tool-use hook."""
    _registry.register_post(fn)
    return fn


_HOOK_TIMEOUT = 5.0  # seconds (21.9)


async def _run_pre_hooks(hooks: list[HookFn], ctx: HookContext) -> None:
    for hook in hooks:
        try:
            await asyncio.wait_for(hook(ctx), timeout=_HOOK_TIMEOUT)
        except asyncio.TimeoutError:
            logger.warning("Hook %s timed out for tool %s", hook.__name__, ctx.tool_name)
        except Exception as exc:  # noqa: BLE001
            logger.exception("Hook %s raised: %s", hook.__name__, exc)


async def _run_post_hooks_chained(hooks: list[HookFn], ctx: HookContext) -> str | None:
    """Run post hooks in priority order, chaining result_override values (§34).

    Returns:
      None  — tool output should be suppressed (skip_model_feedback=True)
      str   — effective tool output (original or overridden)
    """
    for hook in hooks:
        try:
            result = await asyncio.wait_for(hook(ctx), timeout=_HOOK_TIMEOUT)
        except asyncio.TimeoutError:
            logger.warning("Hook %s timed out for tool %s", hook.__name__, ctx.tool_name)
            continue
        except Exception as exc:  # noqa: BLE001
            logger.exception("Hook %s raised: %s", hook.__name__, exc)
            continue

        if isinstance(result, HookResult):
            if result.skip_model_feedback:
                return None  # suppress — stop chain
            if result.result_override is not None:
                ctx.tool_output = result.result_override  # pass override to next hook

    return str(ctx.tool_output) if ctx.tool_output is not None else ""


async def run_pre_hooks(ctx: HookContext) -> None:
    """Run all pre-tool-use hooks. Hooks may set ctx.mutated_input or ctx.abort."""
    await _run_pre_hooks(_registry.pre_hooks, ctx)


async def run_post_hooks(ctx: HookContext, *, hooks: list[HookFn] | None = None) -> str | None:
    """Run post-tool-use hooks and return effective output (§34).

    When ``hooks`` is provided it overrides the registered hook list (useful in tests).
    Returns None if any hook suppresses model feedback (skip_model_feedback=True).
    Returns the (possibly overridden) tool output string otherwise.
    """
    effective = hooks if hooks is not None else _registry.post_hooks
    return await _run_post_hooks_chained(effective, ctx)


# ---------------------------------------------------------------------------
# Built-in hooks
# ---------------------------------------------------------------------------

@register_post_hook
async def audit_hook(ctx: HookContext) -> None:
    """Append tool use to governance audit log."""
    import hashlib, json, uuid
    from .db import get_session
    from .models.governance import GovernanceAudit
    try:
        raw = json.dumps({"tool": ctx.tool_name, "input": ctx.tool_input}, sort_keys=True)
        sha256 = hashlib.sha256(raw.encode()).hexdigest()
        async with get_session() as session:
            entry = GovernanceAudit(
                agent_id=ctx.agent_id,
                invocation_id=str(uuid.uuid4()),
                thread_id=ctx.thread_id,
                action=f"tool:{ctx.tool_name}",
                tool_name=ctx.tool_name,
                decision="allowed",
                stage="post_tool",
                reason="post-hook audit",
                sha256_hash=sha256,
            )
            session.add(entry)
            await session.commit()
    except Exception as exc:  # noqa: BLE001
        logger.warning("audit_hook failed: %s", exc)


@register_post_hook
async def cost_tracking_hook(ctx: HookContext) -> None:
    """Accumulate LLM cost estimates from tool outputs (21.4).

    When a tool result contains a _cost_usd field (e.g. injected by call_llm),
    update the budgets table for the agent.
    """
    try:
        import json
        output = ctx.tool_output
        if not output:
            return
        data: dict = {}
        if isinstance(output, str):
            try:
                data = json.loads(output)
            except Exception:
                return
        elif isinstance(output, dict):
            data = output

        cost = float(data.get("_cost_usd", 0))
        tokens = int(data.get("_tokens_used", 0))
        if cost <= 0 and tokens <= 0:
            return

        from .db import get_session
        from sqlalchemy import select
        from .models.budget import Budget
        async with get_session() as session:
            result = await session.execute(
                select(Budget).where(Budget.agent_id == ctx.agent_id)
            )
            budget: Budget | None = result.scalar_one_or_none()
            if budget:
                budget.total_usd_used = (budget.total_usd_used or 0.0) + cost
                budget.daily_usd_used = (budget.daily_usd_used or 0.0) + cost
                await session.commit()
    except Exception as exc:
        logger.debug("cost_tracking_hook: %s", exc)


@register_post_hook
async def send_message_hook(ctx: HookContext) -> None:
    """Route send_message tool outputs to the actions_queue table (21.5)."""
    if ctx.tool_name != "send_message":
        return
    try:
        import json, uuid
        output = ctx.tool_output or ""
        args = ctx.tool_input or {}
        target_channel = args.get("channel", "whatsapp")
        recipient = args.get("recipient", "")
        message = args.get("message", "")

        from .db import get_session
        from .models.actions import ActionQueue
        async with get_session() as session:
            action = ActionQueue(
                id=uuid.uuid4(),
                agent_id=ctx.agent_id,
                action_type="send_message",
                target_channel=target_channel,
                payload={
                    "recipient": recipient,
                    "message": message,
                    "tool_output": str(output)[:500],
                },
                status="pending",
            )
            session.add(action)
            await session.commit()
        logger.debug("send_message_hook: queued action for channel=%s recipient=%s", target_channel, recipient)
    except Exception as exc:
        logger.warning("send_message_hook failed: %s", exc)

        raw = json.dumps({"tool": ctx.tool_name, "input": ctx.tool_input}, sort_keys=True)
        sha256 = hashlib.sha256(raw.encode()).hexdigest()
        async with get_session() as session:
            entry = GovernanceAudit(
                agent_id=ctx.agent_id,
                invocation_id=str(uuid.uuid4()),
                thread_id=ctx.thread_id,
                action=f"tool:{ctx.tool_name}",
                tool_name=ctx.tool_name,
                decision="allowed",
                stage="post_tool",
                reason="post-hook audit",
                sha256_hash=sha256,
            )
            session.add(entry)
            await session.commit()
    except Exception as exc:  # noqa: BLE001
        logger.warning("audit_hook failed: %s", exc)


@register_post_hook
async def pii_mask_hook(ctx: HookContext) -> "HookResult | None":
    """Built-in PII masking hook (§34). Active when agent has pii_patterns configured."""
    try:
        from .hooks.pii_mask import make_pii_mask_hook
        hook = make_pii_mask_hook(ctx.agent_id)
        if hook is None:
            return None
        return await hook(ctx)
    except Exception as exc:  # noqa: BLE001
        logger.debug("pii_mask_hook: skipped — %s", exc)
        return None
