"""Recovery engine — classify failures, apply recipes, escalate, persist logs."""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from enum import Enum
from typing import Any

from .db import get_session
from .lifecycle import get_agent_state, set_agent_state
from .models.cron import RecoveryLog

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Failure scenario taxonomy (19.1)
# ---------------------------------------------------------------------------

class FailureScenario(str, Enum):
    LlmApiError = "llm_api_error"
    ToolExecutionTimeout = "tool_execution_timeout"
    ToolExecutionCrash = "tool_execution_crash"
    GatewayDisconnect = "gateway_disconnect"
    DatabaseConnectionLost = "database_connection_lost"
    OutOfBudget = "out_of_budget"
    ContextWindowOverflow = "context_window_overflow"
    CredentialExhausted = "credential_exhausted"
    Unknown = "unknown"


# ---------------------------------------------------------------------------
# Recovery step definitions (19.3)
# ---------------------------------------------------------------------------

class RecoveryStep(str, Enum):
    retry_with_delay = "retry_with_delay"
    switch_fallback_model = "switch_fallback_model"
    retry_with_extended_timeout = "retry_with_extended_timeout"
    skip_tool = "skip_tool"
    reconnect_gateway = "reconnect_gateway"
    trigger_compaction = "trigger_compaction"
    halt = "halt"
    escalate = "escalate"


# (scenario → ordered list of steps to attempt)
_RECIPES: dict[FailureScenario, list[RecoveryStep]] = {
    FailureScenario.LlmApiError: [
        RecoveryStep.retry_with_delay,
        RecoveryStep.switch_fallback_model,
        RecoveryStep.retry_with_delay,
        RecoveryStep.escalate,
    ],
    FailureScenario.ToolExecutionTimeout: [
        RecoveryStep.retry_with_extended_timeout,
        RecoveryStep.skip_tool,
    ],
    FailureScenario.ToolExecutionCrash: [
        RecoveryStep.retry_with_delay,
        RecoveryStep.skip_tool,
    ],
    FailureScenario.GatewayDisconnect: [
        RecoveryStep.reconnect_gateway,
        RecoveryStep.retry_with_delay,
        RecoveryStep.escalate,
    ],
    FailureScenario.DatabaseConnectionLost: [
        RecoveryStep.halt,
    ],
    FailureScenario.OutOfBudget: [
        RecoveryStep.escalate,
        RecoveryStep.halt,
    ],
    FailureScenario.ContextWindowOverflow: [
        RecoveryStep.trigger_compaction,
        RecoveryStep.retry_with_delay,
    ],
    FailureScenario.CredentialExhausted: [
        RecoveryStep.switch_fallback_model,
        RecoveryStep.escalate,
    ],
    FailureScenario.Unknown: [
        RecoveryStep.retry_with_delay,
        RecoveryStep.escalate,
    ],
}


# ---------------------------------------------------------------------------
# Failure classification (maps error signals → FailureScenario) (20.4)
# ---------------------------------------------------------------------------

def classify_failure(
    exc: Exception | None = None,
    error_str: str = "",
    http_status: int | None = None,
) -> FailureScenario:
    """Classify a failure into a FailureScenario from the error signal."""
    msg = error_str or (str(exc) if exc else "")
    msg_lower = msg.lower()

    if http_status is not None:
        if http_status == 429:
            return FailureScenario.LlmApiError
        if http_status in (500, 502, 503, 504):
            return FailureScenario.LlmApiError
        if http_status == 402:
            return FailureScenario.OutOfBudget

    if any(k in msg_lower for k in ("context_length", "context length", "maximum context", "token limit")):
        return FailureScenario.ContextWindowOverflow
    if any(k in msg_lower for k in ("budget", "out of budget", "limit exceeded")):
        return FailureScenario.OutOfBudget
    if "timeout" in msg_lower and ("tool" in msg_lower or "exec" in msg_lower):
        return FailureScenario.ToolExecutionTimeout
    if "timeout" in msg_lower:
        return FailureScenario.LlmApiError
    if any(k in msg_lower for k in ("api key", "invalid_api_key", "authentication", "unauthorized")):
        return FailureScenario.LlmApiError
    if any(k in msg_lower for k in ("connection refused", "peer closed", "broken pipe", "econnrefused")):
        return FailureScenario.DatabaseConnectionLost
    if any(k in msg_lower for k in ("gateway", "disconnect", "not connected")):
        return FailureScenario.GatewayDisconnect
    if any(k in msg_lower for k in ("subprocess", "returncode", "exit code")):
        return FailureScenario.ToolExecutionCrash

    return FailureScenario.Unknown


