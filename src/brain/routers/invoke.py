"""POST /invoke — run an agent invocation and return the response."""
from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import AsyncIterator

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from langchain_core.messages import AnyMessage, HumanMessage
from langgraph.errors import GraphInterrupt
from langgraph.types import Command
from sqlalchemy import select, update

from ...shared.models.requests import InvokeRequest, InvokeResponse, ResumeRequest
from ..db import get_session
from ..lifecycle import LifecycleState, queue_invocation, set_registry_state
from ..models.agent import Agent
from ..models.thread import Message, Thread
from ..state import AgentState
from ..graph import get_compiled_graph

log = logging.getLogger(__name__)

router = APIRouter(prefix="/invoke", tags=["invoke"])


async def _ensure_agent_row(session, agent_id: str) -> None:
    """Insert a minimal Agent row from config if one doesn't exist yet."""
    existing = await session.get(Agent, agent_id)
    if existing is not None:
        return
    # Load from YAML config — fall back to bare minimum if not found
    try:
        from ...shared.config import get_cached_config
        cfg = get_cached_config()
        agent_def = cfg.agents.get(agent_id)
    except Exception:
        agent_def = None

    name = agent_def.name if agent_def else agent_id
    tier = agent_def.tier if agent_def else "T1"
    division = agent_def.division if agent_def else "default"
    workspace_path = agent_def.workspace if agent_def else None
    config_snapshot = agent_def.model_dump() if agent_def else {}

    session.add(Agent(
        id=agent_id,
        name=name,
        tier=tier,
        division=division,
        workspace_path=workspace_path,
        config_snapshot=config_snapshot,
        lifecycle_state="ready",
    ))
    await session.flush()


async def _persist_invocation(
    thread_id: str,
    agent_id: str,
    channel: str,
    sender: str,
    user_message: str,
    reply: str,
    tokens: int,
    metadata: dict,
) -> None:
    """Upsert the Thread row and append user + assistant Message rows."""
    try:
        async with get_session() as session:
            # Ensure agent row exists (FK: threads.agent_id → agents.id)
            await _ensure_agent_row(session, agent_id)

            # Upsert thread
            thread = await session.get(Thread, thread_id)
            now = datetime.now(timezone.utc)
            if thread is None:
                thread = Thread(
                    id=thread_id,
                    agent_id=agent_id,
                    channel=channel,
                    participants={sender: {"role": "user"}} if sender else {},
                    message_count=0,
                )
                session.add(thread)
                await session.flush()

            # Persist user message
            session.add(Message(
                thread_id=thread_id,
                role="user",
                content=user_message,
                tokens=len(user_message.split()),
                metadata_={"sender": sender, "channel": channel, **metadata},
            ))
            # Persist assistant reply
            if reply:
                session.add(Message(
                    thread_id=thread_id,
                    role="assistant",
                    content=reply,
                    tokens=tokens,
                    metadata_={"sender": agent_id, "channel": channel},
                ))

            # Update thread message_count + updated_at
            thread.message_count = (thread.message_count or 0) + (2 if reply else 1)
            thread.updated_at = now
            await session.commit()
    except Exception as exc:
        log.warning("_persist_invocation failed (non-fatal): %s", exc)


async def _get_workspace_path(agent_id: str) -> str | None:
    """Return the workspace_path for an agent from the DB, or None."""
    try:
        async with get_session() as session:
            result = await session.execute(select(Agent).where(Agent.id == agent_id))
            agent = result.scalar_one_or_none()
            return agent.workspace_path if agent else None
    except Exception as exc:
        log.warning("invoke: could not fetch workspace_path for %s: %s", agent_id, exc)
        return None


async def _build_messages(agent_id: str, user_message: str) -> list[AnyMessage]:
    """Return only the new human message — system prompt is injected fresh in call_llm."""
    return [HumanMessage(content=user_message)]


