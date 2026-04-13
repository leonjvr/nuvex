"""resolve_contact tool — look up a contact by name or handle."""
from __future__ import annotations

from sqlalchemy import or_, select

from ...db import get_session
from ...models.contact import Contact, ContactHandle
from ._auth import check_gatekeeper_access


async def resolve_contact(
    query: str,
    caller_trust_tier: int = 0,
    caller_principal_role: str | None = None,
    org_id: str = "default",
) -> dict:
    """Look up a contact by display_name or handle.

    Args:
        query: Display name or channel handle to search.
        caller_trust_tier: Trust tier of the calling agent's contact.
        caller_principal_role: Principal role of the caller (owner/admin/operator/None).
        org_id: Organisation scope.

    Returns:
        Contact identity summary dict.
    """
    check_gatekeeper_access(caller_trust_tier, caller_principal_role)

    async with get_session() as session:
        # Search by handle first
        handle_result = await session.execute(
            select(ContactHandle).where(ContactHandle.handle.ilike(f"%{query}%"))
        )
        handle_rows = handle_result.scalars().all()
        contact_ids = {h.contact_id for h in handle_rows}

        # Also search by display_name
        contact_result = await session.execute(
            select(Contact).where(
                Contact.org_id == org_id,
                or_(
                    Contact.display_name.ilike(f"%{query}%"),
                    Contact.id.in_(contact_ids),
                ),
            ).limit(10)
        )
        contacts = contact_result.scalars().all()

    if not contacts:
        return {"found": False, "query": query}

    results = []
    for c in contacts:
        results.append({
            "contact_id": c.id,
            "display_name": c.display_name,
            "trust_tier": c.trust_tier,
            "sanction": c.sanction,
            "message_count": c.message_count,
        })
    return {"found": True, "query": query, "results": results}
