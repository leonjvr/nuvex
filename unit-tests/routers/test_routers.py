"""Unit tests — audit, cron, and threads routers.

All database calls are mocked — no live DB or Docker required.
"""
from __future__ import annotations

import sys
import types
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# ── stub heavy optional deps before any src import ───────────────────────────
for _name in ("aioimaplib", "aiosmtplib"):
    sys.modules.setdefault(_name, types.ModuleType(_name))

# ── shared helpers ────────────────────────────────────────────────────────────

def _utc(s: str = "2026-01-01T00:00:00+00:00") -> datetime:
    return datetime.fromisoformat(s)


def _fake_thread(**kw):
    t = MagicMock()
    t.id = kw.get("id", "thread-1")
    t.agent_id = kw.get("agent_id", "maya")
    t.channel = kw.get("channel", "whatsapp")
    t.participants = kw.get("participants", {})
    t.message_count = kw.get("message_count", 0)
    t.created_at = _utc()
    t.updated_at = _utc()
    return t


def _fake_audit(**kw):
    a = MagicMock()
    a.id = kw.get("id", 1)
    a.agent_id = kw.get("agent_id", "maya")
    a.invocation_id = kw.get("invocation_id", "inv-1")
    a.thread_id = kw.get("thread_id", "thread-1")
    a.action = kw.get("action", "tool_call")
    a.tool_name = kw.get("tool_name", "shell")
    a.decision = kw.get("decision", "approved")
    a.stage = kw.get("stage", "execute_tools")
    a.reason = kw.get("reason", None)
    a.org_id = kw.get("org_id", "default")
    a.sha256_hash = "a" * 64
    a.prev_hash = None
    a.cost_usd = 0.001
    a.created_at = _utc()
    return a


def _fake_cron(**kw):
    c = MagicMock()
    c.id = kw.get("id", 1)
    c.name = kw.get("name", "daily-report")
    c.agent_id = kw.get("agent_id", "maya")
    c.schedule = kw.get("schedule", "0 8 * * *")
    c.task_payload = kw.get("task_payload", {})
    c.enabled = kw.get("enabled", True)
    c.last_run_at = None
    c.next_run_at = None
    c.created_at = _utc()
    return c


# ── async HTTP client fixture ──────────────────────────────────────────────────

@pytest.fixture()
async def client():
    import httpx
    from httpx import ASGITransport
    from src.brain.server import create_app

    app = create_app()
    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        yield ac


# =============================================================================
# Audit router
# =============================================================================

class TestAuditListEndpoint:
    async def test_returns_entries(self, client):
        entries = [_fake_audit(id=1), _fake_audit(id=2)]

        mock_result = MagicMock()
        mock_result.scalars.return_value = iter(entries)
        mock_session = AsyncMock()
        mock_session.execute = AsyncMock(return_value=mock_result)
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)

        with patch("src.brain.routers.audit.get_session", return_value=mock_session):
            resp = await client.get("/audit/maya")

        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2
        assert data[0]["agent_id"] == "maya"
        assert data[0]["decision"] == "approved"

    async def test_invalid_limit_returns_422(self, client):
        resp = await client.get("/audit/maya?limit=0")
        assert resp.status_code == 422

    async def test_limit_too_large_returns_422(self, client):
        resp = await client.get("/audit/maya?limit=9999")
        assert resp.status_code == 422


class TestAuditVerifyEndpoint:
    async def test_valid_chain_returns_true(self, client):
        with patch(
            "src.brain.routers.audit.verify_chain",
            AsyncMock(return_value=(True, "chain valid (5 entries)")),
        ):
            resp = await client.get("/audit/maya/verify")

        assert resp.status_code == 200
        body = resp.json()
        assert body["valid"] is True
        assert body["agent_id"] == "maya"
        assert "chain valid" in body["message"]

    async def test_tampered_chain_returns_false(self, client):
        with patch(
            "src.brain.routers.audit.verify_chain",
            AsyncMock(return_value=(False, "hash mismatch at audit entry id=3")),
        ):
            resp = await client.get("/audit/maya/verify")

        assert resp.status_code == 200
        body = resp.json()
        assert body["valid"] is False
        assert "mismatch" in body["message"]

    async def test_db_error_returns_500(self, client):
        with patch(
            "src.brain.routers.audit.verify_chain",
            AsyncMock(side_effect=RuntimeError("db down")),
        ):
            resp = await client.get("/audit/maya/verify")

        assert resp.status_code == 500


# =============================================================================
# Threads router
# =============================================================================

class TestListThreads:
    async def test_returns_list(self, client):
        threads = [_fake_thread(id="t-1"), _fake_thread(id="t-2")]

        mock_result = MagicMock()
        mock_result.scalars.return_value = iter(threads)
        mock_session = AsyncMock()
        mock_session.execute = AsyncMock(return_value=mock_result)
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)

        with patch("src.brain.routers.threads.get_session", return_value=mock_session):
            resp = await client.get("/threads")

        assert resp.status_code == 200
        assert len(resp.json()) == 2

    async def test_invalid_limit_returns_422(self, client):
        resp = await client.get("/threads?limit=0")
        assert resp.status_code == 422


