"""POST /invoke — run an agent invocation and return the response."""
from __future__ import annotations

import json
import logging
import uuid
from typing import AsyncIterator

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from langchain_core.messages import AnyMessage, HumanMessage
from langgraph.errors import GraphInterrupt
from langgraph.types import Command
from sqlalchemy import select

from ...shared.models.requests import InvokeRequest, InvokeResponse, ResumeRequest
from ..db import get_session
from ..lifecycle import LifecycleState, queue_invocation, set_registry_state
from ..models.agent import Agent
from ..state import AgentState
from ..graph import get_compiled_graph
from .invoke_persist import ensure_agent_row, persist_invocation

log = logging.getLogger(__name__)

# Legacy aliases — callers outside this module import these names from here
_ensure_agent_row = ensure_agent_row
_persist_invocation = persist_invocation

router = APIRouter(prefix="/invoke", tags=["invoke"])


async def _get_workspace_path(agent_id: str, org_id: str = "default") -> str | None:
    """Return the workspace_path for an agent from the DB, or the org-scoped canonical path."""
    try:
        async with get_session() as session:
            result = await session.execute(select(Agent).where(Agent.id == agent_id))
            agent = result.scalar_one_or_none()
            if agent and agent.workspace_path:
                return agent.workspace_path
            # §8.4 — first-run bootstrap: use org-scoped canonical path
            from ..workspace import resolve_workspace_path
            return resolve_workspace_path(agent_id, org_id)
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

    # Resolve org_id from agent DB row when caller did not specify one
    if req.org_id == "default":
        try:
            from ..models.agent import Agent as _Agent
            from ..db import get_session as _gs
            async with _gs() as _as:
                _agent_row = await _as.get(_Agent, req.agent_id)
                if _agent_row and _agent_row.org_id and _agent_row.org_id != "default":
                    req = req.model_copy(update={"org_id": _agent_row.org_id})
        except Exception as _oe:
            log.debug("invoke: could not resolve agent org_id (non-fatal): %s", _oe)

    # §3.4 — Cross-org thread access prevention: validate org_id prefix matches request
    if req.thread_id:
        parts = req.thread_id.split(":", 3)
        if len(parts) == 4:  # v2 format: org_id:agent_id:channel:participant
            thread_org = parts[0]
            if thread_org != req.org_id:
                raise HTTPException(
                    status_code=403,
                    detail="Thread belongs to a different organisation",
                )

    # §10.3 — Channel validation: if bindings exist for this org, enforce them
    if req.channel and req.org_id != "default":
        try:
            from ..models.channel_binding import ChannelBinding
            from ..db import get_session as _cbs
            from sqlalchemy import select as _sel
            async with _cbs() as _cbsess:
                _has_bindings = (await _cbsess.execute(
                    _sel(ChannelBinding.id).where(ChannelBinding.org_id == req.org_id).limit(1)
                )).scalar_one_or_none()
                if _has_bindings is not None:
                    sender_id = req.metadata.sender if req.metadata else None
                    _match = (await _cbsess.execute(
                        _sel(ChannelBinding.id).where(
                            ChannelBinding.org_id == req.org_id,
                            ChannelBinding.channel_type == req.channel,
                            ChannelBinding.channel_identity == sender_id,
                        ).limit(1)
                    )).scalar_one_or_none()
                    if _match is None:
                        raise HTTPException(
                            status_code=403,
                            detail="Channel identity not bound to this organisation",
                        )
        except HTTPException:
            raise
        except Exception as _cbe:
            log.debug("invoke: channel binding check failed (non-fatal): %s", _cbe)

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


    workspace_path = await _get_workspace_path(req.agent_id, req.org_id)
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
        org_id=req.org_id,
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

    # Resolve contact identity before graph runs (§2.4)
    try:
        from ..identity.resolver import ContactResolver
        org_id = req.metadata.model_dump().get("org_id", "default")
        channel_type = req.channel or "unknown"
        handle = req.metadata.sender if req.metadata.sender else None
        sender_name = req.metadata.model_dump().get("sender_name")
        resolution = await ContactResolver().resolve(org_id, channel_type, handle, sender_name)
        sanction_until_iso = (
            resolution.sanction_until.isoformat() if resolution.sanction_until else None
        )
        initial_state = initial_state.model_copy(update={
            "contact_id": resolution.contact_id,
            "contact_trust_tier": resolution.trust_tier,
            "contact_sanction": resolution.sanction,
            "contact_sanction_until": sanction_until_iso,
        })
    except Exception as _ce:
        log.debug("invoke: contact resolution failed (non-fatal): %s", _ce)

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
            org_id=req.org_id or "default",
        )

        # Post-invocation trust progression hook for T0 contacts (§4.2)
        contact_id = initial_state.contact_id
        contact_tier = initial_state.contact_trust_tier
        if contact_id is not None and contact_tier == 0:
            try:
                from ..identity.progression import TrustProgressionService
                from ..models.contact import Contact as _Contact
                # Increment message count on the contact row
                async with get_session() as _sess:
                    _contact = await _sess.get(_Contact, contact_id)
                    if _contact is not None:
                        _contact.message_count = (_contact.message_count or 0) + 1
                        await _sess.commit()
                # Check auto-promotion thresholds
                _req_org = req.metadata.model_dump().get("org_id", "default")
                await TrustProgressionService().maybe_promote_t0(contact_id, _req_org)
            except Exception as _pe:
                log.debug("invoke: progression hook failed (non-fatal): %s", _pe)

        return response

    # Queue if agent is already running; otherwise execute immediately
    try:
        return await queue_invocation(req.agent_id, _run)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


async def _build_initial_state(req: InvokeRequest, invocation_id: str) -> AgentState:
    messages = await _build_messages(req.agent_id, req.message)
    workspace_path = await _get_workspace_path(req.agent_id, req.org_id)
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
                    org_id=req.org_id or "default",
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
        )  # org_id uses DB default for delegated calls
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


# ---------------------------------------------------------------------------
# §6.2 — Org-scoped invoke: /api/v1/orgs/{org_id}/invoke
# ---------------------------------------------------------------------------

org_router = APIRouter(prefix="/orgs", tags=["orgs-invoke"])


@org_router.post("/{org_id}/invoke", response_model=InvokeResponse)
async def org_invoke(org_id: str, req: InvokeRequest) -> InvokeResponse:
    """Org-scoped invoke — validates org is active, then delegates to /invoke logic."""
    from .middleware import require_active_org
    from ..db import get_session as _gs

    async with _gs() as _session:
        await require_active_org(org_id, _session)

    # Inject org_id so downstream state carries it
    req_with_org = req.model_copy(update={"org_id": org_id})
    return await invoke(req_with_org)


# ---------------------------------------------------------------------------
# §6.2 — Legacy alias: /api/v1/invoke → default org (backward compat)
# ---------------------------------------------------------------------------

legacy_v1_router = APIRouter(prefix="/api/v1", tags=["invoke"])


@legacy_v1_router.post("/invoke", response_model=InvokeResponse)
async def invoke_v1_alias(req: InvokeRequest) -> InvokeResponse:
    """Legacy /api/v1/invoke — alias for default org invoke (backward compat)."""
    req_with_org = req.model_copy(update={"org_id": req.org_id or "default"})
    return await invoke(req_with_org)
