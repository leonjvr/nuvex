"""Contact context block — builds the contact identity section for the system prompt.

Queries contact display name, trust tier, sanction, relationships, and context
entries from DB. Updates last_referenced on fetched context rows. Applies
confidence decay based on days since last_referenced.

§6.1 — inject contact identity into system prompt
§6.2 — inject contact_context rows (confidence ≥ 0.5)
§6.3 — update last_referenced on used rows
§6.4 — confidence decay: confidence * decay_factor ^ (days_since_referenced)
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy import select, update

from ..db import get_session
from ..models.contact import Contact, ContactHandle
from ..models.contact_context import ContactContext
from ..models.contact_relationship import ContactRelationship

log = logging.getLogger(__name__)

_MIN_CONFIDENCE = 0.5


async def build_contact_context_block(agent_id: str, contact_id: str | None) -> str:
    """Return a formatted string block describing the current contact.

    Returns empty string if contact_id is None or DB lookup fails.
    """
    if not contact_id:
        return ""
    try:
        return await _fetch_and_build(agent_id, contact_id)
    except Exception as exc:
        log.debug("contact_context_block: skipping (non-fatal): %s", exc)
        return ""


async def _fetch_and_build(agent_id: str, contact_id: str) -> str:
    now = datetime.now(timezone.utc)
    parts: list[str] = []

    async with get_session() as session:
        # 6.1 — load contact identity
        contact = await session.get(Contact, contact_id)
        if contact is None:
            return ""

        tier_label = f"T{contact.trust_tier}"
        sanction_str = f" | sanction: {contact.sanction}" if contact.sanction else ""
        parts.append(
            f"## Current Contact\n"
            f"Name: {contact.display_name}\n"
            f"Trust tier: {tier_label}{sanction_str}\n"
            f"Message count: {contact.message_count}"
        )

        # Channel handles
        handle_result = await session.execute(
            select(ContactHandle).where(ContactHandle.contact_id == contact_id)
        )
        handles = handle_result.scalars().all()
        if handles:
            handle_lines = [f"  - {h.channel_type}: {h.handle}" for h in handles]
            parts.append("Handles:\n" + "\n".join(handle_lines))

        # Relationships
        rel_result = await session.execute(
            select(ContactRelationship).where(
                (ContactRelationship.contact_id_a == contact_id)
                | (ContactRelationship.contact_id_b == contact_id)
            ).limit(10)
        )
        relationships = rel_result.scalars().all()
        if relationships:
            rel_lines = []
            for r in relationships:
                other = r.contact_id_b if r.contact_id_a == contact_id else r.contact_id_a
                rel_lines.append(f"  - {r.relationship_type} with contact {other}")
            parts.append("Known relationships:\n" + "\n".join(rel_lines))

        # 6.2 — load contact_context rows with confidence ≥ 0.5 after decay
        ctx_result = await session.execute(
            select(ContactContext).where(
                ContactContext.agent_id == agent_id,
                ContactContext.contact_id == contact_id,
            ).order_by(ContactContext.confidence.desc()).limit(20)
        )
        ctx_rows = ctx_result.scalars().all()

        used_ctx_ids: list[str] = []
        ctx_lines: list[str] = []
        for ctx in ctx_rows:
            # 6.4 — apply decay
            effective_confidence = ctx.confidence
            if ctx.last_referenced:
                ref_dt = ctx.last_referenced
                if ref_dt.tzinfo is None:
                    ref_dt = ref_dt.replace(tzinfo=timezone.utc)
                days_since = (now - ref_dt).total_seconds() / 86400
                effective_confidence = ctx.confidence * (ctx.decay_factor ** days_since)

            if effective_confidence >= _MIN_CONFIDENCE:
                ctx_lines.append(f"  - {ctx.key}: {ctx.value} (confidence: {effective_confidence:.2f})")
                used_ctx_ids.append(ctx.id)

        if ctx_lines:
            parts.append("Known context:\n" + "\n".join(ctx_lines))

        # 6.3 — update last_referenced for used rows
        if used_ctx_ids:
            await session.execute(
                update(ContactContext)
                .where(ContactContext.id.in_(used_ctx_ids))
                .values(last_referenced=now)
            )
            await session.commit()

    if not parts:
        return ""
    return "\n\n".join(parts)
