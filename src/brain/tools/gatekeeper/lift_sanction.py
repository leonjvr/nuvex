"""lift_sanction tool — remove a sanction from a contact."""
from __future__ import annotations

from datetime import datetime, timezone

from ._auth import check_gatekeeper_access
from ...db import get_session
from ...models.contact import Contact
from ...identity.resolver import invalidate_contact


async def lift_sanction(
    contact_id: str,
    caller_trust_tier: int = 0,
    caller_principal_role: str | None = None,
) -> dict:
    """Remove the active sanction from a contact.

    Lifting a hard_ban requires owner role.

    Args:
        contact_id: UUID of the contact.
        caller_trust_tier: Caller's trust tier.
        caller_principal_role: Caller's principal role.

    Returns:
        Result dict.
    """
    check_gatekeeper_access(caller_trust_tier, caller_principal_role)

    async with get_session() as session:
        contact = await session.get(Contact, contact_id)
        if contact is None:
            raise ValueError(f"Contact {contact_id} not found")

        if contact.sanction == "hard_ban" and caller_principal_role != "owner":
            raise PermissionError("Lifting a hard_ban requires owner role")

        prev_sanction = contact.sanction
        contact.sanction = None
        contact.sanction_until = None
        contact.sanction_reason = None
        contact.updated_at = datetime.now(timezone.utc)
        await session.commit()

    invalidate_contact(contact_id)
    return {"contact_id": contact_id, "lifted_sanction": prev_sanction}
