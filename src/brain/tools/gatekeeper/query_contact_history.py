"""query_contact_history tool — return trust/sanction events for a contact."""
from __future__ import annotations

from sqlalchemy import select

from ._auth import check_gatekeeper_access
from ...db import get_session
from ...models.governance import GovernanceAudit


async def query_contact_history(
    contact_id: str,
    limit: int = 20,
    caller_trust_tier: int = 0,
    caller_principal_role: str | None = None,
) -> dict:
    """Return the last N trust and sanction events for a contact.

    Args:
        contact_id: UUID of the contact.
        limit: Maximum number of events to return (default 20).
        caller_trust_tier: Caller's trust tier.
        caller_principal_role: Caller's principal role.

    Returns:
        Dict with contact_id and list of events.
    """
    check_gatekeeper_access(caller_trust_tier, caller_principal_role)

    async with get_session() as session:
        result = await session.execute(
            select(GovernanceAudit)
            .where(
                GovernanceAudit.stage == "identity",
                GovernanceAudit.action.contains(contact_id),
            )
            .order_by(GovernanceAudit.created_at.desc())
            .limit(limit)
        )
        rows = result.scalars().all()

    events = [
        {
            "id": r.id,
            "action": r.action,
            "decision": r.decision,
            "reason": r.reason,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]
    return {"contact_id": contact_id, "events": events, "count": len(events)}
