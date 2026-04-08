"""Cost tracking utilities: estimate, record, and query LLM costs (§37, §38)."""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

log = logging.getLogger(__name__)

# Price table: (input_usd_per_1M, output_usd_per_1M) — as of early 2026
_MODEL_PRICES: dict[str, tuple[float, float]] = {
    "claude-3-5-sonnet": (3.00, 15.00),
    "claude-3-5-haiku": (0.80, 4.00),
    "claude-3-opus": (15.00, 75.00),
    "claude-sonnet-4": (3.00, 15.00),
    "claude-haiku-4": (0.80, 4.00),
    "gpt-4o-mini": (0.15, 0.60),   # must appear before gpt-4o (substring match order)
    "gpt-4o": (2.50, 10.00),
    "gpt-4-turbo": (10.00, 30.00),
    "gemini-2.0-flash": (0.10, 0.40),
    "gemini-1.5-pro": (1.25, 5.00),
}


def estimate_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    """Return estimated USD cost for a single LLM call.

    Matches model name as a case-insensitive substring so that vendor-prefixed
    names (e.g. ``anthropic/claude-3-5-sonnet``) are handled correctly.
    Unknown models return 0.0.
    """
    lower = model.lower()
    for key, (inp_per_m, out_per_m) in _MODEL_PRICES.items():
        if key in lower:
            return (input_tokens / 1_000_000) * inp_per_m + (output_tokens / 1_000_000) * out_per_m
    return 0.0


async def record_llm_cost(
    *,
    agent_id: str,
    model: str,
    provider: str = "",
    input_tokens: int,
    output_tokens: int,
    cost_usd: float,
    task_id: str | None = None,
    thread_id: str = "",
    routed_from: str | None = None,
    primary_cost_usd: float | None = None,
    session: AsyncSession | None = None,
    division: str = "",
) -> None:
    """Insert a BudgetLedger row for a completed LLM call.

    Accepts an optional *session*; if None, opens its own context.
    Failures are logged and suppressed so they never crash an invocation.
    """
    from .models.budget_ledger import BudgetLedger

    row = BudgetLedger(
        id=uuid.uuid4(),
        agent_id=agent_id,
        division=division,
        model=model,
        provider=provider,
        task_id=uuid.UUID(task_id) if task_id else None,
        thread_id=thread_id,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        cost_usd=cost_usd,
        routed_from=routed_from,
        primary_cost_usd=primary_cost_usd,
        timestamp=datetime.now(timezone.utc),
    )

    async def _insert(sess: AsyncSession) -> None:
        sess.add(row)
        await sess.commit()

    try:
        if session is not None:
            await _insert(session)
        else:
            from .db import get_session
            async with get_session() as sess:
                await _insert(sess)
    except Exception as exc:
        log.warning("record_llm_cost: failed to write ledger row (non-fatal): %s", exc)


async def get_period_spend(agent_id: str, session: AsyncSession) -> float:
    """Return total cost_usd for *agent_id* since its budget period_start.

    Falls back to the start of the current calendar month if no period_start
    is set in the budgets table.
    """
    from .models.budget_ledger import BudgetLedger
    from .models.budget import Budget

    now = datetime.now(timezone.utc)
    period_start: datetime = datetime(now.year, now.month, 1, tzinfo=timezone.utc)

    try:
        budget_row = await session.execute(
            select(Budget).where(Budget.agent_id == agent_id)
        )
        budget = budget_row.scalar_one_or_none()
        if budget is not None and getattr(budget, "period_start", None):
            period_start = budget.period_start
            if period_start.tzinfo is None:
                period_start = period_start.replace(tzinfo=timezone.utc)
    except Exception as exc:
        log.debug("get_period_spend: could not read period_start: %s", exc)

    result = await session.execute(
        select(func.coalesce(func.sum(BudgetLedger.cost_usd), 0.0)).where(
            BudgetLedger.agent_id == agent_id,
            BudgetLedger.timestamp >= period_start,
        )
    )
    total = result.scalar() or 0.0
    return float(total)
