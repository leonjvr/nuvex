"""Brain API — Plugin management endpoints (§10)."""
from __future__ import annotations

import logging
import os
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..plugins import get_loaded_plugins

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1", tags=["plugins"])


# ---------------------------------------------------------------------------
# Response schemas
# ---------------------------------------------------------------------------

class PluginSummary(BaseModel):
    plugin_id: str
    name: str
    version: str
    trust_tier: str
    tool_count: int
    agent_usage_count: int


class PluginDetail(BaseModel):
    plugin_id: str
    name: str
    version: str
    trust_tier: str
    permissions: list[str]
    config_schema: dict[str, Any]
    tools: list[str]
    hooks: list[dict[str, Any]]
    source: str


class AgentPluginStatus(BaseModel):
    plugin_id: str
    name: str
    enabled: bool
    status: str  # configured | unconfigured | missing-required


class PluginConfigPayload(BaseModel):
    enabled: bool = True
    config: dict[str, Any] = {}


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/plugins", response_model=list[PluginSummary])
async def list_plugins(session: AsyncSession = Depends(get_db)):
    """10.1 — List all installed plugins."""
    from sqlalchemy import select, func
    from ..models.plugin_registry import PluginRegistry
    from ..models.plugin_config import AgentPluginConfig

    result = await session.execute(select(PluginRegistry))
    rows = result.scalars().all()

    plugins = get_loaded_plugins()
    summaries = []
    for row in rows:
        api = plugins.get(row.plugin_id, {}).get("api")
        tool_count = len(api._tools) if api else 0

        usage_result = await session.execute(
            select(func.count()).select_from(AgentPluginConfig).where(
                AgentPluginConfig.plugin_id == row.plugin_id
            )
        )
        agent_usage = usage_result.scalar_one_or_none() or 0

        summaries.append(PluginSummary(
            plugin_id=row.plugin_id,
            name=row.name,
            version=row.version,
            trust_tier=row.trust_tier,
            tool_count=tool_count,
            agent_usage_count=agent_usage,
        ))
    return summaries


