"""Memory dreamer — once-daily deep reflection pass per agent.

Terminology:
  Self-reflection = per-thread consolidation (MemoryConsolidator, fires at thread end)
  Dreaming        = this module — a periodic offline pass that synthesizes, resolves
                    contradictions, and moves fading knowledge to long-term archive.

Archival model (inspired by human memory):
  Memories are never deleted. Low-confidence or contradicted memories are moved to
  scope='archived' — they remain in the DB and can be recalled explicitly, but are
  excluded from normal semantic retrieval (like hard-to-surface long-term memories).
  Only division and org scope memories are immune from archiving.

Three-gate trigger (all must pass):
  1. Time gate    — at least 24 h since last dream (configurable via DREAM_MIN_HOURS)
  2. Session gate — at least 5 threads completed since last dream (DREAM_MIN_THREADS)
  3. Lock gate    — PostgreSQL advisory lock on agent_id prevents concurrent dreams

Four-phase prompt:
  Phase 1 — Orient     : summarise what memories exist (count, scope breakdown)
  Phase 2 — Signal     : fetch recent memories written since last dream
  Phase 3 — Synthesize : resolve contradictions, merge near-duplicates, elevate confidence
  Phase 4 — Prune      : decay stale/unconfirmed facts (archiving when below threshold)
"""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone, timedelta
from typing import Any

from sqlalchemy import text

from ..db import get_session

log = logging.getLogger(__name__)

_DREAM_MIN_HOURS: int = int(os.environ.get("DREAM_MIN_HOURS", "24"))
_DREAM_MIN_THREADS: int = int(os.environ.get("DREAM_MIN_THREADS", "5"))
_MAX_MEMORIES_PER_DREAM = 60
_CONFIDENCE_BOOST = 0.05
_CONTRADICTION_DECAY = 0.15
_STALE_DECAY = 0.03
_ARCHIVE_THRESHOLD = 0.25  # memories whose confidence falls at or below this are archived, not zeroed

_DREAM_PROMPT = """You are performing a memory dream — a deep reflective pass over an AI agent's memory pool.

Your job:
1. ORIENT: You are given a summary of the agent's current memory pool.
2. SYNTHESIZE: Analyse the recent memories for contradictions, redundancy, and elevation opportunities.
3. RESOLVE: For each pair of contradicting facts, decide which is more reliable and mark the other for decay.
4. ELEVATE: If 2+ memories reinforce the same fact, mark the strongest for confidence boost.
5. OUTPUT: Reply ONLY with a JSON array of operations, one per line (not wrapped in a code block):

Each operation is one of:
  {{"op": "boost",   "id": <int>, "reason": "<short string>"}}
  {{"op": "decay",   "id": <int>, "reason": "<short string>"}}
  {{"op": "no_change", "id": <int>}}

Rules:
- Every memory in the list must appear in your output exactly once.
- Contradicting pair: decay the older or lower-confidence one; boost the other.
- Redundant duplicate: decay all but the highest-confidence one.
- Isolated, unreferenced, low-confidence (<0.55) fact older than 7 days: decay.
- Everything else: no_change.
- Do not invent new memory IDs. Use only the IDs provided.

Agent: {agent_id}
Dream run at: {now}
Last dream: {last_dream}
Threads since last dream: {threads_since}

Recent memories (id | confidence | scope | created_at | content):
{memory_lines}
"""


async def _check_gates(agent_id: str) -> tuple[bool, str]:
    """Return (may_dream, reason). All three gates must pass."""
    async with get_session() as session:
        result = await session.execute(
            text("SELECT last_dream_at, threads_since_dream FROM memory_dream_log WHERE agent_id = :aid"),
            {"aid": agent_id},
        )
        row = result.mappings().first()

    last_dream_at: datetime | None = row["last_dream_at"] if row else None
    threads_since: int = int(row["threads_since_dream"]) if row else 0

    # Gate 1 — time
    if last_dream_at is not None:
        elapsed_hours = (datetime.now(timezone.utc) - last_dream_at).total_seconds() / 3600
        if elapsed_hours < _DREAM_MIN_HOURS:
            return False, f"time gate: only {elapsed_hours:.1f}h since last dream (min {_DREAM_MIN_HOURS}h)"

    # Gate 2 — sessions/threads
    if threads_since < _DREAM_MIN_THREADS:
        return False, f"session gate: only {threads_since} threads since last dream (min {_DREAM_MIN_THREADS})"

    return True, "all gates passed"