def _load_project_context(workspace_path: str, project_label: str) -> str | None:
    """Read projects.json and build a context block for the given project label."""
    import os
    projects_path = os.path.join(workspace_path, "config", "projects.json")
    try:
        with open(projects_path, encoding="utf-8") as f:
            projects = json.load(f)
    except (OSError, json.JSONDecodeError) as exc:
        log.warning("Could not read projects.json at %s: %s", projects_path, exc)
        return None

    proj = projects.get(project_label)
    if not proj:
        log.warning("project_label '%s' not found in projects.json", project_label)
        return None

    lines = [f"## Active Project: {project_label}"]
    if proj.get("repo_url"):
        lines.append(f"**Repository:** {proj['repo']} ({proj['repo_url']})")
    elif proj.get("repo"):
        lines.append(f"**Repository:** {proj['repo']}")
    if proj.get("staging_url"):
        lines.append(f"**Staging URL:** {proj['staging_url']}")
    if proj.get("prod_url"):
        lines.append(f"**Production URL:** {proj['prod_url']}")
    dw = proj.get("deployment_window")
    if dw:
        day = dw.get("day", "")
        start = dw.get("start", "")
        end = dw.get("end", "")
        tz = dw.get("timezone", "")
        lines.append(f"**Deployment Window:** {day.capitalize()} {start}–{end} {tz}".strip())
    if proj.get("notes"):
        lines.append(f"**Notes:** {proj['notes']}")
    lines.append(
        f"\n**Full config:** `config/projects.json` → key `{project_label}` "
        "(includes github_pat, contact_channel, failure_escalation, deployment_window)"
    )
    lines.append(
        "\n**Active Skill: dev-server** — This WhatsApp/Telegram group was joined to this project "
        "via the dev-server skill's project_bindings setting. "
        "The dev-server skill is your active workflow for this conversation. "
        "Any code change, bug fix, or feature request from this group MUST go through the dev-server skill — "
        "follow its SKILL.md exactly. "
        "Read the full project config from disk using the path and key above."
    )
    return "\n".join(lines)


@router.post("", response_model=InvokeResponse)
async def invoke(req: InvokeRequest) -> InvokeResponse:
    graph = get_compiled_graph()
    invocation_id = str(uuid.uuid4())
    messages = await _build_messages(req.agent_id, req.message)
    thread_id = req.thread_id or f"{req.agent_id}:{invocation_id}"

    # Hard cap check: reject before graph invocation when budget exceeded (§38.2)
    try:
        from ...shared.config import get_cached_config
        _cfg = get_cached_config()
        _adef = _cfg.agents.get(req.agent_id)
        if _adef and _adef.budget and _adef.budget.hard_cap_usd is not None:
            from ..costs import get_period_spend
            from ..db import get_session as _get_session
            async with _get_session() as _sess:
                _spent = await get_period_spend(req.agent_id, _sess)
            if _spent >= _adef.budget.hard_cap_usd:
                raise HTTPException(
                    status_code=402,
                    detail={
                        "error": "budget_exceeded",
                        "hard_cap": _adef.budget.hard_cap_usd,
                        "spent": _spent,
                    },
                )
    except HTTPException:
        raise
    except Exception as _hce:
        log.debug("invoke: hard cap check skipped: %s", _hce)


    workspace_path = await _get_workspace_path(req.agent_id)
    if req.workspace_path:
        workspace_path = req.workspace_path

    # Load project context when the gateway has bound this conversation to a project
    project_context: str | None = None
    project_label = req.metadata.project_label if req.metadata else None
    if project_label and workspace_path:
        project_context = _load_project_context(workspace_path, project_label)

    # Determine task type and model tier from routing config
    task_type = req.metadata.task_type if hasattr(req.metadata, "task_type") else "conversation"
    try:
        from ..routing.router import resolve_model
        resolved_model, model_tier = resolve_model(req.agent_id, task_type)
    except Exception:
        resolved_model, model_tier = "", "primary"

    initial_state = AgentState(
        agent_id=req.agent_id,
        thread_id=thread_id,
        invocation_id=invocation_id,
        messages=messages,
        channel=req.channel,
        sender=req.metadata.sender,
        metadata=req.metadata.model_dump(),
        max_iterations=req.max_iterations,
        workspace_path=workspace_path,
        active_model=resolved_model,
        model_tier=model_tier,
        project_context=project_context,
    )

    async def _run() -> InvokeResponse:
        lg_config = {"configurable": {"thread_id": thread_id}, "recursion_limit": 100}
        try:
            final_state: dict = await graph.ainvoke(initial_state, config=lg_config)
        except GraphInterrupt as gi:
            interrupt_value = gi.interrupts[0].value if gi.interrupts else {}
            return InvokeResponse(
                invocation_id=invocation_id,
                thread_id=thread_id,
                approval_pending=True,
                approval_tool=interrupt_value.get("tool") if isinstance(interrupt_value, dict) else None,
                finished=False,
            )
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

        msgs = final_state.get("messages", [])
        last_ai = next(
            (m for m in reversed(msgs) if getattr(m, "type", None) == "ai"),
            None,
        )
        reply_text = last_ai.content if last_ai else ""

        response = InvokeResponse(
            invocation_id=invocation_id,
            thread_id=final_state.get("thread_id", thread_id),
            reply=reply_text if isinstance(reply_text, str) else str(reply_text),
            tokens_used=final_state.get("tokens_used", 0),
            cost_usd=final_state.get("cost_usd", 0.0),
            finished=final_state.get("finished", False),
            error=final_state.get("error"),
        )

        # Persist thread + messages to dashboard DB
        await _persist_invocation(
            thread_id=thread_id,
            agent_id=req.agent_id,
            channel=req.channel,
            sender=req.metadata.sender or "",
            user_message=req.message,
            reply=response.reply or "",
            tokens=final_state.get("tokens_used", 0),
            metadata=req.metadata.model_dump(),
        )

        return response

    # Queue if agent is already running; otherwise execute immediately
    try:
        return await queue_invocation(req.agent_id, _run)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


