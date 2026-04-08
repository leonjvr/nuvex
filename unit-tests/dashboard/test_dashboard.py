"""Unit tests — NUVEX Dashboard FastAPI application.

All database calls and config lookups are mocked — no live DB or Docker required.
"""
from __future__ import annotations

import sys
import types
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# ── stub heavy optional deps before any src import ───────────────────────────
for _name in ("aioimaplib", "aiosmtplib"):
    sys.modules.setdefault(_name, types.ModuleType(_name))


# ── shared helpers ────────────────────────────────────────────────────────────

def _utc(s: str = "2026-01-01T00:00:00+00:00") -> datetime:
    return datetime.fromisoformat(s)


def _fake_agent(**kw):
    a = MagicMock()
    a.id = kw.get("id", "maya")
    a.name = kw.get("name", "Maya")
    a.tier = kw.get("tier", "standard")
    a.division = kw.get("division", "ops")
    a.lifecycle_state = kw.get("lifecycle_state", "active")
    a.workspace_path = kw.get("workspace_path", "/workspace/maya")
    a.created_at = _utc()
    return a


def _fake_budget(**kw):
    b = MagicMock()
    b.agent_id = kw.get("agent_id", "maya")
    b.division = kw.get("division", "ops")
    b.daily_usd_used = kw.get("daily_usd_used", 0.05)
    b.daily_usd_limit = kw.get("daily_usd_limit", 5.0)
    b.monthly_usd_used = kw.get("monthly_usd_used", 1.23)
    b.monthly_usd_limit = kw.get("monthly_usd_limit", 50.0)
    b.total_usd_used = kw.get("total_usd_used", 10.0)
    b.last_updated_at = _utc()
    return b


def _fake_event(**kw):
    e = MagicMock()
    e.id = kw.get("id", "evt-1")
    e.lane = kw.get("lane", "task")
    e.status = kw.get("status", "completed")
    e.failure_class = kw.get("failure_class", None)
    e.agent_id = kw.get("agent_id", "maya")
    e.invocation_id = kw.get("invocation_id", "inv-1")
    e.retry_count = kw.get("retry_count", 0)
    e.created_at = _utc()
    return e


def _fake_service_health(**kw):
    sh = MagicMock()
    sh.service = kw.get("service", "openai")
    sh.status = kw.get("status", "healthy")
    sh.latency_ms = kw.get("latency_ms", 120.0)
    sh.error = kw.get("error", None)
    sh.checked_at = _utc()
    return sh


def _fake_task(**kw):
    t = MagicMock()
    t.id = kw.get("id", "task-1")
    t.title = kw.get("title", "Do something")
    t.assigned_agent = kw.get("assigned_agent", "maya")
    t.priority = kw.get("priority", 5)
    t.status = kw.get("status", "pending")
    t.verification_level = kw.get("verification_level", "auto")
    t.created_at = _utc()
    return t


def _make_session(*scalars_calls):
    """Return a mock async context-manager session.

    scalars_calls: each positional arg is the iterable returned by successive
    .scalars().all() or .scalar_one_or_none() calls in sequence.
    """
    mock_session = AsyncMock()
    mock_session.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session.__aexit__ = AsyncMock(return_value=False)
    return mock_session


def _make_exec_session(rows, scalar_one=None):
    """Session whose execute() returns rows (via .scalars()),
    and whose .get() returns scalar_one."""
    mock_result = MagicMock()
    mock_result.scalars.return_value.all.return_value = rows
    mock_result.scalar_one_or_none.return_value = scalar_one
    mock_session = AsyncMock()
    mock_session.execute = AsyncMock(return_value=mock_result)
    mock_session.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session.__aexit__ = AsyncMock(return_value=False)
    return mock_session


# ── async HTTP client fixture ─────────────────────────────────────────────────

@pytest.fixture()
async def client():
    import httpx
    from httpx import ASGITransport
    from src.dashboard.server import create_app

    app = create_app()
    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        yield ac


