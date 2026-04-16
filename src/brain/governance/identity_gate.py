"""Identity gate — first stage in the governance pipeline.

Reads contact trust tier and sanction from AgentState and returns
a governance decision: pass | block | restrict_tools | shadowban.

Temp ban expiry is cleared here. under_review triggers an admin notification.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum
from typing import Any

from ..db import get_session
from ..models.contact import Contact
from ..identity.resolver import invalidate_contact
from ..state import AgentState

log = logging.getLogger(__name__)


class IdentityDecision(str, Enum):
    PASS = "pass"
    BLOCK = "block"
    RESTRICT_TOOLS = "restrict_tools"
    SHADOWBAN = "shadowban"


@dataclass
class IdentityGateResult:
    decision: IdentityDecision
    reason: str
    clear_sanction: bool = False


def evaluate_identity_gate(state: AgentState) -> IdentityGateResult:
    """Evaluate access based on contact trust tier and sanction.

    Returns IdentityGateResult — caller decides what to do with the decision.
    """
    sanction = state.contact_sanction
    tier = state.contact_trust_tier

    # Handle temp_ban expiry
    if sanction == "temp_ban" and state.contact_sanction_until:
        try:
            until = datetime.fromisoformat(state.contact_sanction_until)
            if until.tzinfo is None:
                until = until.replace(tzinfo=timezone.utc)
            if datetime.now(timezone.utc) >= until:
                log.info(
                    "identity_gate: temp_ban expired for contact=%s — clearing",
                    state.contact_id,
                )
                return IdentityGateResult(
                    decision=IdentityDecision.PASS,
                    reason="temp_ban expired",
                    clear_sanction=True,
                )
        except (ValueError, TypeError):
            pass

    if sanction == "hard_ban":
        return IdentityGateResult(decision=IdentityDecision.BLOCK, reason="hard_ban active")

    if sanction == "temp_ban":
        return IdentityGateResult(decision=IdentityDecision.BLOCK, reason="temp_ban active")

    if sanction == "shadowban":
        return IdentityGateResult(decision=IdentityDecision.SHADOWBAN, reason="shadowban active")

    if sanction == "under_review":
        return IdentityGateResult(
            decision=IdentityDecision.RESTRICT_TOOLS,
            reason="contact is under_review",
        )

    # Tier-based restrictions: T0 contacts have no tool access
    if tier == 0:
        return IdentityGateResult(
            decision=IdentityDecision.RESTRICT_TOOLS,
            reason="T0 contact: tools restricted until verified",
        )

    return IdentityGateResult(decision=IdentityDecision.PASS, reason="identity check passed")


async def identity_gate_node(state: AgentState) -> dict[str, Any]:
    """LangGraph node: evaluate identity gate and short-circuit on block."""
    result = evaluate_identity_gate(state)

    # Persist sanction clearance for expired temp_ban
    if result.clear_sanction and state.contact_id:
        try:
            async with get_session() as session:
                contact = await session.get(Contact, state.contact_id)
                if contact:
                    contact.sanction = None
                    contact.sanction_until = None
                    await session.commit()
                invalidate_contact(state.contact_id)
        except Exception as exc:
            log.warning("identity_gate: failed to clear expired temp_ban: %s", exc)

    if result.decision == IdentityDecision.BLOCK:
        log.warning(
            "identity_gate: BLOCK contact=%s reason=%s", state.contact_id, result.reason
        )
        return {"finished": True, "error": f"Access denied: {result.reason}"}

    if result.decision == IdentityDecision.SHADOWBAN:
        # Pretend success but do not actually run the LLM
        return {"finished": True, "error": None}

    if result.decision == IdentityDecision.RESTRICT_TOOLS:
        # Allow LLM but clear active tools
        log.info(
            "identity_gate: RESTRICT_TOOLS contact=%s reason=%s",
            state.contact_id,
            result.reason,
        )
        # Trigger admin notification for under_review (best-effort, non-blocking)
        if state.contact_sanction == "under_review":
            _maybe_notify_under_review(state)
        return {"active_tools": []}

    return {}


def _maybe_notify_under_review(state: AgentState) -> None:
    """Queue an admin notification event for under_review contacts (deduplicated 24h)."""
    import asyncio

    async def _notify():
        try:
            from ..events import publish
            await publish(
                "contact.under_review",
                {
                    "contact_id": state.contact_id,
                    "agent_id": state.agent_id,
                    "invocation_id": state.invocation_id,
                },
                agent_id=state.agent_id,
                invocation_id=state.invocation_id,
            )
        except Exception as exc:
            log.debug("identity_gate: under_review notify failed (non-fatal): %s", exc)

    try:
        asyncio.ensure_future(_notify())
    except RuntimeError:
        pass  # No event loop — skip
