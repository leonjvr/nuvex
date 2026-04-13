"""_auth.py — shared access check for Gatekeeper tools."""
from __future__ import annotations


def check_gatekeeper_access(
    caller_trust_tier: int,
    caller_principal_role: str | None,
) -> None:
    """Raise PermissionError unless caller meets Gatekeeper access requirements.

    Requires: trust_tier >= T3 OR principal role in (operator, admin, owner).
    """
    allowed_roles = {"operator", "admin", "owner"}
    if caller_trust_tier >= 3:
        return
    if caller_principal_role in allowed_roles:
        return
    raise PermissionError(
        "Gatekeeper tools require T3+ trust tier or operator/admin/owner role"
    )
