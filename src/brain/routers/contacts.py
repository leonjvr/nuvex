"""GET /api/contacts — contact directory API (brain service)."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from ..db import get_session
from ..models.contact import Contact, ContactHandle

router = APIRouter(prefix="/contacts", tags=["contacts"])


@router.get("")
async def list_contacts(
    org_id: str = "default",
    tier: int | None = None,
    sanction: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> dict:
    async with get_session() as session:
        q = select(Contact).where(Contact.org_id == org_id)
        if tier is not None:
            q = q.where(Contact.trust_tier == tier)
        if sanction is not None:
            q = q.where(Contact.sanction == sanction)
        q = q.limit(limit).offset(offset)
        result = await session.execute(q)
        rows = result.scalars().all()

        items = []
        for c in rows:
            handles_result = await session.execute(
                select(ContactHandle).where(ContactHandle.contact_id == c.id)
            )
            handles = handles_result.scalars().all()
            items.append(_serialize(c, handles))

    return {"items": items, "limit": limit, "offset": offset}


@router.get("/{contact_id}")
async def get_contact(contact_id: str) -> dict:
    async with get_session() as session:
        contact = await session.get(Contact, contact_id)
        if contact is None:
            raise HTTPException(404, "Contact not found")
        handles_result = await session.execute(
            select(ContactHandle).where(ContactHandle.contact_id == contact_id)
        )
        handles = handles_result.scalars().all()
    return _serialize(contact, handles)


@router.get("/{contact_id}/history")
async def get_contact_history(contact_id: str, limit: int = 50) -> list[dict]:
    """Return trust tier and sanction change events from the governance audit log."""
    async with get_session() as session:
        from ..models.governance import GovernanceAudit
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
    return [
        {
            "id": r.id,
            "action": r.action,
            "decision": r.decision,
            "reason": r.reason,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]


def _serialize(contact: Contact, handles: list) -> dict:
    return {
        "id": contact.id,
        "org_id": contact.org_id,
        "display_name": contact.display_name,
        "trust_tier": contact.trust_tier,
        "sanction": contact.sanction,
        "sanction_until": (
            contact.sanction_until.isoformat() if contact.sanction_until else None
        ),
        "message_count": contact.message_count,
        "last_seen_at": (
            contact.last_seen_at.isoformat() if contact.last_seen_at else None
        ),
        "handles": [
            {"channel_type": h.channel_type, "handle": h.handle} for h in handles
        ],
        "created_at": contact.created_at.isoformat() if contact.created_at else None,
    }