# ---------------------------------------------------------------------------
# Recovery step executors (19.3)
# ---------------------------------------------------------------------------

_retry_delay_seconds: float = 2.0
_retry_delay_max: float = 30.0
_timeout_multiplier: float = 2.0


async def _step_retry_with_delay(context: dict[str, Any], attempt: int) -> bool:
    delay = min(_retry_delay_seconds * (2 ** attempt), _retry_delay_max)
    log.info("recovery: retry_with_delay %.1fs (attempt=%d)", delay, attempt)
    await asyncio.sleep(delay)
    return True  # signal: retry the original operation


async def _step_switch_fallback_model(context: dict[str, Any], attempt: int) -> bool:
    agent_id = context.get("agent_id", "")
    log.info("recovery: switch_fallback_model for agent=%s", agent_id)
    context["use_fallback_model"] = True
    return True


async def _step_retry_with_extended_timeout(context: dict[str, Any], attempt: int) -> bool:
    factor = _timeout_multiplier ** attempt
    context["timeout_multiplier"] = factor
    log.info("recovery: retry_with_extended_timeout multiplier=%.1f", factor)
    return True


async def _step_skip_tool(context: dict[str, Any], attempt: int) -> bool:
    tool = context.get("tool_name", "unknown")
    log.warning("recovery: skip_tool tool=%s", tool)
    context["skip_tool"] = tool
    return True


async def _step_reconnect_gateway(context: dict[str, Any], attempt: int) -> bool:
    gateway = context.get("gateway", "unknown")
    log.info("recovery: reconnect_gateway gateway=%s", gateway)
    # Actual reconnect logic is gateway-specific; emit an event
    try:
        from . import events
        await events.publish(
            "gateway.routing",
            {"action": "reconnect", "gateway": gateway},
            agent_id=context.get("agent_id"),
        )
    except Exception as exc:
        log.warning("recovery: reconnect event failed: %s", exc)
    return True


async def _step_trigger_compaction(context: dict[str, Any], attempt: int) -> bool:
    thread_id = context.get("thread_id")
    if thread_id:
        log.info("recovery: trigger_compaction thread=%s", thread_id)
        try:
            from .compaction import maybe_compact
            await maybe_compact(thread_id)
        except Exception as exc:
            log.warning("recovery: compaction failed: %s", exc)
    return True


async def _step_escalate(context: dict[str, Any], attempt: int) -> bool:
    agent_id = context.get("agent_id", "unknown")
    error = context.get("error", "unknown error")
    log.warning("recovery: escalate — notifying operator agent=%s error=%s", agent_id, error)
    try:
        from . import events
        await events.publish(
            "recovery.action",
            {
                "action": "escalate",
                "agent_id": agent_id,
                "error": str(error),
                "timestamp": datetime.now(timezone.utc).isoformat(),
            },
            agent_id=agent_id,
        )
    except Exception as exc:
        log.error("recovery: escalation event failed: %s", exc)
    return False  # signal: stop execution


async def _step_halt(context: dict[str, Any], attempt: int) -> bool:
    agent_id = context.get("agent_id", "unknown")
    log.error("recovery: halt — unrecoverable failure for agent=%s", agent_id)
    try:
        await set_agent_state(agent_id, "error", reason="recovery:halt")
    except Exception:
        pass
    return False


_STEP_FUNCS = {
    RecoveryStep.retry_with_delay: _step_retry_with_delay,
    RecoveryStep.switch_fallback_model: _step_switch_fallback_model,
    RecoveryStep.retry_with_extended_timeout: _step_retry_with_extended_timeout,
    RecoveryStep.skip_tool: _step_skip_tool,
    RecoveryStep.reconnect_gateway: _step_reconnect_gateway,
    RecoveryStep.trigger_compaction: _step_trigger_compaction,
    RecoveryStep.escalate: _step_escalate,
    RecoveryStep.halt: _step_halt,
}


# ---------------------------------------------------------------------------
# RecoveryEngine (19.2)
# ---------------------------------------------------------------------------

