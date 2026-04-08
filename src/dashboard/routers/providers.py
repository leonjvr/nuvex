"""Dashboard router — CRUD for managed LLM providers."""
from __future__ import annotations

import os

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from ...brain.db import get_session
from ...brain.models.provider import LLMProvider

router = APIRouter(prefix="/api/providers", tags=["providers"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_ENV_KEY_MAP: dict[str, str] = {
    "anthropic": "ANTHROPIC_API_KEY",
    "openai": "OPENAI_API_KEY",
    "groq": "GROQ_API_KEY",
    "deepseek": "DEEPSEEK_API_KEY",
    "minimax": "MINIMAX_API_KEY",
}


def _row_to_dict(r: LLMProvider) -> dict:
    env_var = _ENV_KEY_MAP.get(r.provider, "")
    env_key_set = bool(os.environ.get(env_var)) if env_var else False
    return {
        "id": r.id,
        "name": r.name,
        "provider": r.provider,
        "model": r.model,
        "api_key": r.api_key,          # stored key (may be None if using env var)
        "api_key_env": env_var,         # which env var supplies the key
        "api_key_env_set": env_key_set, # whether that env var is populated
        "base_url": r.base_url,
        "enabled": r.enabled,
        "notes": r.notes,
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "updated_at": r.updated_at.isoformat() if r.updated_at else None,
    }


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class ProviderIn(BaseModel):
    name: str
    provider: str
    model: str
    api_key: str | None = None
    base_url: str | None = None
    enabled: bool = True
    notes: str | None = None


class ProviderPatch(BaseModel):
    provider: str | None = None
    model: str | None = None
    api_key: str | None = None
    base_url: str | None = None
    enabled: bool | None = None
    notes: str | None = None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("")
async def list_providers():
    async with get_session() as session:
        result = await session.execute(select(LLMProvider).order_by(LLMProvider.name))
        rows = result.scalars().all()
    return [_row_to_dict(r) for r in rows]


@router.post("", status_code=201)
async def create_provider(body: ProviderIn):
    async with get_session() as session:
        existing = await session.execute(
            select(LLMProvider).where(LLMProvider.name == body.name)
        )
        if existing.scalar_one_or_none() is not None:
            raise HTTPException(400, f"Provider '{body.name}' already exists")
        row = LLMProvider(**body.model_dump())
        session.add(row)
        await session.commit()
        await session.refresh(row)
    return _row_to_dict(row)


@router.get("/{provider_id}")
async def get_provider(provider_id: int):
    async with get_session() as session:
        row = await session.get(LLMProvider, provider_id)
    if row is None:
        raise HTTPException(404, "Not found")
    return _row_to_dict(row)


@router.put("/{provider_id}")
async def update_provider(provider_id: int, body: ProviderPatch):
    async with get_session() as session:
        row = await session.get(LLMProvider, provider_id)
        if row is None:
            raise HTTPException(404, "Not found")
        updates = body.model_dump(exclude_none=True)
        for k, v in updates.items():
            setattr(row, k, v)
        await session.commit()
        await session.refresh(row)
    return _row_to_dict(row)


@router.delete("/{provider_id}", status_code=204)
async def delete_provider(provider_id: int):
    async with get_session() as session:
        row = await session.get(LLMProvider, provider_id)
        if row is None:
            raise HTTPException(404, "Not found")
        await session.delete(row)
        await session.commit()