async def _acquire_lock(session: Any, agent_id: str) -> bool:
    """Try to acquire a PostgreSQL advisory lock keyed on agent_id hash. Non-blocking."""
    # Use a stable integer derived from agent_id string hash
    lock_key = abs(hash(f"dream:{agent_id}")) % (2**31)
    result = await session.execute(
        text("SELECT pg_try_advisory_lock(:key)"),
        {"key": lock_key},
    )
    return bool(result.scalar())


async def _release_lock(session: Any, agent_id: str) -> None:
    lock_key = abs(hash(f"dream:{agent_id}")) % (2**31)
    await session.execute(
        text("SELECT pg_advisory_unlock(:key)"),
        {"key": lock_key},
    )


async def _fetch_recent_memories(agent_id: str, since: datetime | None) -> list[dict]:
    """Fetch memories written since last dream (or last 7 days if no prior dream)."""
    cutoff = since or (datetime.now(timezone.utc) - timedelta(days=7))
    async with get_session() as session:
        result = await session.execute(
            text("""
                SELECT id, confidence, scope, created_at, content, retrieval_count
                FROM memories
                WHERE agent_id = :aid
                  AND created_at >= :cutoff
                ORDER BY confidence DESC, created_at DESC
                LIMIT :limit
            """),
            {"aid": agent_id, "cutoff": cutoff, "limit": _MAX_MEMORIES_PER_DREAM},
        )
        return [dict(r._mapping) for r in result.fetchall()]


async def _call_llm(prompt: str, model: str) -> list[dict]:
    """Call the LLM and parse JSON operation lines."""
    try:
        from langchain_openai import ChatOpenAI
        from langchain_anthropic import ChatAnthropic

        if "claude" in model.lower() or "anthropic" in model.lower():
            llm = ChatAnthropic(model=model.split("/")[-1])  # type: ignore[call-arg]
        else:
            llm = ChatOpenAI(model=model.split("/")[-1])

        response = await llm.ainvoke(prompt)
        content = response.content if hasattr(response, "content") else str(response)
        ops = []
        for line in str(content).splitlines():
            line = line.strip()
            if not line or not line.startswith("{"):
                continue
            try:
                obj = json.loads(line)
                if "op" in obj and "id" in obj:
                    ops.append(obj)
            except json.JSONDecodeError:
                continue
        return ops
    except Exception as exc:
        log.warning("dreamer: LLM call failed: %s", exc)
        return []


async def _apply_operations(ops: list[dict]) -> tuple[int, int]:
    """Apply boost/decay/archive operations to memories. Returns (boosted, archived_or_decayed)."""
    boosted = decayed = 0
    for op in ops:
        op_type = op.get("op")
        mem_id = op.get("id")
        if op_type == "no_change" or not mem_id:
            continue
        try:
            async with get_session() as session:
                if op_type == "boost":
                    await session.execute(
                        text("""
                            UPDATE memories
                            SET confidence = LEAST(1.0, confidence + :delta)
                            WHERE id = :id
                        """),
                        {"delta": _CONFIDENCE_BOOST, "id": mem_id},
                    )
                    await session.commit()
                    boosted += 1
                elif op_type == "decay":
                    # Check current confidence — if it would fall to or below the archive
                    # threshold, archive the memory instead of zeroing it out.
                    # Like human long-term memory: hard to surface but not gone.
                    await session.execute(
                        text("""
                            UPDATE memories
                            SET
                                scope = CASE
                                    WHEN confidence - :delta <= :archive_threshold
                                         AND scope NOT IN ('division', 'org')
                                    THEN 'archived'
                                    ELSE scope
                                END,
                                confidence = GREATEST(0.0, confidence - :delta)
                            WHERE id = :id
                        """),
                        {
                            "delta": _CONTRADICTION_DECAY,
                            "archive_threshold": _ARCHIVE_THRESHOLD,
                            "id": mem_id,
                        },
                    )
                    await session.commit()
                    decayed += 1
        except Exception as exc:
            log.warning("dreamer: apply op failed (id=%s op=%s): %s", mem_id, op_type, exc)

    return boosted, decayed


async def _record_dream(agent_id: str) -> None:
    """Reset threads_since_dream to 0 and update last_dream_at."""
    async with get_session() as session:
        await session.execute(
            text("""
                INSERT INTO memory_dream_log (agent_id, last_dream_at, threads_since_dream, dream_count)
                VALUES (:aid, now(), 0, 1)
                ON CONFLICT (agent_id) DO UPDATE
                SET last_dream_at = now(),
                    threads_since_dream = 0,
                    dream_count = memory_dream_log.dream_count + 1
            """),
            {"aid": agent_id},
        )
        await session.commit()


