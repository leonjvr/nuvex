"""Audit trail — append a chained SHA-256 governance audit record."""
from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select

from ..state import AgentState
from ..db import get_session
from ..models.governance import GovernanceAudit

log = logging.getLogger(__name__)


def _hash(row: dict[str, Any], prev_hash: str | None) -> str:
    data = json.dumps({**row, "prev_hash": prev_hash or ""}, sort_keys=True, default=str)
    return hashlib.sha256(data.encode()).hexdigest()


async def append_audit(
    state: AgentState,
    action: str,
    tool_name: str | None,
    decision: str,
    stage: str,
    reason: str | None = None,
    cost_usd: float = 0.0,
) -> None:
    """Write one chained audit entry to `governance_audit`."""
    async with get_session() as session:
        # Fetch previous hash for chain integrity
        result = await session.execute(
            select(GovernanceAudit.sha256_hash)
            .where(GovernanceAudit.agent_id == state.agent_id)
            .order_by(GovernanceAudit.id.desc())
            .limit(1)
        )
        prev_hash = result.scalar_one_or_none()

        row_data = {
            "agent_id": state.agent_id,
            "org_id": state.org_id,
            "invocation_id": state.invocation_id,
            "thread_id": state.thread_id,
            "action": action,
            "tool_name": tool_name,
            "decision": decision,
            "stage": stage,
            "reason": reason,
            "cost_usd": cost_usd,
        }
        sha = _hash(row_data, prev_hash)

        entry = GovernanceAudit(
            **row_data,
            sha256_hash=sha,
            prev_hash=prev_hash,
        )
        session.add(entry)
        await session.commit()


async def verify_chain(agent_id: str) -> tuple[bool, str]:
    """Verify the SHA-256 chain for all audit entries belonging to `agent_id`.

    Returns (valid: bool, message: str).
    - valid=True  → all hashes match; chain is intact.
    - valid=False → mismatch at a specific entry id; chain may be tampered.
    """
    async with get_session() as session:
        result = await session.execute(
            select(GovernanceAudit)
            .where(GovernanceAudit.agent_id == agent_id)
            .order_by(GovernanceAudit.id.asc())
        )
        entries: list[GovernanceAudit] = list(result.scalars())

    if not entries:
        return True, "no entries"

    for entry in entries:
        row_data = {
            "agent_id": entry.agent_id,
            "invocation_id": entry.invocation_id,
            "thread_id": entry.thread_id,
            "action": entry.action,
            "tool_name": entry.tool_name,
            "decision": entry.decision,
            "stage": entry.stage,
            "reason": entry.reason,
            "cost_usd": entry.cost_usd,
        }
        expected = _hash(row_data, entry.prev_hash)
        if expected != entry.sha256_hash:
            return False, f"hash mismatch at audit entry id={entry.id}"

    return True, f"chain valid ({len(entries)} entries)"