# =============================================================================
# /api/health
# =============================================================================

class TestHealthEndpoint:
    async def test_health_ok(self, client):
        resp = await client.get("/api/health")
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}


# =============================================================================
# /api/agents
# =============================================================================

class TestListAgents:
    async def test_returns_agent_list(self, client):
        agents = [_fake_agent(id="maya"), _fake_agent(id="aria")]
        session = _make_exec_session(agents)

        mock_cfg = MagicMock()
        mock_cfg.agents.get.return_value = None  # no agent_def → model=None

        with (
            patch("src.dashboard.routers.agents.get_session", return_value=session),
            patch("src.dashboard.routers.agents.get_cached_config", return_value=mock_cfg),
        ):
            resp = await client.get("/api/agents")

        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2
        assert data[0]["id"] == "maya"
        assert data[0]["model"] is None

    async def test_model_filled_when_agent_def_present(self, client):
        agents = [_fake_agent(id="maya")]
        session = _make_exec_session(agents)

        mock_agent_def = MagicMock()
        mock_agent_def.model.primary = "openai/gpt-4o"
        mock_cfg = MagicMock()
        mock_cfg.agents.get.return_value = mock_agent_def

        with (
            patch("src.dashboard.routers.agents.get_session", return_value=session),
            patch("src.dashboard.routers.agents.get_cached_config", return_value=mock_cfg),
        ):
            resp = await client.get("/api/agents")

        assert resp.status_code == 200
        assert resp.json()[0]["model"] == "openai/gpt-4o"


class TestGetAgent:
    async def test_found(self, client):
        agent = _fake_agent(id="maya")
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = agent
        session = AsyncMock()
        session.execute = AsyncMock(return_value=mock_result)
        session.__aenter__ = AsyncMock(return_value=session)
        session.__aexit__ = AsyncMock(return_value=False)

        with patch("src.dashboard.routers.agents.get_session", return_value=session):
            resp = await client.get("/api/agents/maya")

        assert resp.status_code == 200
        body = resp.json()
        assert body["id"] == "maya"
        assert body["lifecycle_state"] == "active"

    async def test_not_found_returns_404(self, client):
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None
        session = AsyncMock()
        session.execute = AsyncMock(return_value=mock_result)
        session.__aenter__ = AsyncMock(return_value=session)
        session.__aexit__ = AsyncMock(return_value=False)

        with patch("src.dashboard.routers.agents.get_session", return_value=session):
            resp = await client.get("/api/agents/no-such-agent")

        assert resp.status_code == 404


class TestAgentStatus:
    async def test_returns_budget_info(self, client):
        agent = _fake_agent(id="maya")
        budget = _fake_budget(agent_id="maya")

        call_count = 0
        async def _exec(_q):
            nonlocal call_count
            r = MagicMock()
            if call_count == 0:
                r.scalar_one_or_none.return_value = agent
            else:
                r.scalar_one_or_none.return_value = budget
            call_count += 1
            return r

        session = AsyncMock()
        session.execute = _exec
        session.__aenter__ = AsyncMock(return_value=session)
        session.__aexit__ = AsyncMock(return_value=False)

        with patch("src.dashboard.routers.agents.get_session", return_value=session):
            resp = await client.get("/api/agents/maya/status")

        assert resp.status_code == 200
        body = resp.json()
        assert body["lifecycle_state"] == "active"
        assert body["daily_usd_limit"] == 5.0

    async def test_no_budget_defaults_to_zero(self, client):
        agent = _fake_agent(id="maya")
        call_count = 0
        async def _exec(_q):
            nonlocal call_count
            r = MagicMock()
            if call_count == 0:
                r.scalar_one_or_none.return_value = agent
            else:
                r.scalar_one_or_none.return_value = None
            call_count += 1
            return r

        session = AsyncMock()
        session.execute = _exec
        session.__aenter__ = AsyncMock(return_value=session)
        session.__aexit__ = AsyncMock(return_value=False)

        with patch("src.dashboard.routers.agents.get_session", return_value=session):
            resp = await client.get("/api/agents/maya/status")

        assert resp.status_code == 200
        assert resp.json()["daily_usd_used"] == 0

    async def test_agent_not_found_returns_404(self, client):
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None

        call_count = 0
        async def _exec(_q):
            nonlocal call_count
            r = MagicMock()
            r.scalar_one_or_none.return_value = None
            call_count += 1
            return r

        session = AsyncMock()
        session.execute = _exec
        session.__aenter__ = AsyncMock(return_value=session)
        session.__aexit__ = AsyncMock(return_value=False)

        with patch("src.dashboard.routers.agents.get_session", return_value=session):
            resp = await client.get("/api/agents/ghost/status")

        assert resp.status_code == 404


