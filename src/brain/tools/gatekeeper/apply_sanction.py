"""apply_sanction tool — apply a sanction to a contact."""
from __future__ import annotations

from datetime import datetime, timezone

from ._auth import check_gatekeeper_access
from ...db import get_session
from ...models.contact import Contact
from ...identity.resolver import invalidate_contact

VALID_SANCTIONS = {"temp_ban", "hard_ban", "shadowban", "under_review"}


async def apply_sanction(
    contact_id: str,
    sanction: str,
    reason: str,
    sanction_until: str | None = None,
    caller_trust_tier: int = 0,
    caller_principal_role: str | None = None,
) -> dict:
    """Apply a sanction to a contact.

    hard_ban requires owner role. Other sanctions require operator/admin/owner or T3+.

    Args:
        contact_id: UUID of the contact.
        sanction: One of temp_ban | hard_ban | shadowban | under_review.
        reason: Human-readable reason for the sanction.
        sanction_until: ISO8601 datetime for temp_ban expiry (optional).
        caller_trust_tier: Caller's trust tier.
        caller_principal_role: Caller's principal role.

    Returns:
        Result dict.
    """
    check_gatekeeper_access(caller_trust_tier, caller_principal_role)

    if sanction not in VALID_SANCTIONS:
        raise ValueError(f"Invalid sanction. Must be one of: {', '.join(VALID_SANCTIONS)}")

    if sanction == "hard_ban" and caller_principal_role != "owner":
        raise PermissionError("hard_ban requires owner role")

    until_dt: datetime | None = None
    if sanction_until:
        until_dt = datetime.fromisoformat(sanction_until)
        if until_dt.tzinfo is None:
            until_dt = until_dt.replace(tzinfo=timezone.utc)

    async with get_session() as session:
        contact = await session.get(Contact, contact_id)
        if contact is None:
            raise ValueError(f"Contact {contact_id} not found")
        contact.sanction = sanction
        contact.sanction_until = until_dt
        contact.sanction_reason = reason
        contact.updated_at = datetime.now(timezone.utc)
        await session.commit()

    invalidate_contact(contact_id)
    return {
        "contact_id": contact_id,
        "sanction": sanction,
        "sanction_until": sanction_until,
        "reason": reason,
    }
