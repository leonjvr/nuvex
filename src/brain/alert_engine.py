"""Alert engine — checks budget alert thresholds and fires notifications (§39)."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

log = logging.getLogger(__name__)

_COOLDOWN_HOURS = 1


class AlertEngine:
    """Checks all configured budget_alerts against current spend."""

    async def check_all_alerts(self, session: AsyncSession) -> list[str]:
        """Aggregate per-agent spend and fire alerts where threshold crossed.

        Returns list of alert IDs that fired this run.
        """
        from .models.budget_alert import BudgetAlert
        from .models.budget_ledger import BudgetLedger
        from .models.budget import Budget

        fired: list[str] = []
        now = datetime.now(timezone.utc)

        # Load all alert rules
        alerts_result = await session.execute(select(BudgetAlert))
        alerts = alerts_result.scalars().all()
        if not alerts:
            return fired

        # Load all budgets for limit reference
        budgets_result = await session.execute(select(Budget))
        budgets = {b.agent_id: b for b in budgets_result.scalars().all()}

        for alert in alerts:
            # Determine which agents to check
            if alert.agent_id:
                agent_ids = [alert.agent_id]
            else:
                agent_ids = list(budgets.keys())

            for agent_id in agent_ids:
                budget_row = budgets.get(agent_id)
                if budget_row is None:
                    continue

                limit = float(budget_row.monthly_usd_limit or 0)
                if limit <= 0:
                    continue

                # Determine period start
                period_start_raw = getattr(budget_row, "period_start", None)
                if period_start_raw:
                    period_start = (
                        period_start_raw.replace(tzinfo=timezone.utc)
                        if period_start_raw.tzinfo is None
                        else period_start_raw
                    )
                else:
                    period_start = datetime(now.year, now.month, 1, tzinfo=timezone.utc)

                spend_result = await session.execute(
                    select(func.coalesce(func.sum(BudgetLedger.cost_usd), 0.0)).where(
                        BudgetLedger.agent_id == agent_id,
                        BudgetLedger.timestamp >= period_start,
                    )
                )
                spend = float(spend_result.scalar() or 0.0)
                pct_used = (spend / limit) * 100.0

                if pct_used < float(alert.threshold_pct):
                    continue

                # Check cooldown
                if alert.last_fired_at is not None:
                    last_fired = (
                        alert.last_fired_at.replace(tzinfo=timezone.utc)
                        if alert.last_fired_at.tzinfo is None
                        else alert.last_fired_at
                    )
                    if now - last_fired < timedelta(hours=_COOLDOWN_HOURS):
                        log.debug(
                            "alert_engine: alert %s in cooldown for agent=%s",
                            alert.id, agent_id,
                        )
                        continue

                # Fire the alert
                await self._fire(alert, agent_id, spend, pct_used, session)
                fired.append(str(alert.id))

        return fired

    async def _fire(
        self,
        alert,
        agent_id: str,
        spend: float,
        pct_used: float,
        session: AsyncSession,
    ) -> None:
        """Emit notification and update last_fired_at."""
        now = datetime.now(timezone.utc)
        payload = {
            "alert_id": str(alert.id),
            "agent_id": agent_id,
            "spend_usd": spend,
            "pct_used": pct_used,
            "threshold_pct": float(alert.threshold_pct),
            "channels": alert.channels or [],
        }

        # Publish via event bus (non-fatal)
        try:
            from . import events
            await events.publish(
                "budget.alert",
                payload,
                agent_id=agent_id,
                invocation_id=None,
            )
        except Exception as exc:
            log.warning("alert_engine: event publish failed: %s", exc)

        # Update last_fired_at
        alert.last_fired_at = now
        await session.commit()
        log.info(
            "alert_engine: fired alert %s for agent=%s (%.1f%% of budget)",
            alert.id, agent_id, pct_used,
        )
