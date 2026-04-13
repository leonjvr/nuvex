"""TrustProgressionService — handle automatic T0→T1 promotion and manual tier changes."""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from ..db import get_session
from ..models.contact import Contact
from .resolver import invalidate_contact

log = logging.getLogger(__name__)

# Default thresholds — overridden by config if available
_DEFAULT_MIN_MESSAGES = 5
_DEFAULT_MIN_DAYS = 1


def _load_progression_thresholds() -> tuple[int, int]:
    """Load T0→T1 thresholds from NuvexConfig, falling back to defaults."""
    try:
        from ...shared.config import get_cached_config
        cfg = get_cached_config()
        tp = cfg.trust_progression
        return tp.t0_min_messages, tp.t0_min_days
    except Exception:
        return _DEFAULT_MIN_MESSAGES, _DEFAULT_MIN_DAYS


class TrustProgressionService:
    """Check and apply trust tier progression for contacts."""

    def __init__(
        self,
        min_messages: int | None = None,
        min_days: int | None = None,
    ) -> None:
        cfg_msgs, cfg_days = _load_progression_thresholds()
        self.min_messages = min_messages if min_messages is not None else cfg_msgs
        self.min_days = min_days if min_days is not None else cfg_days

    async def maybe_promote_t0(self, contact_id: str, org_id: str) -> bool:
        """Check if a T0 contact meets auto-promotion thresholds for T1.

        Returns True if promotion was applied.
        """
        async with get_session() as session:
            contact = await session.get(Contact, contact_id)
            if contact is None or contact.trust_tier != 0:
                return False

            age_days = 0.0
            if contact.created_at:
                now = datetime.now(timezone.utc)
                delta = now - contact.created_at.replace(tzinfo=timezone.utc)
                age_days = delta.total_seconds() / 86400

            if (
                contact.message_count >= self.min_messages
                and age_days >= self.min_days
            ):
                contact.trust_tier = 1
                contact.updated_at = datetime.now(timezone.utc)
                await session.commit()
                invalidate_contact(contact_id)
                log.info(
                    "trust: auto-promoted contact=%s to T1 (msgs=%d days=%.1f)",
                    contact_id,
                    contact.message_count,
                    age_days,
                )
                return True
        return False

    async def set_tier(
        self,
        contact_id: str,
        new_tier: int,
        caller_tier: int,
        caller_principal_role: str | None = None,
    ) -> None:
        """Manually set a contact's trust tier.

        Rules:
        - T1→T2: admin or above
        - T2→T3: admin or above
        - T3→T4 (owner): owner only
        - Demotion from T4: owner only
        """
        if new_tier < 0 or new_tier > 4:
            raise ValueError(f"Invalid tier: {new_tier}")

        authorized = self._check_tier_auth(new_tier, caller_tier, caller_principal_role)
        if not authorized:
            raise PermissionError(
                f"Caller does not have permission to set tier {new_tier}"
            )

        async with get_session() as session:
            contact = await session.get(Contact, contact_id)
            if contact is None:
                raise ValueError(f"Contact {contact_id} not found")
            contact.trust_tier = new_tier
            contact.updated_at = datetime.now(timezone.utc)
            await session.commit()
        invalidate_contact(contact_id)
        log.info("trust: set contact=%s to tier=%d", contact_id, new_tier)

    def _check_tier_auth(
        self,
        new_tier: int,
        caller_tier: int,
        caller_role: str | None,
    ) -> bool:
        owner_only = new_tier == 4 or new_tier == 0  # T4 or demotion to T0 from high tier
        if caller_role == "owner":
            return True
        if owner_only:
            return False
        if caller_role in ("admin", "operator") and new_tier <= 3:
            return True
        return caller_tier >= 3

    async def increment_message_count(self, contact_id: str) -> None:
        """Increment message_count for a contact (call after each invocation)."""
        async with get_session() as session:
            contact = await session.get(Contact, contact_id)
            if contact is not None:
                contact.message_count = (contact.message_count or 0) + 1
                contact.last_seen_at = datetime.now(timezone.utc)
                await session.commit()
