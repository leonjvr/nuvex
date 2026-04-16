"""FastAPI application factory and lifespan handler for the brain service."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from .checkpointer import get_checkpointer
from .db import init_engine
from .graph import get_compiled_graph
from .routers.actions import router as actions_router
from .routers.agents import router as agents_router, org_agents_router
from .routers.approvals import router as approvals_router
from .routers.audit import router as audit_router
from .routers.channels import router as channels_router
from .routers.contacts import router as contacts_router
from .routers.costs import router as costs_router
from .routers.cron import router as cron_router, org_cron_router
from .routers.health import router as health_router
from .routers.invoke import router as invoke_router, org_router as org_invoke_router, legacy_v1_router as legacy_v1_invoke_router
from .routers.orgs import router as orgs_router
from .routers.policy_candidates import router as policy_candidates_router
from .routers.principals import router as principals_router
from .routers.skill_convert import router as skill_convert_router
from .routers.skills import router as skills_router
from .routers.threads import router as threads_router, org_threads_router
from .routers.plugins import router as plugins_router, org_plugins_router
from .routers.work_packets import router as work_packets_router
from .routers.devices import router as devices_router

log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # §5.2 — validate NUVEX_SECRET_KEY is present (warn if absent, don't block startup)
    import os
    if not os.environ.get("NUVEX_SECRET_KEY"):
        log.warning(
            "brain: NUVEX_SECRET_KEY is not set — encrypted plugin configs cannot be used. "
            "Generate with: python -c \"from cryptography.fernet import Fernet; "
            "print(Fernet.generate_key().decode())\""
        )

    # Register built-in pre-tool-use hooks (imports trigger self-registration)
    from .hooks.skill_env import skill_env_injection_hook as _  # noqa: F401

    log.info("brain: initialising database engine")
    init_engine()

    # Ensure default org exists and sync YAML configs
    try:
        from .db import get_session as _get_session
        from .org_config_loader import sync_orgs_to_db
        async with _get_session() as _session:
            changed = await sync_orgs_to_db(_session)
            if changed:
                log.info("brain: org config sync — changed orgs: %s", changed)
    except Exception as _org_exc:
        log.warning("brain: org config sync failed (non-fatal): %s", _org_exc)

    # §10.4 — auto-bind gateway channels from env config on boot
    try:
        import os as _os
        from .db import get_session as _cbs
        from .models.channel_binding import ChannelBinding as _CB
        from sqlalchemy import select as _sel_cb
        _gw_bindings = [
            ("telegram", _os.environ.get("NUVEX_ORG_ID", "default"),
             _os.environ.get("TELEGRAM_BOT_TOKEN", "")),
        ]
        async with _cbs() as _cbsess:
            for _ch_type, _ch_org, _ch_identity in _gw_bindings:
                if not _ch_identity:
                    continue
                _existing = (await _cbsess.execute(
                    _sel_cb(_CB).where(_CB.channel_type == _ch_type, _CB.channel_identity == _ch_identity).limit(1)
                )).scalar_one_or_none()
                if _existing is None:
                    _cbsess.add(_CB(org_id=_ch_org, channel_type=_ch_type, channel_identity=_ch_identity))
            await _cbsess.commit()
    except Exception as _cb_exc:
        log.debug("brain: auto channel binding skipped (non-fatal): %s", _cb_exc)

    # §9.1 — load plugins after database init
    from .plugins import load_plugins, shutdown_plugins, get_loaded_plugins
    await load_plugins()
    log.info("brain: plugins loaded")

    # §8.3 — validate plugin references in agent config (non-fatal warnings)
    try:
        from ...shared.config import get_cached_config, validate_plugin_references
        validate_plugin_references(get_cached_config())
    except Exception as _val_exc:
        log.debug("brain: plugin reference validation skipped: %s", _val_exc)

    # §9.5 — register plugin hooks in HookRegistry at declared priorities (>= 100)
    from .hooks import get_registry as get_hook_registry
    hook_registry = get_hook_registry()
    for _pid, _entry in get_loaded_plugins().items():
        _api = _entry.get("api")
        if _api:
            for _hreg in _api._hooks:
                try:
                    hook_registry.register_plugin_hook(
                        _hreg["event"], _hreg["handler"], _hreg["priority"]
                    )
                except Exception as _exc:
                    log.warning("plugin '%s' hook registration failed: %s", _pid, _exc)

    # §9.2 — initialise connector pools at startup
    from .plugins import ConnectorPool
    _connector_pools: list[ConnectorPool] = []
    for _pid, _entry in get_loaded_plugins().items():
        _api = _entry.get("api")
        if _api:
            for _creg in _api._connectors.values():
                try:
                    _pool = ConnectorPool(
                        plugin_id=_pid,
                        name=_creg["name"],
                        connect_fn=_creg["connect"],
                        health_check_fn=_creg["health_check"],
                        config={},
                    )
                    await _pool.connect()
                    _pool.start_health_monitor()
                    _connector_pools.append(_pool)
                except Exception as _exc:
                    log.warning("plugin '%s' connector init failed: %s", _pid, _exc)

    # §9.3 — register provider plugins with model routing
    from .plugins import register_provider_model
    for _pid, _entry in get_loaded_plugins().items():
        _api = _entry.get("api")
        if _api:
            for _preg in _api._providers.values():
                for _model_id in _preg.get("models", []):
                    try:
                        register_provider_model(_model_id, _preg["invoke"], config={})
                        log.info("plugin_provider: registered model '%s' from plugin '%s'", _model_id, _pid)
                    except Exception as _exc:
                        log.warning("plugin '%s' provider '%s' registration failed: %s", _pid, _model_id, _exc)

    # §9.4 — mount channel plugin HTTP routes under /plugins/<plugin-id>/
    from .plugins import register_channel as _reg_channel
    for _pid, _entry in get_loaded_plugins().items():
        _api = _entry.get("api")
        if _api:
            for _ch_id, _chreg in _api._channels.items():
                try:
                    _reg_channel(_ch_id, _chreg["send"], _chreg["receive"], _chreg["health_check"])
                    # HTTP routes registered as inline FastAPI routes
                    for _route in _api._http_routes:
                        try:
                            from fastapi import APIRouter as _APIRouter
                            _rt = _APIRouter(prefix=f"/plugins/{_pid}")
                            _rt.add_api_route(_route["path"], _route["handler"], methods=_route["methods"])
                            app.include_router(_rt)
                        except Exception as _rexc:
                            log.warning("plugin '%s' HTTP route failed: %s", _pid, _rexc)
                except Exception as _exc:
                    log.warning("plugin '%s' channel registration failed: %s", _pid, _exc)

    # Start background workers
    from .events import start_retention_worker
    await start_retention_worker()

    # Register recovery engine event bus subscriptions
    from .recovery import _register_recovery_subscriber
    _register_recovery_subscriber()

    # Register cron + arousal event-driven agent triggers
    from .triggers import register_trigger_subscribers
    register_trigger_subscribers()

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

        # §1.8 — initialise DeviceRegistry singleton
        from .devices.registry import get_registry as _get_device_registry
        _get_device_registry()
        log.info("brain: device registry initialised")

        yield

    log.info("brain: shutdown")
    await shutdown_plugins()

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
    app.include_router(principals_router)
    app.include_router(contacts_router)
    app.include_router(plugins_router)
    # §12.4 — org-scoped plugin config endpoints
    app.include_router(org_plugins_router)
    app.include_router(orgs_router, prefix="/api/v1")
    # §10.5 — channels router
    app.include_router(channels_router, prefix="/api/v1")
    # §11.10 — work packets router
    app.include_router(work_packets_router, prefix="/api/v1")
    # §6.2 — org-scoped invoke
    app.include_router(org_invoke_router, prefix="/api/v1")
    # §6.2 — legacy /api/v1/invoke alias for default org
    app.include_router(legacy_v1_invoke_router)
    # §6.3 — org-scoped agents
    app.include_router(org_agents_router, prefix="/api/v1")
    # §15.3 — org-scoped cron endpoints
    app.include_router(org_cron_router, prefix="/api/v1/orgs/{org_id}/cron")
    # §6.4 — org-scoped threads
    app.include_router(org_threads_router, prefix="/api/v1")
    # §desktop — device WebSocket channel
    app.include_router(devices_router)
    return app


app = create_app()
