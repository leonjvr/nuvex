"""Channels API — WhatsApp org config + per-agent channel configs."""
from __future__ import annotations

import json
import os
import shutil
from pathlib import Path
from typing import Any

import httpx
import yaml
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

try:
    import docker as _docker_sdk
    _docker_client = _docker_sdk.from_env()
except Exception:
    _docker_client = None

_WA_CONTAINER = os.environ.get("WA_CONTAINER", "nuvex-gateway-wa-local")

from ...shared.config import get_cached_config

router = APIRouter(prefix="/api/channels", tags=["channels"])

_NUVEX_CONFIG = Path(os.environ.get("NUVEX_CONFIG", "config/nuvex.yaml"))
_QR_FILE = Path("/data/wa-qr.json")
_WA_CREDS = Path("/data/wa-creds")

_AGENT_CHANNELS = ("telegram", "email", "slack", "discord")
# Keys whose values are masked to "***" on GET and preserved on PUT when "***" is sent back
_SECRET_KEYS = {"bot_token", "email_pass", "signing_secret"}


# ── YAML helpers ──────────────────────────────────────────────────────────────

def _read_yaml() -> dict:
    if not _NUVEX_CONFIG.exists():
        raise HTTPException(status_code=500, detail="nuvex.yaml not found")
    with _NUVEX_CONFIG.open() as f:
        return yaml.safe_load(f) or {}


def _write_yaml(data: dict) -> None:
    with _NUVEX_CONFIG.open("w") as f:
        yaml.dump(data, f, default_flow_style=False, allow_unicode=True, sort_keys=False)


def _mask(d: dict) -> dict:
    return {k: ("***" if (k in _SECRET_KEYS and v) else v) for k, v in d.items()}


def _unmask(updates: dict, existing: dict) -> dict:
    return {k: (existing.get(k, "") if v == "***" else v) for k, v in updates.items()}


# ── WhatsApp (org-level) ──────────────────────────────────────────────────────

@router.get("/whatsapp")
async def get_whatsapp_config() -> JSONResponse:
    raw = _read_yaml()
    return JSONResponse(raw.get("whatsapp", {}))


class WhatsAppPayload(BaseModel):
    enabled: bool = False
    agent_id: str = "maya"
    dm_policy: str = "pairing"
    group_policy: str = "allowlist"
    humanise_enabled: bool = False
    humanise_read_receipt_delay_ms: int = 1500
    humanise_thinking_delay_ms: int = 2500
    humanise_typing_speed_wpm: int = 45
    humanise_chunk_messages: bool = True


@router.put("/whatsapp")
async def save_whatsapp_config(payload: WhatsAppPayload) -> JSONResponse:
    raw = _read_yaml()
    raw["whatsapp"] = payload.model_dump()
    _write_yaml(raw)
    get_cached_config.cache_clear()
    return JSONResponse(payload.model_dump())


@router.get("/whatsapp/qr")
async def get_whatsapp_qr() -> JSONResponse:
    if not _QR_FILE.exists():
        return JSONResponse({"status": "offline", "qr": None, "ts": None})
    try:
        return JSONResponse(json.loads(_QR_FILE.read_text()))
    except Exception:
        return JSONResponse({"status": "offline", "qr": None, "ts": None})


@router.post("/whatsapp/clear")
async def clear_whatsapp_session() -> JSONResponse:
    if _WA_CREDS.exists():
        shutil.rmtree(_WA_CREDS)
    if _QR_FILE.exists():
        _QR_FILE.unlink()
    return JSONResponse({"cleared": True})


def _gateway_status() -> str:
    """Return 'running', 'stopped', or 'unavailable'."""
    if not _docker_client:
        return "unavailable"
    try:
        c = _docker_client.containers.get(_WA_CONTAINER)
        return "running" if c.status == "running" else "stopped"
    except Exception:
        return "stopped"


@router.get("/whatsapp/gateway")
async def get_gateway_status() -> JSONResponse:
    return JSONResponse({"status": _gateway_status()})


@router.post("/whatsapp/gateway/start")
async def start_gateway() -> JSONResponse:
    if not _docker_client:
        raise HTTPException(status_code=503, detail="Docker socket not available")
    try:
        c = _docker_client.containers.get(_WA_CONTAINER)
        if c.status != "running":
            c.start()
        return JSONResponse({"status": "running"})
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/whatsapp/gateway/stop")
async def stop_gateway() -> JSONResponse:
    if not _docker_client:
        raise HTTPException(status_code=503, detail="Docker socket not available")
    try:
        c = _docker_client.containers.get(_WA_CONTAINER)
        c.stop(timeout=5)
        return JSONResponse({"status": "stopped"})
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


# ── Agent list ────────────────────────────────────────────────────────────────