async def recover(
    agent_id: str,
    thread_id: str,
    exc: Exception | None = None,
    error_str: str = "",
    http_status: int | None = None,
    context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Classify the failure, execute the recovery recipe, and persist the log.

    Returns a context dict with recovery outcome flags:
      - scenario: FailureScenario value
      - steps_taken: list of step names executed
      - outcome: 'success' | 'failed' | 'halted' | 'escalated'
      - use_fallback_model: bool
      - skip_tool: str | None
      - timeout_multiplier: float
    """
    scenario = classify_failure(exc, error_str, http_status)
    recipe = _RECIPES.get(scenario, _RECIPES[FailureScenario.Unknown])

    ctx = {
        "agent_id": agent_id,
        "thread_id": thread_id,
        "error": error_str or str(exc) if exc else error_str,
        "use_fallback_model": False,
        "skip_tool": None,
        "timeout_multiplier": 1.0,
        **(context or {}),
    }

    steps_taken: list[str] = []
    outcome = "success"

    for i, step in enumerate(recipe):
        fn = _STEP_FUNCS.get(step)
        if fn is None:
            log.warning("recovery: unknown step %s", step)
            continue
        steps_taken.append(step.value)
        try:
            should_continue = await fn(ctx, attempt=i)
        except Exception as step_exc:
            log.error("recovery step %s raised: %s", step, step_exc)
            should_continue = False
        if not should_continue:
            if step == RecoveryStep.halt:
                outcome = "halted"
            elif step == RecoveryStep.escalate:
                outcome = "escalated"
            else:
                outcome = "failed"
            break

    await _persist_log(agent_id, thread_id, scenario, steps_taken, outcome, ctx)
    ctx["scenario"] = scenario.value
    ctx["steps_taken"] = steps_taken
    ctx["outcome"] = outcome
    return ctx


async def _persist_log(
    agent_id: str,
    thread_id: str,
    scenario: FailureScenario,
    steps: list[str],
    outcome: str,
    ctx: dict[str, Any],
) -> None:
    try:
        async with get_session() as session:
            entry = RecoveryLog(
                agent_id=agent_id,
                thread_id=thread_id,
                trigger=scenario.value,
                strategy=",".join(steps[:3]) if steps else "none",
                outcome=outcome,
                details={
                    "steps": steps,
                    "error": ctx.get("error", ""),
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                },
            )
            session.add(entry)
            await session.commit()
    except Exception as exc:
        log.error("recovery: failed to persist log: %s", exc)


# ---------------------------------------------------------------------------
# Event bus subscription (19.5) — subscribe to failure events on startup
# ---------------------------------------------------------------------------

def _register_recovery_subscriber() -> None:
    """Subscribe recovery engine to tool.execution and llm.invocation failure events."""
    from . import events

    async def _handle_tool_failure(payload: dict[str, Any]) -> None:
        if payload.get("status") != "error":
            return
        await recover(
            agent_id=payload.get("agent_id", ""),
            thread_id=payload.get("thread_id", ""),
            error_str=payload.get("error", ""),
            context={"tool_name": payload.get("tool_name", "")},
        )

    async def _handle_llm_failure(payload: dict[str, Any]) -> None:
        if payload.get("status") != "error":
            return
        await recover(
            agent_id=payload.get("agent_id", ""),
            thread_id=payload.get("thread_id", ""),
            error_str=payload.get("error", ""),
            http_status=payload.get("http_status"),
        )

    events.subscribe("tool.execution", _handle_tool_failure)
    events.subscribe("llm.invocation", _handle_llm_failure)
    log.info("recovery: subscribed to tool.execution and llm.invocation lanes")


# ---------------------------------------------------------------------------
# Legacy simple function (kept for backward compat)
# ---------------------------------------------------------------------------

async def attempt_recovery(
    agent_id: str,
    thread_id: str,
    trigger: str,
    strategy: str = "restart",
) -> bool:
    """Legacy single-strategy recovery function."""
    result = await recover(
        agent_id=agent_id,
        thread_id=thread_id,
        error_str=trigger,
        context={"strategy_hint": strategy},
    )
    if strategy == "restart":
        await set_agent_state(agent_id, "idle", reason=f"recovery:{trigger}")
    elif strategy == "suspend":
        await set_agent_state(agent_id, "suspended", reason=f"recovery:{trigger}")
    elif strategy == "terminate":
        await set_agent_state(agent_id, "terminated", reason=f"recovery:{trigger}")
    return result.get("outcome") != "halted"
