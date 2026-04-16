"""promote_contact tool — increase a contact's trust tier."""
from __future__ import annotations

from ._auth import check_gatekeeper_access
from ...identity.progression import TrustProgressionService


async def promote_contact(
    contact_id: str,
    new_tier: int,
    caller_trust_tier: int = 0,
    caller_principal_role: str | None = None,
    org_id: str = "default",
) -> dict:
    """Promote a contact to a higher trust tier.

    Args:
        contact_id: UUID of the contact to promote.
        new_tier: Target trust tier (0–4).
        caller_trust_tier: Caller's own trust tier.
        caller_principal_role: Caller's principal role (owner/admin/operator).
        org_id: Organisation scope.

    Returns:
        Result dict with contact_id and new_tier.
    """
    check_gatekeeper_access(caller_trust_tier, caller_principal_role)

    service = TrustProgressionService()
    await service.set_tier(
        contact_id=contact_id,
        new_tier=new_tier,
        caller_tier=caller_trust_tier,
        caller_principal_role=caller_principal_role,
    )
    return {"contact_id": contact_id, "new_tier": new_tier, "action": "promoted"}