class TestGetThread:
    async def test_found(self, client):
        thread = _fake_thread(id="t-abc")

        mock_session = AsyncMock()
        mock_session.get = AsyncMock(return_value=thread)
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)

        with patch("src.brain.routers.threads.get_session", return_value=mock_session):
            resp = await client.get("/threads/t-abc")

        assert resp.status_code == 200
        assert resp.json()["id"] == "t-abc"

    async def test_not_found_returns_404(self, client):
        mock_session = AsyncMock()
        mock_session.get = AsyncMock(return_value=None)
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)

        with patch("src.brain.routers.threads.get_session", return_value=mock_session):
            resp = await client.get("/threads/no-such-thread")

        assert resp.status_code == 404


class TestCreateThread:
    async def test_creates_new_thread(self, client):
        thread = _fake_thread(id="new-1", agent_id="bot", channel="telegram")

        mock_session = AsyncMock()
        mock_session.get = AsyncMock(return_value=None)  # not existing
        mock_session.add = MagicMock()
        mock_session.commit = AsyncMock()
        mock_session.refresh = AsyncMock(side_effect=lambda t: None)
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)

        # After refresh, session.get returns the created object
        created = _fake_thread(id="new-1", agent_id="bot", channel="telegram")

        def _get_side_effect(model, pk):
            return None  # not pre-existing

        mock_session.get.side_effect = _get_side_effect

        with patch("src.brain.routers.threads.get_session", return_value=mock_session):
            # Patch Thread class so we can intercept the created object
            with patch("src.brain.routers.threads.Thread", return_value=created) as MockThread:
                created.id = "new-1"
                created.agent_id = "bot"
                created.channel = "telegram"
                resp = await client.post(
                    "/threads",
                    json={"id": "new-1", "agent_id": "bot", "channel": "telegram"},
                )

        assert resp.status_code == 201
        assert resp.json()["id"] == "new-1"

    async def test_existing_thread_returns_200(self, client):
        existing = _fake_thread(id="exists-1")

        mock_session = AsyncMock()
        mock_session.get = AsyncMock(return_value=existing)
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)

        with patch("src.brain.routers.threads.get_session", return_value=mock_session):
            resp = await client.post(
                "/threads",
                json={"id": "exists-1", "agent_id": "maya", "channel": "whatsapp"},
            )

        # Idempotent — returns 201 either way (FastAPI status_code applies to new creates)
        assert resp.status_code in (200, 201)
        assert resp.json()["id"] == "exists-1"


# =============================================================================
# Cron router
# =============================================================================

class TestListCronJobs:
    async def test_returns_list(self, client):
        jobs = [_fake_cron(name="job-a"), _fake_cron(name="job-b")]

        mock_result = MagicMock()
        mock_result.scalars.return_value = iter(jobs)
        mock_session = AsyncMock()
        mock_session.execute = AsyncMock(return_value=mock_result)
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)

        with patch("src.brain.routers.cron.get_session", return_value=mock_session):
            resp = await client.get("/cron")

        assert resp.status_code == 200
        names = [j["name"] for j in resp.json()]
        assert "job-a" in names
        assert "job-b" in names


class TestGetCronJob:
    async def test_found(self, client):
        job = _fake_cron(name="daily-report")

        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = job
        mock_session = AsyncMock()
        mock_session.execute = AsyncMock(return_value=mock_result)
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)

        with patch("src.brain.routers.cron.get_session", return_value=mock_session):
            resp = await client.get("/cron/daily-report")

        assert resp.status_code == 200
        assert resp.json()["name"] == "daily-report"
        assert resp.json()["schedule"] == "0 8 * * *"

    async def test_not_found_returns_404(self, client):
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None
        mock_session = AsyncMock()
        mock_session.execute = AsyncMock(return_value=mock_result)
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)

        with patch("src.brain.routers.cron.get_session", return_value=mock_session):
            resp = await client.get("/cron/no-such-job")

        assert resp.status_code == 404


class TestCreateCronJob:
    async def test_valid_job_returns_201(self, client):
        created = _fake_cron(name="new-job", schedule="*/5 * * * *")

        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = created
        mock_session = AsyncMock()
        mock_session.execute = AsyncMock(return_value=mock_result)
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)

        with patch("src.brain.routers.cron.register_cron", AsyncMock()):
            with patch("src.brain.routers.cron.get_session", return_value=mock_session):
                resp = await client.post(
                    "/cron",
                    json={
                        "name": "new-job",
                        "agent_id": "maya",
                        "schedule": "*/5 * * * *",
                    },
                )

        assert resp.status_code == 201
        assert resp.json()["name"] == "new-job"

    async def test_invalid_schedule_returns_422(self, client):
        with patch(
            "src.brain.routers.cron.register_cron",
            AsyncMock(side_effect=ValueError("Invalid cron expression: bad")),
        ):
            resp = await client.post(
                "/cron",
                json={"name": "bad", "agent_id": "maya", "schedule": "bad"},
            )

        assert resp.status_code == 422
        assert "Invalid cron" in resp.json()["detail"]


