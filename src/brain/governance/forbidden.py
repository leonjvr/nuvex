"""check_forbidden node — block calls to tools in the agent's forbidden list."""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from ...shared.config import get_cached_config
from ..models.denied_action import DeniedAction
from ..state import AgentState

log = logging.getLogger(__name__)


def _apply_under_review_async(contact_id: str) -> None:
    """Fire-and-forget: apply under_review sanction to a T0 contact."""
    import asyncio

    async def _do() -> None:
        try:
            from ..db import get_session
            from ..models.contact import Contact
            from ..identity.resolver import invalidate_contact
            async with get_session() as session:
                contact = await session.get(Contact, contact_id)
                if contact and contact.trust_tier == 0 and contact.sanction is None:
                    contact.sanction = "under_review"
                    contact.updated_at = datetime.now(timezone.utc)
                    await session.commit()
                    invalidate_contact(contact_id)
                    log.info(
                        "forbidden: auto under_review applied to T0 contact=%s", contact_id
                    )
        except Exception as exc:
            log.debug("forbidden: auto under_review failed (non-fatal): %s", exc)

    try:
        asyncio.ensure_future(_do())
    except RuntimeError:
        pass  # No event loop — skip


def check_forbidden(state: AgentState) -> dict[str, Any]:
    """
    If the last AI message contains tool calls that are on the forbidden list,
    strip them and set finished=True with an error message.

    Checks union of: global forbidden list + org-level forbidden list + agent forbidden list.
    """
    try:
        cfg = get_cached_config()
        agent_def = cfg.agents.get(state.agent_id)
        agent_forbidden = set(agent_def.forbidden_tools if agent_def and agent_def.forbidden_tools else [])
        global_forbidden = set(getattr(cfg, "forbidden_tools", None) or [])
    except Exception:
        agent_forbidden = set()
        global_forbidden = set()

    # Load org-level forbidden tools
    org_forbidden: set[str] = set()
    try:
        from ..db import get_session
        from ..models.organisation import Organisation
        import asyncio

        async def _get_org_forbidden() -> set[str]:
            async with get_session() as session:
                org = await session.get(Organisation, state.org_id)
                if org and org.policies:
                    return set(org.policies.get("forbidden_tools") or [])
            return set()

        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                import concurrent.futures
                # In async context — use a thread
                with concurrent.futures.ThreadPoolExecutor() as pool:
                    org_forbidden = set()  # skip in sync context
            else:
                org_forbidden = loop.run_until_complete(_get_org_forbidden())
        except Exception:
            org_forbidden = set()
    except Exception:
        org_forbidden = set()

    forbidden = global_forbidden | org_forbidden | agent_forbidden
    if not forbidden:
        return {}

    last = state.messages[-1] if state.messages else None
    if not last or not getattr(last, "tool_calls", None):
        return {}

    blocked = [tc["name"] for tc in last.tool_calls if tc.get("name") in forbidden]
    if blocked:
        log.warning("agent=%s blocked forbidden tools: %s", state.agent_id, blocked)
        denials = [
            DeniedAction(
                tool_name=name,
                reason=f"Tool '{name}' is in the agent forbidden list",
                governance_stage="forbidden",
                timestamp=datetime.now(timezone.utc),
                invocation_id=state.invocation_id,
            )
            for name in blocked
        ]

        # §5.5 — auto_under_review_on: apply under_review to T0 contacts on forbidden hit
        try:
            cfg_auto = get_cached_config()
            agent_def_auto = cfg_auto.agents.get(state.agent_id)
            if (
                agent_def_auto is not None
                and "forbidden" in (agent_def_auto.auto_under_review_on or [])
                and state.contact_id is not None
                and (state.contact_trust_tier or 0) == 0
            ):
                _apply_under_review_async(state.contact_id)
        except Exception:
            pass

        return {
            "finished": True,
            "error": f"Blocked: forbidden tools requested: {', '.join(blocked)}",
            "denied_actions": state.denied_actions + denials,
        }
    return {}