async def _build_initial_state(req: InvokeRequest, invocation_id: str) -> AgentState:
    messages = await _build_messages(req.agent_id, req.message)
    workspace_path = await _get_workspace_path(req.agent_id)
    if req.workspace_path:
        workspace_path = req.workspace_path
    task_type = req.metadata.task_type if hasattr(req.metadata, "task_type") else "conversation"
    try:
        from ..routing.router import resolve_model
        resolved_model, model_tier = resolve_model(req.agent_id, task_type)
    except Exception:
        resolved_model, model_tier = "", "primary"
    # Inject project context so /invoke/stream behaves identically to /invoke
    project_context: str | None = None
    project_label = req.metadata.project_label if req.metadata else None
    if project_label and workspace_path:
        project_context = _load_project_context(workspace_path, project_label)
    return AgentState(
        agent_id=req.agent_id,
        thread_id=req.thread_id or f"{req.agent_id}:{invocation_id}",
        invocation_id=invocation_id,
        messages=messages,
        channel=req.channel,
        sender=req.metadata.sender,
        metadata=req.metadata.model_dump(),
        max_iterations=req.max_iterations,
        workspace_path=workspace_path,
        active_model=resolved_model,
        model_tier=model_tier,
        project_context=project_context,
    )


@router.post("/stream")
async def invoke_stream(req: InvokeRequest) -> StreamingResponse:
    """SSE streaming endpoint — emits JSON events for each graph step, then persists."""
    graph = get_compiled_graph()
    invocation_id = str(uuid.uuid4())
    initial_state = await _build_initial_state(req, invocation_id)

    lg_config = {"configurable": {"thread_id": initial_state.thread_id}, "recursion_limit": 100}

    async def event_generator() -> AsyncIterator[str]:
        final_reply = ""
        tokens_used = 0
        try:
            async for event in graph.astream(initial_state, config=lg_config):
                for node_name, state_chunk in event.items():
                    payload: dict = {
                        "node": node_name,
                        "invocation_id": invocation_id,
                    }
                    chunk_messages = (
                        state_chunk.get("messages") if isinstance(state_chunk, dict)
                        else getattr(state_chunk, "messages", None)
                    )
                    if chunk_messages:
                        last_msg = chunk_messages[-1]
                        if getattr(last_msg, "type", None) == "ai":
                            content = (
                                last_msg.content if isinstance(last_msg.content, str)
                                else str(last_msg.content)
                            )
                            payload["content"] = content
                            # Emit tool_calls so the frontend can show which tools are running
                            raw_tc = getattr(last_msg, "tool_calls", None)
                            if raw_tc:
                                payload["tool_calls"] = [
                                    {"name": (t.get("name", "") if isinstance(t, dict) else getattr(t, "name", ""))}
                                    for t in raw_tc
                                ]
                            # Track last non-tool-call AI content as the final reply
                            elif content:
                                final_reply = content
                    chunk_tokens = (
                        state_chunk.get("tokens_used") if isinstance(state_chunk, dict)
                        else getattr(state_chunk, "tokens_used", None)
                    )
                    if chunk_tokens is not None:
                        tokens_used = chunk_tokens
                    chunk_error = (
                        state_chunk.get("error") if isinstance(state_chunk, dict)
                        else getattr(state_chunk, "error", None)
                    )
                    if chunk_error:
                        payload["error"] = chunk_error
                    chunk_finished = (
                        state_chunk.get("finished") if isinstance(state_chunk, dict)
                        else getattr(state_chunk, "finished", None)
                    )
                    if chunk_finished is not None:
                        payload["finished"] = chunk_finished
                    yield f"data: {json.dumps(payload)}\n\n"
        except Exception as exc:
            yield f"data: {json.dumps({'error': str(exc), 'finished': True})}\n\n"
        finally:
            yield "data: {\"done\": true}\n\n"
            # Persist the thread + messages after streaming completes
            try:
                await _persist_invocation(
                    thread_id=initial_state.thread_id,
                    agent_id=req.agent_id,
                    channel=req.channel,
                    sender=req.metadata.sender or "",
                    user_message=req.message,
                    reply=final_reply,
                    tokens=tokens_used,
                    metadata=req.metadata.model_dump(),
                )
            except Exception as exc:
                log.warning("invoke_stream: persist failed: %s", exc)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


