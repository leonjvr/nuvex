"""schedule_review_reminder tool — create a 90-day review reminder cron entry."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from ._auth import check_gatekeeper_access
from ...db import get_session
from ...models.cron import CronEntry


async def schedule_review_reminder(
    contact_id: str,
    agent_id: str,
    caller_trust_tier: int = 0,
    caller_principal_role: str | None = None,
) -> dict:
    """Schedule a 90-day review reminder for a contact.

    Creates a one-shot cron entry that fires 90 days from now.

    Args:
        contact_id: UUID of the contact to review.
        agent_id: Agent that should receive the reminder.
        caller_trust_tier: Caller's trust tier.
        caller_principal_role: Caller's principal role.

    Returns:
        Result dict with cron job name.
    """
    check_gatekeeper_access(caller_trust_tier, caller_principal_role)

    fire_at = datetime.now(timezone.utc) + timedelta(days=90)
    job_name = f"review_reminder:{contact_id}"

    async with get_session() as session:
        entry = CronEntry(
            name=job_name,
            agent_id=agent_id,
            schedule=fire_at.strftime("%M %H %d %m *"),
            task_payload={"action": "review_contact", "contact_id": contact_id},
            enabled=True,
            next_run_at=fire_at,
        )
        session.add(entry)
        await session.commit()

    return {
        "job_name": job_name,
        "contact_id": contact_id,
        "fire_at": fire_at.isoformat(),
    }
