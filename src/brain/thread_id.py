"""Thread ID utilities — build and parse NUVEX thread IDs.

Thread ID format (v2): ``{org_id}:{agent_id}:{channel}:{participant}``
Legacy format (v1):   ``{agent_id}:{channel}:{participant}``
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass
class ThreadIDParts:
    org_id: str
    agent_id: str
    channel: str
    participant: str


def build_thread_id(org_id: str, agent_id: str, channel: str, participant: str) -> str:
    """Build a v2 thread ID."""
    return f"{org_id}:{agent_id}:{channel}:{participant}"


def parse_thread_id(thread_id: str) -> ThreadIDParts:
    """Parse a thread ID — supports both v1 (3 parts) and v2 (4 parts) formats.

    v2: ``org_id:agent_id:channel:participant``
    v1: ``agent_id:channel:participant``  → org_id defaults to "default"
    """
    parts = thread_id.split(":", 3)
    if len(parts) == 4:
        return ThreadIDParts(
            org_id=parts[0],
            agent_id=parts[1],
            channel=parts[2],
            participant=parts[3],
        )
    if len(parts) == 3:
        # Legacy v1 — prepend default org
        return ThreadIDParts(
            org_id="default",
            agent_id=parts[0],
            channel=parts[1],
            participant=parts[2],
        )
    raise ValueError(f"Cannot parse thread_id: {thread_id!r} (expected 3 or 4 colon-separated parts)")