@router.get("/plugins/{plugin_id}", response_model=PluginDetail)
async def get_plugin(plugin_id: str, session: AsyncSession = Depends(get_db)):
    """10.2 — Plugin detail: metadata, permissions, config schema, tools, hooks."""
    from sqlalchemy import select
    from ..models.plugin_registry import PluginRegistry

    result = await session.execute(
        select(PluginRegistry).where(PluginRegistry.plugin_id == plugin_id)
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Plugin not found")

    plugins = get_loaded_plugins()
    entry = plugins.get(plugin_id, {})
    api = entry.get("api")

    return PluginDetail(
        plugin_id=row.plugin_id,
        name=row.name,
        version=row.version,
        trust_tier=row.trust_tier,
        permissions=list(row.permissions) if isinstance(row.permissions, list) else [],
        config_schema=api._config_schema if api else {},
        tools=list(api._tools.keys()) if api else [],
        hooks=[{"event": h["event"], "priority": h["priority"]} for h in api._hooks] if api else [],
        source=row.source or "",
    )


@router.get("/plugins/{plugin_id}/schema")
async def get_plugin_schema(plugin_id: str, session: AsyncSession = Depends(get_db)):
    """10.3 — Config schema for dashboard form generation."""
    from sqlalchemy import select
    from ..models.plugin_registry import PluginRegistry

    result = await session.execute(
        select(PluginRegistry).where(PluginRegistry.plugin_id == plugin_id)
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Plugin not found")

    plugins = get_loaded_plugins()
    api = plugins.get(plugin_id, {}).get("api")
    return {"schema": api._config_schema if api else {}}


@router.get("/agents/{agent_id}/plugins", response_model=list[AgentPluginStatus])
async def list_agent_plugins(agent_id: str, session: AsyncSession = Depends(get_db)):
    """10.4 — List plugins for agent with config status."""
    from sqlalchemy import select
    from ..models.plugin_registry import PluginRegistry
    from ..models.plugin_config import AgentPluginConfig

    all_plugins = await session.execute(select(PluginRegistry))
    plugin_rows = {r.plugin_id: r for r in all_plugins.scalars().all()}

    agent_configs = await session.execute(
        select(AgentPluginConfig).where(AgentPluginConfig.agent_id == agent_id)
    )
    configs = {r.plugin_id: r for r in agent_configs.scalars().all()}

    plugins = get_loaded_plugins()
    result = []
    for pid, row in plugin_rows.items():
        api = plugins.get(pid, {}).get("api")
        cfg = configs.get(pid)
        schema = api._config_schema if api else {}
        required_fields = [k for k, v in schema.items() if v.get("required")] if schema else []

        if not cfg:
            pstatus = "unconfigured"
        elif required_fields and not cfg.config_json:
            pstatus = "missing-required"
        else:
            pstatus = "configured"

        result.append(AgentPluginStatus(
            plugin_id=pid,
            name=row.name,
            enabled=cfg.enabled if cfg else False,
            status=pstatus,
        ))
    return result


@router.get("/agents/{agent_id}/plugins/{plugin_id}")
async def get_agent_plugin(
    agent_id: str, plugin_id: str, session: AsyncSession = Depends(get_db)
):
    """10.5 — Agent-plugin config with masked secrets."""
    from sqlalchemy import select
    from ..models.plugin_config import AgentPluginConfig

    result = await session.execute(
        select(AgentPluginConfig).where(
            AgentPluginConfig.agent_id == agent_id,
            AgentPluginConfig.plugin_id == plugin_id,
        )
    )
    cfg = result.scalar_one_or_none()
    if not cfg:
        raise HTTPException(status_code=404, detail="No config found")

    plugins = get_loaded_plugins()
    api = plugins.get(plugin_id, {}).get("api")
    schema = api._config_schema if api else {}

    config_json = dict(cfg.config_json or {})
    # Mask secret fields
    for key, field_def in schema.items():
        if field_def.get("secret") and key in config_json:
            config_json[key] = "***"

    return {
        "agent_id": agent_id,
        "plugin_id": plugin_id,
        "enabled": cfg.enabled,
        "config": config_json,
        "has_encrypted": cfg.env_encrypted is not None,
    }


@router.put("/agents/{agent_id}/plugins/{plugin_id}", status_code=status.HTTP_200_OK)
async def save_agent_plugin_config(
    agent_id: str,
    plugin_id: str,
    payload: PluginConfigPayload,
    session: AsyncSession = Depends(get_db),
):
    """10.6 — Save agent-plugin config with schema validation and encryption."""
    import uuid
    from sqlalchemy import select
    from ..models.plugin_config import AgentPluginConfig

    # Validate schema
    plugins = get_loaded_plugins()
    api = plugins.get(plugin_id, {}).get("api")
    schema = api._config_schema if api else {}
    for key, field_def in schema.items():
        if field_def.get("required") and key not in payload.config:
            raise HTTPException(
                status_code=422,
                detail=f"Required config field missing: {key}",
            )

    # Separate secret from non-secret fields
    secret_data: dict[str, str] = {}
    plain_data: dict[str, Any] = {}
    for key, val in payload.config.items():
        field_def = schema.get(key, {})
        if field_def.get("secret"):
            secret_data[key] = str(val)
        else:
            plain_data[key] = val

    # Encrypt secret data if present
    encrypted: bytes | None = None
    if secret_data:
        secret_key = os.environ.get("NUVEX_SECRET_KEY")
        if not secret_key:
            raise HTTPException(
                status_code=500,
                detail="NUVEX_SECRET_KEY not set; cannot encrypt plugin secrets",
            )
        from ...shared.crypto import encrypt_env
        encrypted = encrypt_env(secret_data, key=secret_key)

    result = await session.execute(
        select(AgentPluginConfig).where(
            AgentPluginConfig.agent_id == agent_id,
            AgentPluginConfig.plugin_id == plugin_id,
        )
    )
    cfg = result.scalar_one_or_none()
    if cfg:
        cfg.enabled = payload.enabled
        cfg.config_json = plain_data or None
        if encrypted is not None:
            cfg.env_encrypted = encrypted
    else:
        cfg = AgentPluginConfig(
            id=uuid.uuid4(),
            agent_id=agent_id,
            plugin_id=plugin_id,
            enabled=payload.enabled,
            config_json=plain_data or None,
            env_encrypted=encrypted,
        )
        session.add(cfg)

    await session.commit()
    return {"status": "ok"}


@router.delete("/agents/{agent_id}/plugins/{plugin_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_agent_plugin_config(
    agent_id: str, plugin_id: str, session: AsyncSession = Depends(get_db)
):
    """10.7 — Remove agent-plugin config."""
    from sqlalchemy import select
    from ..models.plugin_config import AgentPluginConfig

    result = await session.execute(
        select(AgentPluginConfig).where(
            AgentPluginConfig.agent_id == agent_id,
            AgentPluginConfig.plugin_id == plugin_id,
        )
    )
    cfg = result.scalar_one_or_none()
    if not cfg:
        raise HTTPException(status_code=404, detail="No config found")
    await session.delete(cfg)
    await session.commit()


@router.get("/models")
async def list_models(session: AsyncSession = Depends(get_db)):
    """10.8 — List all available models from built-in and plugin providers."""
    from sqlalchemy import select
    from ..models.provider import LLMProvider

    result = await session.execute(select(LLMProvider))
    built_in = [{"id": r.id, "name": r.name, "model": r.model, "provider": r.provider} for r in result.scalars().all()]

    # Plugin providers
    plugins = get_loaded_plugins()
    plugin_models = []
    for pid, entry in plugins.items():
        api = entry.get("api")
        if api:
            for _provider_id, p in api._providers.items():
                for model in p.get("models", []):
                    plugin_models.append({"id": model, "provider": pid, "name": p["name"]})

    return {"built_in": built_in, "plugins": plugin_models}


# ── Org-scoped plugin config endpoints  (task 12.4) ──────────────────────────

org_plugins_router = APIRouter(prefix="/api/v1/orgs/{org_id}", tags=["plugins"])


@org_plugins_router.get("/agents/{agent_id}/plugins", response_model=list)
async def list_org_agent_plugins(
    org_id: str,
    agent_id: str,
    session: AsyncSession = Depends(get_db),
):
    """§12.4 — List plugin configs for a specific agent in a specific org."""
    from sqlalchemy import select
    from ..models.plugin_config import AgentPluginConfig

    result = await session.execute(
        select(AgentPluginConfig).where(AgentPluginConfig.agent_id == agent_id)
    )
    rows = result.scalars().all()
    return [{"plugin_id": r.plugin_id, "enabled": r.enabled} for r in rows]


@org_plugins_router.put("/agents/{agent_id}/plugins/{plugin_id}", status_code=200)
async def save_org_agent_plugin_config(
    org_id: str,
    agent_id: str,
    plugin_id: str,
    payload: PluginConfigPayload,
    session: AsyncSession = Depends(get_db),
):
    """§12.4 — Save plugin config for an agent in a specific org."""
    # Delegate to the existing save logic via router function
    from fastapi import Request
    return await save_agent_plugin_config(agent_id, plugin_id, payload, session)


@org_plugins_router.delete("/agents/{agent_id}/plugins/{plugin_id}", status_code=204, response_model=None)
async def delete_org_agent_plugin_config(
    org_id: str,
    agent_id: str,
    plugin_id: str,
    session: AsyncSession = Depends(get_db),
):
    """§12.4 — Delete plugin config for an agent in a specific org."""
    return await delete_agent_plugin_config(agent_id, plugin_id, session)