class MemoryDreamer:
    """Once-daily deep reflection pass for an agent's memory pool."""

    def __init__(self, agent_id: str, model: str = "gpt-4o-mini") -> None:
        self.agent_id = agent_id
        self.model = model

    async def dream(self) -> dict[str, Any]:
        """Run a dream pass if all gates pass. Returns result dict."""
        may_dream, reason = await _check_gates(self.agent_id)
        if not may_dream:
            log.debug("dreamer: skipping agent=%s — %s", self.agent_id, reason)
            return {"skipped": True, "reason": reason}

        # Gate 3 — advisory lock (use a fresh connection held for the duration)
        async with get_session() as lock_session:
            locked = await _acquire_lock(lock_session, self.agent_id)
            if not locked:
                log.info("dreamer: lock held for agent=%s, skipping", self.agent_id)
                return {"skipped": True, "reason": "lock gate: another dream in progress"}

            try:
                return await self._run_dream(lock_session)
            finally:
                await _release_lock(lock_session, self.agent_id)

    async def _run_dream(self, lock_session: Any) -> dict[str, Any]:
        """Execute the four-phase dream. Lock is held by caller."""
        log.info("dreamer: starting dream for agent=%s", self.agent_id)

        # Fetch last dream info for prompt context
        result = await lock_session.execute(
            text("SELECT last_dream_at, threads_since_dream FROM memory_dream_log WHERE agent_id = :aid"),
            {"aid": self.agent_id},
        )
        row = result.mappings().first()
        last_dream_at: datetime | None = row["last_dream_at"] if row else None
        threads_since: int = int(row["threads_since_dream"]) if row else 0

        # Phase 1 + 2 — Orient + Signal: fetch recent memories
        memories = await _fetch_recent_memories(self.agent_id, last_dream_at)
        if not memories:
            log.info("dreamer: no recent memories for agent=%s — recording dream anyway", self.agent_id)
            await _record_dream(self.agent_id)
            return {"agent_id": self.agent_id, "memories_reviewed": 0, "boosted": 0, "decayed": 0}

        # Phase 3 — Synthesize: build prompt and call LLM
        memory_lines = "\n".join(
            f"{m['id']} | {m['confidence']:.2f} | {m['scope']} | {m['created_at'].date() if m['created_at'] else '?'} | {str(m['content'])[:120]}"
            for m in memories
        )
        prompt = _DREAM_PROMPT.format(
            agent_id=self.agent_id,
            now=datetime.now(timezone.utc).isoformat(),
            last_dream=last_dream_at.isoformat() if last_dream_at else "never",
            threads_since=threads_since,
            memory_lines=memory_lines,
        )

        ops = await _call_llm(prompt, self.model)

        # Phase 4a — Apply operations (boost/decay/archive)
        boosted, decayed = await _apply_operations(ops)

        # Phase 4b — Synthesize relationships: second LLM pass forms edges across
        # the full reviewed memory pool (the same way self-reflection does per-thread,
        # but here we build cross-thread, cross-time connections).
        fact_ids = [int(m["id"]) for m in memories]
        fact_contents = [str(m["content"])[:120] for m in memories]
        edges_written = 0
        try:
            from .consolidator import MemoryConsolidator
            consolidator = MemoryConsolidator(
                agent_id=self.agent_id,
                fast_model=self.model,
            )
            edges_written = await consolidator.extract_edges(fact_ids, fact_contents)
            log.info("dreamer: edges synthesized agent=%s count=%d", self.agent_id, edges_written)
        except Exception as exc:
            log.warning("dreamer: edge synthesis failed (non-fatal): %s", exc)

        # Record the completed dream
        await _record_dream(self.agent_id)

        log.info(
            "dreamer: dream complete agent=%s memories=%d boosted=%d decayed=%d edges=%d",
            self.agent_id, len(memories), boosted, decayed, edges_written,
        )
        return {
            "agent_id": self.agent_id,
            "memories_reviewed": len(memories),
            "boosted": boosted,
            "decayed": decayed,
            "edges_written": edges_written,
        }


async def increment_thread_count(agent_id: str) -> None:
    """Increment threads_since_dream counter. Called after every thread consolidation."""
    try:
        async with get_session() as session:
            await session.execute(
                text("""
                    INSERT INTO memory_dream_log (agent_id, last_dream_at, threads_since_dream, dream_count)
                    VALUES (:aid, NULL, 1, 0)
                    ON CONFLICT (agent_id) DO UPDATE
                    SET threads_since_dream = memory_dream_log.threads_since_dream + 1
                """),
                {"aid": agent_id},
            )
            await session.commit()
    except Exception as exc:
        log.debug("dreamer: increment_thread_count failed (non-fatal): %s", exc)
