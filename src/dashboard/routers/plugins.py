"""Dashboard — Plugin management proxy endpoints (§17)."""
from __future__ import annotations

import logging
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

import os

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/plugins", tags=["plugins"])

_BRAIN_URL = os.environ.get("BRAIN_URL", "http://brain:8100")


async def _brain_request(method: str, path: str, **kwargs: Any) -> Any:
    """Proxy a request to the brain API."""
    url = f"{_BRAIN_URL}/api/v1/{path.lstrip('/')}"
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.request(method, url, **kwargs)
        if resp.status_code == 404:
            raise HTTPException(status_code=404, detail="Not found")
        if resp.status_code >= 400:
            raise HTTPException(status_code=resp.status_code, detail=resp.text)
        return resp.json()


class PluginConfigPayload(BaseModel):
    enabled: bool = True
    config: dict[str, Any] = {}


# ---------------------------------------------------------------------------
# 17.1 — List installed plugins
# ---------------------------------------------------------------------------

@router.get("")
async def list_plugins() -> JSONResponse:
    """17.2 — List all plugins with id, name, version, trust tier, tool count, agent count."""
    try:
        data = await _brain_request("GET", "plugins")
        return JSONResponse(content=data)
    except HTTPException:
        raise
    except Exception as exc:
        log.error("list_plugins failed: %s", exc)
        raise HTTPException(status_code=502, detail="Brain API unavailable")


@router.get("/{plugin_id}")
async def get_plugin(plugin_id: str) -> JSONResponse:
    """17.3 — Plugin detail: metadata, permissions, config schema, tools/hooks, agent usage."""
    try:
        data = await _brain_request("GET", f"plugins/{plugin_id}")
        return JSONResponse(content=data)
    except HTTPException:
        raise
    except Exception as exc:
        log.error("get_plugin failed: %s", exc)
        raise HTTPException(status_code=502, detail="Brain API unavailable")


@router.get("/{plugin_id}/schema")
async def get_plugin_schema(plugin_id: str) -> JSONResponse:
    """Config schema for auto-generated dashboard form."""
    try:
        data = await _brain_request("GET", f"plugins/{plugin_id}/schema")
        return JSONResponse(content=data)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Brain API unavailable")


# ---------------------------------------------------------------------------
# Per-agent plugin management (17.4–17.6)
# ---------------------------------------------------------------------------

@router.get("/agents/{agent_id}")
async def list_agent_plugins(agent_id: str) -> JSONResponse:
    """17.4 — Per-agent plugin picker: list plugins with enable status."""
    try:
        data = await _brain_request("GET", f"agents/{agent_id}/plugins")
        return JSONResponse(content=data)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Brain API unavailable")


@router.get("/agents/{agent_id}/{plugin_id}")
async def get_agent_plugin(agent_id: str, plugin_id: str) -> JSONResponse:
    """17.5 — Per-agent-plugin config with masked secrets."""
    try:
        data = await _brain_request("GET", f"agents/{agent_id}/plugins/{plugin_id}")
        return JSONResponse(content=data)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Brain API unavailable")


@router.put("/agents/{agent_id}/{plugin_id}")
async def save_agent_plugin(
    agent_id: str, plugin_id: str, payload: PluginConfigPayload
) -> JSONResponse:
    """17.6 — Save agent-plugin config with schema validation (validated by brain API)."""
    try:
        data = await _brain_request(
            "PUT",
            f"agents/{agent_id}/plugins/{plugin_id}",
            json=payload.dict(),
        )
        return JSONResponse(content=data)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Brain API unavailable")


@router.delete("/agents/{agent_id}/{plugin_id}")
async def delete_agent_plugin(agent_id: str, plugin_id: str) -> JSONResponse:
    """Remove agent-plugin config."""
    try:
        await _brain_request("DELETE", f"agents/{agent_id}/plugins/{plugin_id}")
        return JSONResponse(content={"status": "ok"})
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Brain API unavailable")
