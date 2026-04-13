"""record_relationship tool — create a relationship between two contacts."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from ._auth import check_gatekeeper_access
from ...db import get_session
from ...models.contact_relationship import ContactRelationship


async def record_relationship(
    contact_id_a: str,
    contact_id_b: str,
    relationship_type: str,
    notes: str | None = None,
    caller_agent_id: str | None = None,
    caller_trust_tier: int = 0,
    caller_principal_role: str | None = None,
) -> dict:
    """Record a relationship between two contacts.

    Args:
        contact_id_a: First contact UUID.
        contact_id_b: Second contact UUID.
        relationship_type: Free-text relationship type (e.g. "colleague", "family").
        notes: Optional notes about the relationship.
        caller_agent_id: Agent ID recording this relationship.
        caller_trust_tier: Caller's trust tier.
        caller_principal_role: Caller's principal role.

    Returns:
        Created relationship dict.
    """
    check_gatekeeper_access(caller_trust_tier, caller_principal_role)

    rel = ContactRelationship(
        id=str(uuid.uuid4()),
        contact_id_a=contact_id_a,
        contact_id_b=contact_id_b,
        relationship_type=relationship_type,
        notes=notes,
        created_by_agent=caller_agent_id,
        created_at=datetime.now(timezone.utc),
    )

    async with get_session() as session:
        session.add(rel)
        await session.commit()

    return {
        "id": rel.id,
        "contact_id_a": contact_id_a,
        "contact_id_b": contact_id_b,
        "relationship_type": relationship_type,
    }
