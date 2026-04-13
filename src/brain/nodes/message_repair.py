"""Message repair and system-prompt assembly for LLM calls.

Handles:
- Orphaned tool-call removal (Anthropic/OpenAI reject histories with unanswered tool_calls)
- Error-paste detection and enforcement block injection
- System-prompt construction from workspace files + memory + contact blocks
"""
from __future__ import annotations

import logging
import re

from langchain_core.messages import HumanMessage, SystemMessage

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Error-paste enforcement (injected into system prompt when user pastes errors)
# ---------------------------------------------------------------------------

_ERROR_PASTE_PATTERNS = [
    r"sync failed",
    r"cannot insert duplicate key",
    r"unique index",
    r"traceback \(most recent call last\)",
    r"exception:",
    r"unhandled exception",
    r"error:.*at line",
    r"duplicate key",
    r"constraint violation",
    r"violates.*constraint",
    r"sqlexception",
    r"keyerror",
    r"typeerror",
    r"attributeerror",
    r"runtimeerror",
]

_ERROR_PASTE_ENFORCEMENT = """
---
CRITICAL ENFORCEMENT — ACTIVE NOW:

The user's most recent message is an error paste. Any prior conversation summaries claiming "I fixed this" or "the error has been resolved" were INCORRECT — ignore them.

You MUST respond with ONLY these 3 questions. No summaries, no explanations, no tool calls:

1. What were you doing when this happened, and which part of the system triggered it?
2. Is this a new error or has it appeared before? If before, was it after a recent code change or deployment?
3. Any other context that might help — specific account, time of day, data being processed?

Do NOT call copilot.sh. Do NOT explain the error. Do NOT claim you have fixed anything. Ask ONLY the 3 questions above, then wait for the answers.
---
"""

_ERROR_PASTE_FOLLOWUP_ENFORCEMENT = """
---
CRITICAL ENFORCEMENT — ACTIVE NOW:

There is an unresolved error in this conversation. You have NOT yet called any tools. You have NOT run copilot.sh. The user is waiting for you to actually do the work.

YOUR RESPONSE MUST START WITH A TOOL CALL. Do not write any text before the tool call. Do not acknowledge. Do not say "I'll begin" or "I'll investigate" or "Thank you". 

The ONLY acceptable response is to immediately invoke shell_tool with copilot.sh. If you write any text instead of calling a tool, you are failing the user.

Call shell_tool now. First action. No preamble.
---
"""


def _last_user_text(conversation: list) -> str:
    for m in reversed(conversation):
        if isinstance(m, HumanMessage):
            content = m.content
            if isinstance(content, list):
                parts = [p.get("text", "") if isinstance(p, dict) else str(p) for p in content]
                return " ".join(parts)
            return str(content)
    return ""


def _is_error_paste(text: str) -> bool:
    lower = text.lower()
    return any(re.search(p, lower) for p in _ERROR_PASTE_PATTERNS)


def _recent_conversation_has_unanswered_error_paste(conversation: list) -> bool:
    """Return True when there is an unresolved error paste — user pasted an error
    but no tool call followed (Maya never ran copilot.sh to fix it).
    """
    last_error_paste_idx = None
    for i, m in enumerate(conversation):
        if isinstance(m, HumanMessage):
            content = m.content
            if isinstance(content, list):
                parts = [p.get("text", "") if isinstance(p, dict) else str(p) for p in content]
                content = " ".join(parts)
            if _is_error_paste(str(content)):
                last_error_paste_idx = i

    if last_error_paste_idx is None:
        return False

    for m in conversation[last_error_paste_idx + 1:]:
        if getattr(m, "type", None) == "tool":
            return False

    return True


# ---------------------------------------------------------------------------
# Orphaned tool-call repair
# ---------------------------------------------------------------------------