@router.get("/agents")
async def list_agents() -> JSONResponse:
    raw = _read_yaml()
    names = [a.get("name") for a in raw.get("agents", []) if a.get("name")]
    return JSONResponse(names)


# ── Per-agent channel config ──────────────────────────────────────────────────

@router.get("/agents/{agent_id}/{channel}")
async def get_agent_channel(agent_id: str, channel: str) -> JSONResponse:
    if channel not in _AGENT_CHANNELS:
        raise HTTPException(status_code=400, detail=f"Unknown channel: {channel}")
    raw = _read_yaml()
    for a in raw.get("agents", []):
        if a.get("name") == agent_id:
            cfg = a.get("channels", {}).get(channel, {})
            return JSONResponse(_mask(cfg))
    raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found")


class AgentChannelPayload(BaseModel):
    config: dict


@router.put("/agents/{agent_id}/{channel}")
async def save_agent_channel(
    agent_id: str, channel: str, payload: AgentChannelPayload
) -> JSONResponse:
    if channel not in _AGENT_CHANNELS:
        raise HTTPException(status_code=400, detail=f"Unknown channel: {channel}")
    raw = _read_yaml()
    for a in raw.get("agents", []):
        if a.get("name") == agent_id:
            a.setdefault("channels", {})
            existing = a["channels"].get(channel, {})
            a["channels"][channel] = _unmask(payload.config, existing)
            _write_yaml(raw)
            get_cached_config.cache_clear()
            return JSONResponse(_mask(a["channels"][channel]))
    raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found")


# ── WhatsApp group bindings ───────────────────────────────────────────────────

_BRAIN_URL = os.environ.get("BRAIN_URL", "http://brain:8100")
_GATEWAY_WA_URL = os.environ.get("GATEWAY_WA_URL", "http://gateway-wa:8101")
_GATEWAY_TG_URL = os.environ.get("GATEWAY_TG_URL", "http://gateway-telegram:8102")
_GATEWAY_MAIL_URL = os.environ.get("GATEWAY_MAIL_URL", "http://gateway-email:8103")


@router.get("/whatsapp/groups")
async def list_known_groups() -> JSONResponse:
    """Return all WA groups from the gateway (falls back to brain chat registry)."""
    # Primary: ask gateway directly — returns all groups the WA account is in
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(f"{_GATEWAY_WA_URL}/groups")
            if r.status_code == 200:
                groups = r.json()
                # Normalise to {id, name, is_group} shape expected by frontend
                return JSONResponse([
                    {"id": g["jid"], "name": g.get("name"), "participants": g.get("participants", 0), "is_group": True}
                    for g in groups
                    if isinstance(g, dict) and g.get("jid")
                ])
    except Exception:
        pass
    # Fallback: groups known to brain from past messages
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(f"{_BRAIN_URL}/threads/chats")
            if r.status_code == 200:
                chats = r.json()
                return JSONResponse([c for c in chats if isinstance(c, dict) and c.get("is_group")])
    except Exception:
        pass
    return JSONResponse([])


class GroupBindingItem(BaseModel):
    jid: str
    workspace: str
    label: str = ""


class GroupBindingsPayload(BaseModel):
    bindings: list[GroupBindingItem]


@router.get("/whatsapp/group-bindings")
async def get_group_bindings() -> JSONResponse:
    raw = _read_yaml()
    wa = raw.get("whatsapp", {})
    return JSONResponse(wa.get("group_bindings", []))


@router.put("/whatsapp/group-bindings")
async def save_group_bindings(payload: GroupBindingsPayload) -> JSONResponse:
    raw = _read_yaml()
    raw.setdefault("whatsapp", {})
    raw["whatsapp"]["group_bindings"] = [b.model_dump() for b in payload.bindings]
    _write_yaml(raw)
    get_cached_config.cache_clear()
    return JSONResponse(raw["whatsapp"]["group_bindings"])


# ── Telegram / Email gateway health ──────────────────────────────────────────

@router.get("/telegram/gateway")
async def get_telegram_gateway_status() -> JSONResponse:
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            r = await client.get(f"{_GATEWAY_TG_URL}/health")
            data = r.json()
            return JSONResponse({
                "connected": data.get("connected", False),
                "state": data.get("bot", "unknown"),
            })
    except Exception:
        return JSONResponse({"connected": False, "state": "offline"})


@router.get("/email/gateway")
async def get_email_gateway_status() -> JSONResponse:
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            r = await client.get(f"{_GATEWAY_MAIL_URL}/health")
            data = r.json()
            return JSONResponse({
                "connected": data.get("connected", False),
                "state": data.get("imap", "unknown"),
            })
    except Exception:
        return JSONResponse({"connected": False, "state": "offline"})
