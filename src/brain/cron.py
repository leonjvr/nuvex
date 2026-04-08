"""Cron registry — schedule recurring tasks via APScheduler + croniter."""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from croniter import croniter
from sqlalchemy import select

from .db import get_session
from .models.cron import CronEntry

log = logging.getLogger(__name__)

_scheduler: AsyncIOScheduler | None = None


def get_scheduler() -> AsyncIOScheduler:
    global _scheduler
    if _scheduler is None:
        _scheduler = AsyncIOScheduler(timezone="UTC")
    return _scheduler


async def start_scheduler() -> None:
    sched = get_scheduler()
    if not sched.running:
        sched.start()
        log.info("cron: APScheduler started")
        # Register system-level background jobs (Sections 29-30)
        _register_system_jobs(sched)


async def stop_scheduler() -> None:
    sched = get_scheduler()
    if sched.running:
        sched.shutdown(wait=False)


def _register_system_jobs(sched: AsyncIOScheduler) -> None:
    """Register built-in system background jobs (non-user-configurable)."""

    # 30.3.1 — Arousal state update: every 5 minutes
    if not sched.get_job("system:arousal_update"):
        sched.add_job(
            _run_arousal_update,
            "interval",
            id="system:arousal_update",
            minutes=5,
        )
        log.info("cron: registered system:arousal_update (every 5 min)")

    # 29.5.2 — Language gradient: weekly Monday 03:00 UTC
    if not sched.get_job("system:language_gradient"):
        sched.add_job(
            _run_language_gradient,
            "cron",
            id="system:language_gradient",
            day_of_week="mon",
            hour=3,
            minute=0,
        )
        log.info("cron: registered system:language_gradient (Monday 03:00 UTC)")

    # 29.6.2 — Routing outcome tracker: weekly Monday 03:00 UTC
    if not sched.get_job("system:routing_tracker"):
        sched.add_job(
            _run_routing_tracker,
            "cron",
            id="system:routing_tracker",
            day_of_week="mon",
            hour=3,
            minute=5,
        )
        log.info("cron: registered system:routing_tracker (Monday 03:05 UTC)")


async def _run_arousal_update() -> None:
    """Update arousal state for all registered agents (30.3.1)."""
    try:
        from ..shared.config import get_cached_config
        cfg = get_cached_config()
        agent_ids = list(cfg.agents.keys())
    except Exception as exc:
        log.warning("arousal_update: could not load agent list: %s", exc)
        return

    from .arousal import update_arousal, should_proactive_wake
    from .events import publish

    for agent_id in agent_ids:
        try:
            result = await update_arousal(agent_id)
            # 30.3.2 — check proactive wake conditions
            signals = result.get("signals")
            if signals and should_proactive_wake(
                pending_task_pressure=signals.pending_task_pressure,
                idle_seconds=signals.idle_seconds,
                last_arousal_score=result.get("last_arousal_score", 0.0),
                unread_channel_messages=signals.unread_channel_messages,
            ):
                log.info("arousal: proactive wake trigger for agent=%s", agent_id)
                await publish(
                    "arousal.proactive_wake",
                    {
                        "agent_id": agent_id,
                        "trigger_reason": "idle_with_pending_tasks",
                        "arousal_score": result.get("last_arousal_score"),
                    },
                    agent_id=agent_id,
                )
        except Exception as exc:
            log.warning("arousal_update: failed for agent=%s: %s", agent_id, exc)


async def _run_language_gradient() -> None:
    """Weekly language gradient job (29.5.2)."""
    try:
        from .jobs.language_gradient import run_language_gradient
        await run_language_gradient()
    except Exception as exc:
        log.error("language_gradient job failed: %s", exc)


async def _run_routing_tracker() -> None:
    """Weekly routing outcome tracker job (29.6.2)."""
    try:
        from .jobs.routing_outcome_tracker import run_routing_tracker
        await run_routing_tracker()
    except Exception as exc:
        log.error("routing_tracker job failed: %s", exc)


async def register_cron(
    name: str,
    agent_id: str,
    schedule: str,
    task_payload: dict[str, Any],
) -> None:
    """Persist a cron entry and add it to the live scheduler."""
    if not croniter.is_valid(schedule):
        raise ValueError(f"Invalid cron expression: {schedule}")

    async with get_session() as session:
        result = await session.execute(select(CronEntry).where(CronEntry.name == name))
        row: CronEntry | None = result.scalar_one_or_none()
        if row is None:
            row = CronEntry(name=name, agent_id=agent_id, schedule=schedule, task_payload=task_payload)
            session.add(row)
        else:
            row.schedule = schedule
            row.task_payload = task_payload
            row.enabled = True
        await session.commit()

    _schedule_job(name, agent_id, schedule, task_payload)


