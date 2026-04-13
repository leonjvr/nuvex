"""ContactResolver — resolve or auto-create contacts from inbound channel handles.

Uses an in-process async TTL cache (30 s) keyed on (org_id, channel_type, handle).
Cache is invalidated on any trust/sanction write via ContactResolver.invalidate().
"""
from __future__ import annotations

import logging
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select

from ..db import get_session
from ..models.contact import Contact, ContactHandle
from ..models.principal import Principal

log = logging.getLogger(__name__)

_TTL_SECONDS = 30

# In-process cache: key → (ContactResolution, inserted_at)
_cache: dict[tuple, tuple] = {}


@dataclass
class ContactResolution:
    contact_id: Optional[str]
    display_name: str
    trust_tier: int
    sanction: Optional[str]
    sanction_until: Optional[datetime]
    is_anonymous: bool = False


def _cache_key(org_id: str, channel_type: str, handle: str) -> tuple:
    return (org_id, channel_type, handle)


def _get_cached(key: tuple) -> Optional[ContactResolution]:
    entry = _cache.get(key)
    if entry is None:
        return None
    resolution, inserted_at = entry
    if time.monotonic() - inserted_at > _TTL_SECONDS:
        del _cache[key]
        return None
    return resolution


def _set_cached(key: tuple, resolution: ContactResolution) -> None:
    _cache[key] = (resolution, time.monotonic())


def invalidate(org_id: str, channel_type: str, handle: str) -> None:
    """Remove a specific entry from the TTL cache (call after trust/sanction writes)."""
    _cache.pop(_cache_key(org_id, channel_type, handle), None)


def invalidate_contact(contact_id: str) -> None:
    """Remove all cache entries for a given contact_id."""
    to_delete = [k for k, (r, _) in _cache.items() if r.contact_id == contact_id]
    for k in to_delete:
        _cache.pop(k, None)


class ContactResolver:
    """Resolve or auto-create a Contact from an inbound channel handle."""

    async def resolve(
        self,
        org_id: str,
        channel_type: str,
        handle: Optional[str],
        sender_name: Optional[str] = None,
    ) -> ContactResolution:
        """Return a ContactResolution for the given handle.

        If handle is None, returns an anonymous T0 resolution without DB writes.
        """
        if handle is None:
            return ContactResolution(
                contact_id=None,
                display_name=sender_name or "Anonymous",
                trust_tier=0,
                sanction=None,
                sanction_until=None,
                is_anonymous=True,
            )

        key = _cache_key(org_id, channel_type, handle)
        cached = _get_cached(key)
        if cached is not None:
            return cached

        resolution = await self._resolve_or_create(org_id, channel_type, handle, sender_name)
        _set_cached(key, resolution)
        return resolution

    async def _resolve_or_create(
        self,
        org_id: str,
        channel_type: str,
        handle: str,
        sender_name: Optional[str],
    ) -> ContactResolution:
        async with get_session() as session:
            # Look up existing handle
            result = await session.execute(
                select(ContactHandle).where(
                    ContactHandle.channel_type == channel_type,
                    ContactHandle.handle == handle,
                )
            )
            existing_handle = result.scalar_one_or_none()

            if existing_handle is not None:
                contact = await session.get(Contact, existing_handle.contact_id)
                if contact is None:
                    # Orphan handle — fall through to create
                    pass
                else:
                    # Apply principal-based tier floor
                    effective_tier = await self._apply_principal_floor(
                        session, org_id, contact.id, contact.trust_tier
                    )
                    # Update last_seen
                    contact.last_seen_at = datetime.now(timezone.utc)
                    await session.commit()
                    return ContactResolution(
                        contact_id=contact.id,
                        display_name=contact.display_name,
                        trust_tier=effective_tier,
                        sanction=contact.sanction,
                        sanction_until=contact.sanction_until,
                    )

            # Auto-create T0 contact
            now = datetime.now(timezone.utc)
            contact_id = str(uuid.uuid4())
            display_name = sender_name or handle
            new_contact = Contact(
                id=contact_id,
                org_id=org_id,
                display_name=display_name,
                trust_tier=0,
                last_seen_at=now,
            )
            new_handle = ContactHandle(
                id=str(uuid.uuid4()),
                contact_id=contact_id,
                channel_type=channel_type,
                handle=handle,
            )
            session.add(new_contact)
            session.add(new_handle)
            await session.commit()
            log.info("contact: auto-created T0 contact id=%s handle=%s", contact_id, handle)
            return ContactResolution(
                contact_id=contact_id,
                display_name=display_name,
                trust_tier=0,
                sanction=None,
                sanction_until=None,
            )

    async def _apply_principal_floor(
        self,
        session,
        org_id: str,
        contact_id: str,
        current_tier: int,
    ) -> int:
        """Owner link → T3 floor; admin link → T2 floor."""
        result = await session.execute(
            select(Principal).where(
                Principal.org_id == org_id,
                Principal.contact_id == contact_id,
            )
        )
        principal = result.scalar_one_or_none()
        if principal is None:
            return current_tier
        floor = {"owner": 3, "admin": 2, "operator": 1}.get(principal.role, 0)
        return max(current_tier, floor)
