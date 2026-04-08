"""GET /health — liveness and readiness probe."""
from __future__ import annotations

import asyncio
import time
from fastapi import APIRouter

from ...shared.models.requests import HealthResponse
from ..db import check_connection

router = APIRouter(prefix="/health", tags=["health"])


@router.get("", response_model=HealthResponse)
async def health() -> HealthResponse:
    db_ok = await check_connection()
    return HealthResponse(
        status="ok" if db_ok else "degraded",
        db="connected" if db_ok else "unreachable",
    )


@router.post("/probe-llm")
async def probe_llm_providers() -> dict:
    """
    Probe all configured LLM providers with a minimal 1-token request.
    Returns per-provider status, latency_ms, and error (if any).
    """
    from langchain_core.messages import HumanMessage
    from ..models_registry import _build_model

    PROBES = [
        ("anthropic",  "anthropic/claude-haiku-4-5"),
        ("openai",     "openai/gpt-4o-mini"),
        ("groq",       "groq/llama-3.3-70b-versatile"),
        ("deepseek",   "deepseek/deepseek-chat"),
        ("minimax",    "minimax/MiniMax-M2.5"),
    ]

    async def _probe(provider: str, model_name: str) -> dict:
        try:
            llm = _build_model(model_name)
            t0 = time.perf_counter()
            response = await asyncio.wait_for(
                llm.ainvoke([HumanMessage(content="Reply with the single word: ok")]),
                timeout=15.0,
            )
            latency_ms = (time.perf_counter() - t0) * 1000
            return {
                "provider": provider,
                "model": model_name,
                "status": "ok",
                "latency_ms": round(latency_ms, 1),
                "response": str(response.content)[:80],
            }
        except Exception as exc:
            return {
                "provider": provider,
                "model": model_name,
                "status": "error",
                "error": str(exc)[:200],
            }

    results = await asyncio.gather(*[_probe(p, m) for p, m in PROBES])
    all_ok = all(r["status"] == "ok" for r in results)
    return {"overall": "ok" if all_ok else "partial", "providers": list(results)}