# =============================================================================
# /api/costs
# =============================================================================

class TestCostsSummary:
    async def test_returns_budget_rows(self, client):
        budgets = [_fake_budget(agent_id="maya"), _fake_budget(agent_id="aria")]
        session = _make_exec_session(budgets)

        with patch("src.dashboard.routers.costs.get_session", return_value=session):
            resp = await client.get("/api/costs")

        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2
        assert data[0]["agent_id"] == "maya"
        assert data[0]["daily_usd_used"] == 0.05

    async def test_empty_returns_empty_list(self, client):
        session = _make_exec_session([])

        with patch("src.dashboard.routers.costs.get_session", return_value=session):
            resp = await client.get("/api/costs")

        assert resp.status_code == 200
        assert resp.json() == []


# =============================================================================
# /api/events
# =============================================================================

class TestListEvents:
    async def test_returns_events(self, client):
        events = [_fake_event(id="e-1"), _fake_event(id="e-2")]
        session = _make_exec_session(events)

        with patch("src.dashboard.routers.events.get_session", return_value=session):
            resp = await client.get("/api/events")

        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2
        assert data[0]["lane"] == "task"

    async def test_query_params_accepted(self, client):
        session = _make_exec_session([])

        with patch("src.dashboard.routers.events.get_session", return_value=session):
            resp = await client.get("/api/events?lane=task&status=completed&agent_id=maya&limit=10&offset=5")

        assert resp.status_code == 200

    async def test_limit_cap_enforced(self, client):
        resp = await client.get("/api/events?limit=9999")
        assert resp.status_code == 422


# =============================================================================
# /api/health/services
# =============================================================================

class TestListServices:
    async def test_returns_service_health(self, client):
        rows = [_fake_service_health(service="openai"), _fake_service_health(service="groq")]
        session = _make_exec_session(rows)

        with patch("src.dashboard.routers.health_services.get_session", return_value=session):
            resp = await client.get("/api/health/services")

        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2
        assert data[0]["service"] == "openai"
        assert data[0]["status"] == "healthy"

    async def test_empty_returns_empty_list(self, client):
        session = _make_exec_session([])

        with patch("src.dashboard.routers.health_services.get_session", return_value=session):
            resp = await client.get("/api/health/services")

        assert resp.status_code == 200
        assert resp.json() == []


# =============================================================================
# /api/tasks
# =============================================================================

class TestListTasks:
    async def test_returns_task_list(self, client):
        tasks = [_fake_task(id="t-1"), _fake_task(id="t-2")]
        session = _make_exec_session(tasks)

        with patch("src.dashboard.routers.tasks.get_session", return_value=session):
            resp = await client.get("/api/tasks")

        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2
        assert data[0]["title"] == "Do something"

    async def test_query_params_accepted(self, client):
        session = _make_exec_session([])

        with patch("src.dashboard.routers.tasks.get_session", return_value=session):
            resp = await client.get("/api/tasks?agent_id=maya&status=pending&limit=20")

        assert resp.status_code == 200

    async def test_limit_cap_enforced(self, client):
        resp = await client.get("/api/tasks?limit=9999")
        assert resp.status_code == 422