def repair_orphaned_tool_calls(messages: list) -> tuple[list, list]:
    """Remove AI messages whose tool_calls were never answered consecutively.

    An AI message is "orphaned" when its tool_calls are NOT answered by
    consecutive ToolMessages immediately following it (e.g. process crashed
    before tool results were stored). Anthropic and OpenAI reject such histories
    with a 400 error.

    Returns (repaired_messages, []) — empty second element kept for API compat.
    """
    properly_answered: set[str] = set()
    orphaned_tc_ids: set[str] = set()
    orphaned_ai_indices: set[int] = set()

    for i, m in enumerate(messages):
        if getattr(m, "type", None) != "ai":
            continue
        tool_calls = getattr(m, "tool_calls", None) or []
        if not tool_calls:
            continue

        tc_ids: set[str] = set()
        for tc in tool_calls:
            tid = tc.get("id") if isinstance(tc, dict) else getattr(tc, "id", None)
            if tid:
                tc_ids.add(tid)

        j = i + 1
        answered_here: set[str] = set()
        while j < len(messages) and getattr(messages[j], "type", None) == "tool":
            tid = getattr(messages[j], "tool_call_id", None)
            if tid:
                answered_here.add(tid)
            j += 1

        unanswered = tc_ids - answered_here
        if unanswered:
            log.warning(
                "call_llm: removing orphaned AI message with unanswered tool_call_ids=%s",
                sorted(unanswered),
            )
            orphaned_ai_indices.add(i)
            orphaned_tc_ids.update(unanswered)
        else:
            properly_answered.update(answered_here)

    if not orphaned_ai_indices:
        return messages, []

    repaired: list = []
    for i, m in enumerate(messages):
        if i in orphaned_ai_indices:
            continue
        if getattr(m, "type", None) == "tool":
            tid = getattr(m, "tool_call_id", None)
            if tid and tid in orphaned_tc_ids:
                continue
        repaired.append(m)
    return repaired, []


# Legacy alias for unit-tests
_repair_orphaned_tool_calls = repair_orphaned_tool_calls


# ---------------------------------------------------------------------------
# System-prompt assembly and message list construction
# ---------------------------------------------------------------------------

def build_messages_for_llm(
    state: "AgentState",  # type: ignore[name-defined]
    memory_block: str = "",
    contact_block: str = "",
) -> tuple[list, list]:
    """Return (messages_for_llm, injected_stubs).

    Prepends a fresh system prompt; removes orphaned tool_calls.
    """
    from ..workspace import assemble_system_prompt, GOVERNANCE_PREAMBLE

    conversation = [m for m in state.messages if not isinstance(m, SystemMessage)]
    conversation, injected_stubs = repair_orphaned_tool_calls(conversation)

    if state.workspace_path:
        try:
            _response_style: str | None = None
            try:
                from ...shared.config import get_cached_config, get_agent as _get_agent
                _cfg = get_cached_config()
                _agent_def = _get_agent(_cfg, state.agent_id)
                _response_style = _agent_def.response_style if _agent_def else None
            except Exception:
                pass
            system_prompt = assemble_system_prompt(
                state.workspace_path,
                memory_block=memory_block,
                contact_block=contact_block,
                denied_actions=state.denied_actions or None,
                response_style=_response_style,
                agent_id=state.agent_id,
                org_id=getattr(state, "org_id", "default"),
            )
        except Exception as exc:
            log.warning("call_llm: failed to assemble system prompt: %s", exc)
            system_prompt = GOVERNANCE_PREAMBLE
    else:
        from ..workspace import GOVERNANCE_PREAMBLE
        system_prompt = GOVERNANCE_PREAMBLE

    if state.project_context:
        system_prompt = f"{system_prompt}\n\n---\n\n{state.project_context}"

    last_user_text = _last_user_text(conversation)
    if _is_error_paste(last_user_text):
        log.info("call_llm: error paste detected — appending enforcement block to system prompt")
        system_prompt = f"{system_prompt}{_ERROR_PASTE_ENFORCEMENT}"
    elif _recent_conversation_has_unanswered_error_paste(conversation):
        log.info("call_llm: error paste follow-up detected — appending workflow enforcement block")
        system_prompt = f"{system_prompt}{_ERROR_PASTE_FOLLOWUP_ENFORCEMENT}"

    return [SystemMessage(content=system_prompt)] + conversation, injected_stubs


# Legacy alias kept for any test that imported the private name
_build_messages_for_llm = build_messages_for_llm
