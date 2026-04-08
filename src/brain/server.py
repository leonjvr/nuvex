"""FastAPI application factory and lifespan handler for the brain service."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from .checkpointer import get_checkpointer
from .db import init_engine
from .graph import get_compiled_graph
from .routers.actions import router as actions_router
from .routers.agents import router as agents_router
from .routers.approvals import router as approvals_router
from .routers.audit import router as audit_router
from .routers.costs import router as costs_router
from .routers.cron import router as cron_router
from .routers.health import router as health_router
from .routers.invoke import router as invoke_router
from .routers.policy_candidates import router as policy_candidates_router
from .routers.skill_convert import router as skill_convert_router
from .routers.skills import router as skills_router
from .routers.threads import router as threads_router

log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Register built-in pre-tool-use hooks (imports trigger self-registration)
    from .hooks.skill_env import skill_env_injection_hook as _  # noqa: F401

    log.info("brain: initialising database engine")
    init_engine()

    # Start background workers
    from .events import start_retention_worker
    await start_retention_worker()

    # Register recovery engine event bus subscriptions
    from .recovery import _register_recovery_subscriber
    _register_recovery_subscriber()

    # Start APScheduler (cron + system background jobs — arousal, language gradient, routing tracker)
    from .cron import start_scheduler
    await start_scheduler()

    # Wire AlertEngine into APScheduler (§39.3)
    from .cron import get_scheduler
    from .alert_engine import AlertEngine
    _alert_engine = AlertEngine()

    async def _run_alert_check() -> None:
        try:
            from .db import get_session
            async with get_session() as _session:
                fired = await _alert_engine.check_all_alerts(_session)
                if fired:
                    log.info("alert_engine: %d alert(s) fired", len(fired))
        except Exception as exc:
            log.warning("alert_engine: check failed: %s", exc)

    _sched = get_scheduler()
    if not _sched.get_job("system:alert_check"):
        _sched.add_job(
            _run_alert_check,
            "interval",
            id="system:alert_check",
            minutes=5,
        )
        log.info("brain: registered system:alert_check (every 5 min)")

    # Initialise LangGraph checkpointer (PostgreSQL or MemorySaver fallback)
    async with get_checkpointer() as checkpointer:
        get_compiled_graph(checkpointer=checkpointer)
        log.info("brain: compiled graph ready with checkpointer: %s", type(checkpointer).__name__)
        yield

    log.info("brain: shutdown")


def create_app() -> FastAPI:
    app = FastAPI(title="NUVEX Brain", version="0.1.0", lifespan=lifespan)
    app.include_router(health_router)
    app.include_router(invoke_router)
    app.include_router(agents_router)
    app.include_router(threads_router)
    app.include_router(audit_router)
    app.include_router(cron_router)
    app.include_router(actions_router)
    app.include_router(skill_convert_router)
    app.include_router(policy_candidates_router)
    app.include_router(skills_router)
    app.include_router(approvals_router)
    app.include_router(costs_router)
    return app


app = create_app()
