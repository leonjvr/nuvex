"""Three-tier policy merge — global → org → agent (most restrictive wins)."""
from __future__ import annotations

from copy import deepcopy
from typing import Any

# Sentinel for "no override" checks
_UNSET = object()


def merge_policies(
    global_policies: dict[str, Any],
    org_policies: dict[str, Any],
    agent_policies: dict[str, Any],
) -> dict[str, Any]:
    """Merge policy layers into effective_policies.

    Rules:
    - ``forbidden_tools``: union of all three lists (most restrictive)
    - ``budgets``: minimum value across layers (most restrictive)
    - ``conditions``: AND logic — all layers' conditions must pass
    - Orgs/agents may only make policies *stricter*, never weaker

    Returns a new merged dict without mutating any input.
    """
    result = deepcopy(global_policies)

    # --- forbidden_tools: union ---
    global_ft = set(result.get("forbidden_tools") or [])
    org_ft = set(org_policies.get("forbidden_tools") or [])
    agent_ft = set(agent_policies.get("forbidden_tools") or [])
    result["forbidden_tools"] = sorted(global_ft | org_ft | agent_ft)

    # --- budgets: minimum (most restrictive) ---
    result["budgets"] = _merge_budgets(
        result.get("budgets") or {},
        org_policies.get("budgets") or {},
        agent_policies.get("budgets") or {},
    )

    # --- conditions: AND merge ---
    result["conditions"] = _merge_conditions(
        result.get("conditions") or [],
        org_policies.get("conditions") or [],
        agent_policies.get("conditions") or [],
    )

    return result


def _merge_budgets(
    global_b: dict[str, Any],
    org_b: dict[str, Any],
    agent_b: dict[str, Any],
) -> dict[str, Any]:
    """Return budget dict where each limit is the minimum across all layers."""
    keys = set(global_b) | set(org_b) | set(agent_b)
    out: dict[str, Any] = {}
    for k in keys:
        values = [
            d[k] for d in (global_b, org_b, agent_b)
            if k in d and d[k] is not None and isinstance(d[k], (int, float))
        ]
        if values:
            out[k] = min(values)
    return out


def _merge_conditions(
    global_c: list[dict],
    org_c: list[dict],
    agent_c: list[dict],
) -> list[dict]:
    """Return combined condition list (AND semantics — all must pass)."""
    merged = []
    for layer in (global_c, org_c, agent_c):
        merged.extend(layer)
    return merged