class TestDeleteCronJob:
    async def test_deletes_job(self, client):
        job = _fake_cron(name="old-job")

        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = job
        mock_session = AsyncMock()
        mock_session.execute = AsyncMock(return_value=mock_result)
        mock_session.delete = AsyncMock()
        mock_session.commit = AsyncMock()
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)

        mock_scheduler = MagicMock()
        mock_scheduler.get_job.return_value = None  # no live job to remove

        with patch("src.brain.routers.cron.get_session", return_value=mock_session):
            with patch("src.brain.cron.get_scheduler", return_value=mock_scheduler):
                resp = await client.delete("/cron/old-job")

        assert resp.status_code == 204

    async def test_delete_not_found_returns_404(self, client):
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None
        mock_session = AsyncMock()
        mock_session.execute = AsyncMock(return_value=mock_result)
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)

        with patch("src.brain.routers.cron.get_session", return_value=mock_session):
            resp = await client.delete("/cron/no-such-job")

        assert resp.status_code == 404


# =============================================================================
# 9.6 / 10.5 — Actions router
# =============================================================================

import uuid as _uuid


def _fake_action(**kw):
    a = MagicMock()
    a.id = _uuid.UUID(kw.get("id", str(_uuid.uuid4())))
    a.agent_id = kw.get("agent_id", "maya")
    a.action_type = kw.get("action_type", "send_message")
    a.target_channel = kw.get("target_channel", "whatsapp")
    a.payload = kw.get("payload", {"to": "12345@s.whatsapp.net", "text": "Hello"})
    a.status = kw.get("status", "pending")
    a.created_at = _utc()
    return a


def _mock_session_for_actions(rows=None, lookup_row=None):
    session = AsyncMock()

    list_result = MagicMock()
    list_result.scalars.return_value.all.return_value = rows or []

    lookup_result = MagicMock()
    lookup_result.scalar_one_or_none.return_value = lookup_row

    session.execute = AsyncMock(side_effect=[list_result, lookup_result])
    session.commit = AsyncMock()
    session.__aenter__ = AsyncMock(return_value=session)
    session.__aexit__ = AsyncMock(return_value=False)
    return session


class TestGetPendingActions:
    async def test_returns_pending_for_channel(self, client):
        action = _fake_action()
        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = [action]
        mock_session = AsyncMock()
        mock_session.execute = AsyncMock(return_value=mock_result)
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)

        with patch("src.brain.routers.actions.get_session", return_value=mock_session):
            resp = await client.get("/actions/pending?channel=whatsapp")

        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["target_channel"] == "whatsapp"
        assert data[0]["payload"]["to"] == "12345@s.whatsapp.net"

    async def test_missing_channel_param_returns_422(self, client):
        resp = await client.get("/actions/pending")
        assert resp.status_code == 422

    async def test_empty_queue_returns_empty_list(self, client):
        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = []
        mock_session = AsyncMock()
        mock_session.execute = AsyncMock(return_value=mock_result)
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)

        with patch("src.brain.routers.actions.get_session", return_value=mock_session):
            resp = await client.get("/actions/pending?channel=telegram")

        assert resp.status_code == 200
        assert resp.json() == []


class TestAckAction:
    async def test_ack_sent_marks_action_sent(self, client):
        action_id = str(_uuid.uuid4())
        action = _fake_action(id=action_id)
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = action
        mock_session = AsyncMock()
        mock_session.execute = AsyncMock(return_value=mock_result)
        mock_session.commit = AsyncMock()
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)

        with patch("src.brain.routers.actions.get_session", return_value=mock_session):
            resp = await client.post(f"/actions/{action_id}/ack?status=sent")

        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "sent"
        assert data["id"] == action_id

    async def test_ack_failed_with_error(self, client):
        action_id = str(_uuid.uuid4())
        action = _fake_action(id=action_id)
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = action
        mock_session = AsyncMock()
        mock_session.execute = AsyncMock(return_value=mock_result)
        mock_session.commit = AsyncMock()
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)

        with patch("src.brain.routers.actions.get_session", return_value=mock_session):
            resp = await client.post(
                f"/actions/{action_id}/ack?status=failed&error=connection+refused"
            )

        assert resp.status_code == 200
        assert action.status == "failed"
        assert action.error == "connection refused"

    async def test_ack_invalid_status_returns_400(self, client):
        action_id = str(_uuid.uuid4())
        resp = await client.post(f"/actions/{action_id}/ack?status=unknown")
        assert resp.status_code == 400

    async def test_ack_not_found_returns_404(self, client):
        action_id = str(_uuid.uuid4())
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None
        mock_session = AsyncMock()
        mock_session.execute = AsyncMock(return_value=mock_result)
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)

        with patch("src.brain.routers.actions.get_session", return_value=mock_session):
            resp = await client.post(f"/actions/{action_id}/ack?status=sent")

        assert resp.status_code == 404

    async def test_ack_invalid_uuid_returns_400(self, client):
        resp = await client.post("/actions/not-a-uuid/ack?status=sent")
        assert resp.status_code == 400