class TestCreateTask:
    async def test_creates_and_returns_id(self, client):
        session = AsyncMock()
        session.add = MagicMock()
        session.commit = AsyncMock()
        session.__aenter__ = AsyncMock(return_value=session)
        session.__aexit__ = AsyncMock(return_value=False)

        with patch("src.dashboard.routers.tasks.get_session", return_value=session):
            resp = await client.post("/api/tasks", json={
                "title": "Fix the bug",
                "assigned_agent": "maya",
                "priority": 3,
                "acceptance_criteria": ["passes tests"],
                "verification_level": "auto",
            })

        assert resp.status_code == 201
        assert "id" in resp.json()

    async def test_missing_required_fields_returns_422(self, client):
        resp = await client.post("/api/tasks", json={"title": "oops"})
        assert resp.status_code == 422


# =============================================================================
# /api/workspace
# =============================================================================

class TestWorkspaceRouter:
    async def test_list_files(self, client, tmp_path):
        ws = tmp_path / "workspace"
        ws.mkdir()
        (ws / "SOUL.md").write_text("hello")
        (ws / "skills").mkdir()
        (ws / "skills" / "tool.sh").write_text("#!/bin/bash")

        mock_agent = MagicMock()
        mock_agent.workspace = str(ws)
        mock_cfg = MagicMock()
        mock_cfg.agents.get.return_value = mock_agent

        with patch("src.dashboard.routers.workspace.get_cached_config", return_value=mock_cfg):
            resp = await client.get("/api/workspace/maya/files")

        assert resp.status_code == 200
        data = resp.json()
        assert data["agent_id"] == "maya"
        paths = [f["path"] for f in data["files"]]
        assert "SOUL.md" in paths
        assert "skills/tool.sh" in paths

    async def test_read_file(self, client, tmp_path):
        ws = tmp_path / "workspace"
        ws.mkdir()
        (ws / "SOUL.md").write_text("I am Maya")

        mock_agent = MagicMock()
        mock_agent.workspace = str(ws)
        mock_cfg = MagicMock()
        mock_cfg.agents.get.return_value = mock_agent

        with patch("src.dashboard.routers.workspace.get_cached_config", return_value=mock_cfg):
            resp = await client.get("/api/workspace/maya/files/SOUL.md")

        assert resp.status_code == 200
        assert resp.json()["content"] == "I am Maya"

    async def test_agent_not_found_returns_404(self, client):
        mock_cfg = MagicMock()
        mock_cfg.agents.get.return_value = None

        with patch("src.dashboard.routers.workspace.get_cached_config", return_value=mock_cfg):
            resp = await client.get("/api/workspace/ghost/files")

        assert resp.status_code == 404

    async def test_path_traversal_blocked(self, client, tmp_path):
        ws = tmp_path / "workspace"
        ws.mkdir()

        mock_agent = MagicMock()
        mock_agent.workspace = str(ws)
        mock_cfg = MagicMock()
        mock_cfg.agents.get.return_value = mock_agent

        with patch("src.dashboard.routers.workspace.get_cached_config", return_value=mock_cfg):
            # Use percent-encoded dots so httpx does not normalize the path client-side.
            # Starlette decodes %2e → '.' in the path parameter, so the traversal guard
            # receives '../../etc/passwd' and must reject it (400 or 404).
            resp = await client.get("/api/workspace/maya/files/%2e%2e/%2e%2e/etc/passwd")

        assert resp.status_code in (400, 404)

    async def test_write_file(self, client, tmp_path):
        ws = tmp_path / "workspace"
        ws.mkdir()

        mock_agent = MagicMock()
        mock_agent.workspace = str(ws)
        mock_cfg = MagicMock()
        mock_cfg.agents.get.return_value = mock_agent

        with patch("src.dashboard.routers.workspace.get_cached_config", return_value=mock_cfg):
            resp = await client.put(
                "/api/workspace/maya/files/NOTES.md",
                json={"content": "new content"},
            )

        assert resp.status_code == 204
        assert (ws / "NOTES.md").read_text() == "new content"
