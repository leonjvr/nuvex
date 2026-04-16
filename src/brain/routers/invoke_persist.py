"""DB persistence helpers for thread/message storage — invoked after each graph run."""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from ..db import get_session
from ..models.agent import Agent
from ..models.thread import Message, Thread

log = logging.getLogger(__name__)


async def ensure_agent_row(session, agent_id: str) -> None:
    """Insert a minimal Agent row from config if one doesn't exist yet."""
    existing = await session.get(Agent, agent_id)
    if existing is not None:
        return
    try:
        from ....shared.config import get_cached_config
        cfg = get_cached_config()
        agent_def = cfg.agents.get(agent_id)
    except Exception:
        agent_def = None

    name = agent_def.name if agent_def else agent_id
    tier = agent_def.tier if agent_def else "T1"
    division = agent_def.division if agent_def else "default"
    workspace_path = agent_def.workspace if agent_def else None
    config_snapshot = agent_def.model_dump() if agent_def else {}

    session.add(Agent(
        id=agent_id,
        name=name,
        tier=tier,
        division=division,
        workspace_path=workspace_path,
        config_snapshot=config_snapshot,
        lifecycle_state="ready",
    ))
    await session.flush()


async def persist_invocation(
    thread_id: str,
    agent_id: str,
    channel: str,
    sender: str,
    user_message: str,
    reply: str,
    tokens: int,
    metadata: dict,
    org_id: str = "default",
) -> None:
    """Upsert the Thread row and append user + assistant Message rows."""
    try:
        async with get_session() as session:
            await ensure_agent_row(session, agent_id)

            thread = await session.get(Thread, thread_id)
            now = datetime.now(timezone.utc)
            if thread is None:
                thread = Thread(
                    id=thread_id,
                    agent_id=agent_id,
                    org_id=org_id or "default",
                    channel=channel,
                    participants={sender: {"role": "user"}} if sender else {},
                    message_count=0,
                )
                session.add(thread)
                await session.flush()

            session.add(Message(
                thread_id=thread_id,
                role="user",
                content=user_message,
                tokens=len(user_message.split()),
                metadata_={"sender": sender, "channel": channel, **metadata},
            ))
            if reply:
                session.add(Message(
                    thread_id=thread_id,
                    role="assistant",
                    content=reply,
                    tokens=tokens,
                    metadata_={"sender": agent_id, "channel": channel},
                ))

            thread.message_count = (thread.message_count or 0) + (2 if reply else 1)
            thread.updated_at = now
            await session.commit()
    except Exception as exc:
        log.warning("persist_invocation failed (non-fatal): %s", exc)


# ---------------------------------------------------------------------------
# Legacy aliases — existing callers import the private names from routers.invoke
# ---------------------------------------------------------------------------
_ensure_agent_row = ensure_agent_row
_persist_invocation = persist_invocation