def _schedule_job(name: str, agent_id: str, schedule: str, payload: dict[str, Any]) -> None:
    sched = get_scheduler()
    job_id = f"cron:{name}"
    if sched.get_job(job_id):
        sched.remove_job(job_id)
    cron_parts = schedule.split()
    sched.add_job(
        _run_cron_task,
        "cron",
        id=job_id,
        minute=cron_parts[0],
        hour=cron_parts[1],
        day=cron_parts[2],
        month=cron_parts[3],
        day_of_week=cron_parts[4],
        kwargs={"name": name, "agent_id": agent_id, "payload": payload},
    )
    log.info("cron: scheduled job=%s schedule=%s", job_id, schedule)
# In-memory set of currently running cron job names (22.6 concurrency guard)
_active_jobs: set[str] = set()


async def _run_cron_task(name: str, agent_id: str, payload: dict[str, Any]) -> None:
    from .events import publish

    # 22.6 — skip if previous run still active
    if name in _active_jobs:
        log.warning("cron: skipping job=%s — previous run still active", name)
        return

    _active_jobs.add(name)
    try:
        log.info("cron: firing job=%s agent=%s", name, agent_id)
        await publish("cron.execution", {**payload, "cron_name": name}, agent_id=agent_id)

        async with get_session() as session:
            result = await session.execute(select(CronEntry).where(CronEntry.name == name))
            row = result.scalar_one_or_none()
            if row:
                row.last_run_at = datetime.now(timezone.utc)
                await session.commit()
    except Exception as exc:
        log.error("cron: job=%s failed: %s", name, exc)
    finally:
        _active_jobs.discard(name)


# ---------------------------------------------------------------------------
# HEARTBEAT.md parser
# Parse schedule blocks from HEARTBEAT.md and register them with the cron
# registry.  Expected format inside the file:
#
#   ## <job-name>
#   - schedule: 0 8 * * *
#   - agent: <agent_id>
#   - task: <task description>         (optional)
#   - payload_key: value               (optional, repeatable)
# ---------------------------------------------------------------------------

import re

_SECTION_RE = re.compile(r"^##\s+(.+)$")
_KV_RE = re.compile(r"^-\s+([\w_-]+):\s*(.+)$")


def parse_heartbeat_md(content: str) -> list[dict[str, Any]]:
    """Parse HEARTBEAT.md content and return a list of cron job dicts."""
    jobs: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None

    for line in content.splitlines():
        line = line.rstrip()
        section_match = _SECTION_RE.match(line)
        if section_match:
            if current and current.get("schedule") and current.get("agent"):
                jobs.append(current)
            current = {"name": section_match.group(1).strip()}
            continue
        if current is None:
            continue
        kv_match = _KV_RE.match(line)
        if kv_match:
            key, value = kv_match.group(1), kv_match.group(2).strip()
            if key == "schedule":
                current["schedule"] = value
            elif key == "agent":
                current["agent"] = value
            elif key == "task":
                current.setdefault("payload", {})["task"] = value
            else:
                current.setdefault("payload", {})[key] = value

    if current and current.get("schedule") and current.get("agent"):
        jobs.append(current)
    return jobs


async def load_heartbeat_file(workspace_path: str, default_agent_id: str = "") -> int:
    """Parse HEARTBEAT.md and register all defined cron jobs.

    Returns the number of jobs registered.
    """
    from pathlib import Path

    heartbeat_path = Path(workspace_path) / "HEARTBEAT.md"
    if not heartbeat_path.is_file():
        log.debug("cron: no HEARTBEAT.md found at %s", workspace_path)
        return 0

    content = heartbeat_path.read_text(encoding="utf-8")
    jobs = parse_heartbeat_md(content)
    count = 0
    for job in jobs:
        agent_id = job.get("agent") or default_agent_id
        if not agent_id:
            log.warning("cron: skipping job '%s' — no agent_id", job["name"])
            continue
        try:
            await register_cron(
                name=job["name"],
                agent_id=agent_id,
                schedule=job["schedule"],
                task_payload=job.get("payload", {}),
            )
            count += 1
        except Exception as exc:
            log.warning("cron: failed to register '%s': %s", job["name"], exc)
    log.info("cron: loaded %d jobs from HEARTBEAT.md", count)
    return count
