"""Unit tests — policy candidates API router (Section 29.6).

Spec:
- GET /policy-candidates returns rows with status=pending_review
- POST /policy-candidates/{id}/approve sets status='approved'
- POST /policy-candidates/{id}/reject sets status='rejected'
- Second approve on already-approved candidate returns 409
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from fastapi import FastAPI
from httpx import ASGITransport

from src.brain.routers.policy_candidates import router

CANDIDATE_UUID = uuid.UUID("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_session_cm(session: AsyncMock) -> AsyncMock:
    cm = AsyncMock()
    cm.__aenter__ = AsyncMock(return_value=session)
    cm.__aexit__ = AsyncMock(return_value=False)
    return cm


def _fake_candidate(status: str = "pending_review") -> MagicMock:
    c = MagicMock()
    c.id = CANDIDATE_UUID
    c.agent_id = "maya"
    c.division_id = None
    c.condition_tree = {"type": "eq", "field": "tool_name", "value": "shell"}
    c.action = "deny"
    c.rationale = "Repeated shell failures"
    c.source_threads = ["t1", "t2"]
    c.status = status
    c.reviewed_by = None
    c.reviewed_at = None
    c.created_at = datetime(2026, 1, 1, tzinfo=timezone.utc)
    return c


@pytest.fixture
async def client():
    """Minimal FastAPI app with only the policy-candidates router (no lifespan)."""
    app = FastAPI()
    app.include_router(router)
    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        yield ac


# ---------------------------------------------------------------------------
# TestPolicyCandidatesList
# ---------------------------------------------------------------------------

class TestPolicyCandidatesList:
    """spec: GET /policy-candidates returns pending_review rows."""

    async def test_policy_candidates_list(self, client):
        candidate = _fake_candidate(status="pending_review")

        mock_result = MagicMock()
        mock_result.scalars.return_value = iter([candidate])

        mock_session = AsyncMock()
        mock_session.execute = AsyncMock(return_value=mock_result)

        with patch(
            "src.brain.routers.policy_candidates.get_session",
            return_value=_make_session_cm(mock_session),
        ):
            resp = await client.get("/policy-candidates")

        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) == 1
        assert data[0]["status"] == "pending_review"
        assert data[0]["action"] == "deny"


# ---------------------------------------------------------------------------
# TestPolicyCandidateApproval
# ---------------------------------------------------------------------------

class TestPolicyCandidateApproval:
    """spec: approve / reject / 409 conflict flows."""

    async def test_policy_candidate_approval(self, client):
        candidate = _fake_candidate(status="pending_review")

        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = candidate

        mock_session = AsyncMock()
        mock_session.execute = AsyncMock(return_value=mock_result)
        mock_session.commit = AsyncMock()
        mock_session.refresh = AsyncMock()

        with patch(
            "src.brain.routers.policy_candidates.get_session",
            return_value=_make_session_cm(mock_session),
        ):
            resp = await client.post(
                f"/policy-candidates/{CANDIDATE_UUID}/approve",
                params={"reviewer_id": "ops-agent"},
            )

        assert resp.status_code == 200
        # The candidate mock was mutated by the router
        assert candidate.status == "approved"
        assert candidate.reviewed_by == "ops-agent"

    async def test_policy_candidate_rejection(self, client):
        candidate = _fake_candidate(status="pending_review")

        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = candidate

        mock_session = AsyncMock()
        mock_session.execute = AsyncMock(return_value=mock_result)
        mock_session.commit = AsyncMock()
        mock_session.refresh = AsyncMock()

        with patch(
            "src.brain.routers.policy_candidates.get_session",
            return_value=_make_session_cm(mock_session),
        ):
            resp = await client.post(
                f"/policy-candidates/{CANDIDATE_UUID}/reject",
                params={"reviewer_id": "ops-agent"},
            )

        assert resp.status_code == 200
        assert candidate.status == "rejected"

    async def test_policy_candidate_double_approve_conflict(self, client):
        """Second approve on an already-approved candidate returns 409."""
        candidate = _fake_candidate(status="approved")

        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = candidate

        mock_session = AsyncMock()
        mock_session.execute = AsyncMock(return_value=mock_result)

        with patch(
            "src.brain.routers.policy_candidates.get_session",
            return_value=_make_session_cm(mock_session),
        ):
            resp = await client.post(
                f"/policy-candidates/{CANDIDATE_UUID}/approve",
                params={"reviewer_id": "ops-agent"},
            )

        assert resp.status_code == 409
