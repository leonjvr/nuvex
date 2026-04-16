"""Dashboard invoke proxy — forwards invocation requests to the brain service."""
from __future__ import annotations

import json
import os
from typing import AsyncIterator

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

router = APIRouter(prefix="/api/invoke", tags=["invoke"])

BRAIN_URL = os.environ.get("BRAIN_URL", "http://brain:8100")


class InvokePayload(BaseModel):
    agent_id: str
    message: str
    thread_id: str | None = None
    channel: str = "dashboard"
    org_id: str = "default"


@router.post("")
async def invoke_agent(payload: InvokePayload) -> dict:
    """Proxy an invocation request to the brain service."""
    async with httpx.AsyncClient(timeout=120) as client:
        try:
            resp = await client.post(
                f"{BRAIN_URL}/invoke",
                json={
                    "agent_id": payload.agent_id,
                    "message": payload.message,
                    "thread_id": payload.thread_id,
                    "channel": payload.channel,
                    "org_id": payload.org_id,
                    "metadata": {"sender": "dashboard", "channel": payload.channel},
                },
            )
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPStatusError as exc:
            raise HTTPException(
                status_code=exc.response.status_code,
                detail=exc.response.text,
            ) from exc
        except httpx.RequestError as exc:
            raise HTTPException(
                status_code=503,
                detail=f"Brain service unreachable: {exc}",
            ) from exc


@router.post("/stream")
async def invoke_stream(payload: InvokePayload) -> StreamingResponse:
    """SSE proxy — passes brain streaming events through to the client."""
    brain_payload = {
        "agent_id": payload.agent_id,
        "message": payload.message,
        "thread_id": payload.thread_id,
        "channel": payload.channel,
        "metadata": {"sender": "dashboard", "channel": payload.channel},
    }

    async def stream_generator() -> AsyncIterator[str]:
        try:
            async with httpx.AsyncClient(timeout=None) as client:
                async with client.stream(
                    "POST",
                    f"{BRAIN_URL}/invoke/stream",
                    json=brain_payload,
                    headers={"Accept": "text/event-stream"},
                ) as resp:
                    if resp.status_code >= 400:
                        err = await resp.aread()
                        yield f"data: {json.dumps({'error': err.decode(), 'done': True})}\n\n"
                        return
                    async for line in resp.aiter_lines():
                        yield f"{line}\n" if line else "\n"
        except Exception as exc:
            yield f"data: {json.dumps({'error': str(exc), 'done': True})}\n\n"

    return StreamingResponse(
        stream_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
