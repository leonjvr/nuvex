"""Advisor escalation policy — governs when to trigger the Anthropic advisor tool."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

METADATA_ADVISOR_COUNT = "advisor_escalation_count"


@dataclass
class EscalationPolicy:
    """Per-invocation escalation configuration (all values are overridable)."""

    theta: float = 0.5           # complexity threshold for auto-escalation
    max_per_thread: int = 3      # max advisor activations per thread lifetime
    min_complexity: float = 0.6  # minimum complexity_score to trigger escalation


def should_escalate_advisor(
    base_advisor_enabled: bool,
    signals: dict[str, Any] | None,
    metadata: dict[str, Any],
    policy: EscalationPolicy | None = None,
) -> tuple[bool, str]:
    """Determine whether the advisor tool should be active for this invocation.

    Returns (use_advisor, reason) where reason is one of:
      'always_on'         — base config says use advisor; signals are below threshold
      'signals_escalated' — complexity or risk signals triggered escalation
      'cap_exceeded'      — advisor disabled because the per-thread cap was reached
      'disabled'          — advisor not applicable (non-Claude, config off, etc.)
    """
    if not base_advisor_enabled:
        return False, "disabled"

    if policy is None:
        policy = EscalationPolicy()

    count: int = metadata.get(METADATA_ADVISOR_COUNT, 0)
    if count >= policy.max_per_thread:
        return False, "cap_exceeded"

    if signals is None:
        return True, "always_on"

    complexity: float = signals.get("complexity_score", 0.0)
    risk: str = signals.get("risk_class", "low")

    if complexity >= policy.min_complexity or risk == "high":
        return True, "signals_escalated"

    return True, "always_on"


def increment_advisor_count(metadata: dict[str, Any]) -> dict[str, Any]:
    """Return a new metadata dict with the advisor call counter incremented."""
    count: int = metadata.get(METADATA_ADVISOR_COUNT, 0)
    return {**metadata, METADATA_ADVISOR_COUNT: count + 1}
