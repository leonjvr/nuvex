"""Budget guard — enforce per-agent cost limits, update budget rows."""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import func, select

from ...shared.config import get_cached_config
from ..state import AgentState
from ..db import get_session
from ..models.budget import Budget
from ..models.denied_action import DeniedAction
from ..costs import get_period_spend

log = logging.getLogger(__name__)


async def enforce_budget(state: AgentState) -> dict[str, Any]:
    """Check agent's budget and flag budget_exceeded if any limit is breached."""
    try:
        cfg = get_cached_config()
        agent_def = cfg.agents.get(state.agent_id)
        if agent_def is None or agent_def.budget is None:
            return {}
        budget_cfg = agent_def.budget
    except Exception:
        return {}

    async with get_session() as session:
        result = await session.execute(select(Budget).where(Budget.agent_id == state.agent_id))
        row: Budget | None = result.scalar_one_or_none()

        if row is None:
            row = Budget(
                agent_id=state.agent_id,
                division=agent_def.division or "",
                daily_usd_limit=budget_cfg.daily_usd,
                monthly_usd_limit=budget_cfg.monthly_usd,
                total_usd_limit=budget_cfg.monthly_usd,
            )
            session.add(row)

        row.daily_usd_used = (row.daily_usd_used or 0.0) + state.cost_usd
        row.total_usd_used = (row.total_usd_used or 0.0) + state.cost_usd

        exceeded = False
        denial_reason: str | None = None

        # Soft-cap via warn_at_pct using period spend from ledger (§38.3)
        warn_decision: str | None = None
        try:
            period_spend = await get_period_spend(state.agent_id, session)
            warn_at_pct = float(getattr(budget_cfg, "warn_at_pct", 80.0))
            monthly_limit = budget_cfg.monthly_usd
            if monthly_limit and monthly_limit > 0:
                pct_used = (period_spend / monthly_limit) * 100.0
                if pct_used >= warn_at_pct:
                    warn_decision = (
                        f"Spend ${period_spend:.4f} reached {pct_used:.1f}% of "
                        f"monthly budget ${monthly_limit:.2f} (warn_at={warn_at_pct}%)"
                    )
                    log.warning(
                        "Budget soft-cap: agent=%s spend=%.4f pct=%.1f%%",
                        state.agent_id, period_spend, pct_used,
                    )
        except Exception as exc:
            log.debug("budget: soft-cap check skipped: %s", exc)

        if budget_cfg.daily_usd and row.daily_usd_used >= budget_cfg.daily_usd:
            exceeded = True
            denial_reason = f"Daily budget limit of ${budget_cfg.daily_usd:.2f} exceeded"
            log.warning("Budget daily limit hit for agent=%s", state.agent_id)
        if budget_cfg.monthly_usd and row.total_usd_used >= budget_cfg.monthly_usd:
            exceeded = True
            denial_reason = f"Monthly budget limit of ${budget_cfg.monthly_usd:.2f} exceeded"
            log.warning("Budget monthly limit hit for agent=%s", state.agent_id)

        await session.commit()

    # §7.4-7.5 — check org-level daily budget cap
    if not exceeded:
        try:
            from ..models.organisation import Organisation
            async with get_session() as session:
                org = await session.get(Organisation, state.org_id)
                if org and org.policies:
                    org_daily_cap = org.policies.get("budgets", {}).get("daily_usd")
                    if org_daily_cap:
                        # Aggregate daily spend across all agents in this org
                        from datetime import date
                        today_start = datetime.combine(date.today(), datetime.min.time()).replace(
                            tzinfo=timezone.utc
                        )
                        spend_result = await session.execute(
                            select(func.coalesce(func.sum(Budget.daily_usd_used), 0.0))
                            .where(Budget.org_id == state.org_id)
                        )
                        org_daily_spend = spend_result.scalar() or 0.0
                        if org_daily_spend + state.cost_usd >= org_daily_cap:
                            exceeded = True
                            denial_reason = f"Org daily budget cap of ${org_daily_cap:.2f} exceeded"
                            log.warning(
                                "Org budget daily cap hit for org=%s spend=%.4f",
                                state.org_id, org_daily_spend,
                            )
        except Exception as exc:
            log.debug("org budget check skipped (non-fatal): %s", exc)

    if exceeded and denial_reason:
        denial = DeniedAction(
            tool_name="__budget__",
            reason=denial_reason,
            governance_stage="budget",
            timestamp=datetime.now(timezone.utc),
            invocation_id=state.invocation_id,
        )
        return {
            "budget_exceeded": True,
            "denied_actions": state.denied_actions + [denial],
        }

    # Soft-cap warn: budget not hard-exceeded but warn threshold crossed
    if warn_decision:
        return {"budget_exceeded": False, "budget_warn": warn_decision}

    return {"budget_exceeded": exceeded}