async def _invoke_internal(
    agent_id: str,
    message: str,
    thread_id: str | None = None,
    channel: str = "delegation",
    sender: str = "agent",
    caller_agent_id: str | None = None,
) -> str:
    """Lightweight programmatic invoke used by delegation — returns just the reply text."""
    graph = get_compiled_graph()
    invocation_id = str(uuid.uuid4())
    messages = await _build_messages(agent_id, message)
    tid = thread_id or f"{agent_id}:{invocation_id}"

    try:
        from ..routing.router import resolve_model
        resolved_model, model_tier = resolve_model(agent_id, "conversation")
    except Exception:
        resolved_model, model_tier = "", "primary"

    state = AgentState(
        agent_id=agent_id,
        thread_id=tid,
        invocation_id=invocation_id,
        messages=messages,
        channel=channel,
        sender=sender,
        active_model=resolved_model,
        model_tier=model_tier,
    )

    async def _run() -> str:
        lg_config = {"configurable": {"thread_id": tid}, "recursion_limit": 100}
        final_state: dict = await graph.ainvoke(state, config=lg_config)
        msgs = final_state.get("messages", [])
        last_ai = next(
            (m for m in reversed(msgs) if getattr(m, "type", None) == "ai"), None
        )
        reply = last_ai.content if last_ai and isinstance(last_ai.content, str) else ""
        # Persist delegation thread, storing caller identity in metadata
        extra: dict = {"delegated": True}
        if caller_agent_id:
            extra["caller_agent_id"] = caller_agent_id
        await _persist_invocation(
            thread_id=tid,
            agent_id=agent_id,
            channel=channel,
            sender=caller_agent_id or sender,
            user_message=message,
            reply=reply,
            tokens=final_state.get("tokens_used", 0),
            metadata=extra,
        )
        return reply

    return await queue_invocation(agent_id, _run)


# ---------------------------------------------------------------------------
# 10.4 — Resume an interrupted (approval-pending) invocation
# ---------------------------------------------------------------------------

@router.post("/resume", response_model=InvokeResponse)
async def resume_invoke(req: ResumeRequest) -> InvokeResponse:
    """Resume a graph execution that was paused at an approval interrupt."""
    graph = get_compiled_graph()
    lg_config = {"configurable": {"thread_id": req.thread_id}, "recursion_limit": 100}
    command = Command(resume=req.approved)

    try:
        final_state: dict = await graph.ainvoke(command, config=lg_config)
    except GraphInterrupt as gi:
        # Another tool in the same invocation requires approval
        interrupt_value = gi.interrupts[0].value if gi.interrupts else {}
        return InvokeResponse(
            invocation_id=req.invocation_id,
            thread_id=req.thread_id,
            approval_pending=True,
            approval_tool=interrupt_value.get("tool") if isinstance(interrupt_value, dict) else None,
            finished=False,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    msgs = final_state.get("messages", [])
    last_ai = next(
        (m for m in reversed(msgs) if getattr(m, "type", None) == "ai"), None
    )
    reply_text = last_ai.content if last_ai else ""

    return InvokeResponse(
        invocation_id=req.invocation_id,
        thread_id=req.thread_id,
        reply=reply_text if isinstance(reply_text, str) else str(reply_text),
        tokens_used=final_state.get("tokens_used", 0),
        cost_usd=final_state.get("cost_usd", 0.0),
        finished=final_state.get("finished", False),
        error=final_state.get("error"),
    )
