"""Offline threshold sweep — find optimal quality-cost theta from historical outcomes."""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class SweepSample:
    """One recorded routing outcome for threshold analysis."""

    complexity_score: float   # from ClassificationResult, 0.0–1.0
    task_succeeded: bool      # actual outcome
    model_cost_usd: float     # cost of this invocation
    risk_class: str = field(default="low")    # low | medium | high
    tool_likelihood: float = field(default=0.0)
    budget_pressure: float = field(default=0.0)


@dataclass
class SweepResult:
    """Metrics for one theta value."""

    theta: float
    success_rate: float
    cost_per_success_usd: float | None   # None when zero successes in this bucket
    avg_cost_per_attempt_usd: float
    n_promoted: int      # samples routed to power tier due to complexity > theta
    n_samples: int


def sweep_theta(
    samples: list[SweepSample],
    thetas: list[float] | None = None,
    power_cost_multiplier: float = 3.0,
) -> list[SweepResult]:
    """Simulate routing cost distribution at different complexity thresholds.

    For each theta value, tasks whose complexity_score exceeds the threshold AND
    whose risk_class is not "low" are counted as "promoted" to a heavier model
    (cost multiplied by power_cost_multiplier).  Success rates are taken directly
    from actual historical outcomes — no counterfactual adjustment is applied.

    Returns results sorted by theta ascending.
    """
    if not samples:
        return []
    if thetas is None:
        thetas = [round(t / 10, 1) for t in range(1, 10)]

    results: list[SweepResult] = []
    for theta in sorted(thetas):
        total_cost = 0.0
        total_successes = 0
        promoted = 0

        for s in samples:
            upgraded = s.complexity_score > theta and s.risk_class != "low"
            cost = s.model_cost_usd * (power_cost_multiplier if upgraded else 1.0)
            if upgraded:
                promoted += 1
            total_cost += cost
            if s.task_succeeded:
                total_successes += 1

        n = len(samples)
        results.append(
            SweepResult(
                theta=theta,
                success_rate=total_successes / n,
                cost_per_success_usd=total_cost / total_successes if total_successes else None,
                avg_cost_per_attempt_usd=total_cost / n,
                n_promoted=promoted,
                n_samples=n,
            )
        )
    return results


def best_theta(
    results: list[SweepResult],
    cost_budget_per_success_usd: float | None = None,
) -> SweepResult | None:
    """Return the theta with highest success_rate (filtered by cost budget if given)."""
    if not results:
        return None
    candidates = results
    if cost_budget_per_success_usd is not None:
        candidates = [
            r for r in results
            if r.cost_per_success_usd is not None
            and r.cost_per_success_usd <= cost_budget_per_success_usd
        ]
    if not candidates:
        return None
    return max(candidates, key=lambda r: r.success_rate)
