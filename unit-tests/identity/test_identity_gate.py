"""Unit tests — identity gate (identity spec §5.1–5.5)."""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.brain.governance.identity_gate import (
    IdentityDecision,
    evaluate_identity_gate,
    identity_gate_node,
)
from src.brain.state import AgentState


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _state(**kwargs) -> AgentState:
    defaults = {
        "agent_id": "maya",
        "thread_id": "t1",
        "contact_id": "c1",
        "contact_trust_tier": 1,
        "contact_sanction": None,
        "contact_sanction_until": None,
    }
    defaults.update(kwargs)
    return AgentState(**defaults)


# ---------------------------------------------------------------------------
# Tests: evaluate_identity_gate (synchronous logic)
# ---------------------------------------------------------------------------

class TestEvaluateIdentityGate:
    def test_hard_ban_blocks(self):
        """§5.1 — hard_ban → BLOCK."""
        state = _state(contact_sanction="hard_ban")
        result = evaluate_identity_gate(state)
        assert result.decision == IdentityDecision.BLOCK
        assert "hard_ban" in result.reason

    def test_temp_ban_active_blocks(self):
        """§5.1 — temp_ban with future expiry → BLOCK."""
        future = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
        state = _state(contact_sanction="temp_ban", contact_sanction_until=future)
        result = evaluate_identity_gate(state)
        assert result.decision == IdentityDecision.BLOCK

    def test_temp_ban_expired_clears_and_passes(self):
        """§5.2 — temp_ban past expiry → clear sanction, PASS."""
        past = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
        state = _state(contact_sanction="temp_ban", contact_sanction_until=past)
        result = evaluate_identity_gate(state)
        assert result.decision == IdentityDecision.PASS
        assert result.clear_sanction is True

    def test_shadowban_returns_shadowban(self):
        """§5.1 — shadowban → SHADOWBAN decision."""
        state = _state(contact_sanction="shadowban")
        result = evaluate_identity_gate(state)
        assert result.decision == IdentityDecision.SHADOWBAN

    def test_under_review_restricts_tools(self):
        """§5.1 — under_review → RESTRICT_TOOLS."""
        state = _state(contact_sanction="under_review")
        result = evaluate_identity_gate(state)
        assert result.decision == IdentityDecision.RESTRICT_TOOLS

    def test_t0_restricts_tools(self):
        """§5.1 — T0 contact with no sanction → RESTRICT_TOOLS."""
        state = _state(contact_trust_tier=0, contact_sanction=None)
        result = evaluate_identity_gate(state)
        assert result.decision == IdentityDecision.RESTRICT_TOOLS

    def test_t1_passes(self):
        """§5.1 — T1 contact with no sanction → PASS."""
        state = _state(contact_trust_tier=1, contact_sanction=None)
        result = evaluate_identity_gate(state)
        assert result.decision == IdentityDecision.PASS

    def test_t4_passes(self):
        state = _state(contact_trust_tier=4, contact_sanction=None)
        result = evaluate_identity_gate(state)
        assert result.decision == IdentityDecision.PASS


# ---------------------------------------------------------------------------
# Tests: identity_gate_node (async graph node)
# ---------------------------------------------------------------------------

class TestIdentityGateNode:
    def test_block_sets_finished_and_error(self):
        state = _state(contact_sanction="hard_ban")
        result = asyncio.get_event_loop().run_until_complete(identity_gate_node(state))
        assert result["finished"] is True
        assert "Access denied" in result["error"]

    def test_shadowban_finishes_silently(self):
        state = _state(contact_sanction="shadowban")
        result = asyncio.get_event_loop().run_until_complete(identity_gate_node(state))
        assert result["finished"] is True
        assert result.get("error") is None

    def test_restrict_tools_clears_active_tools(self):
        state = _state(contact_trust_tier=0)
        result = asyncio.get_event_loop().run_until_complete(identity_gate_node(state))
        assert result["active_tools"] == []
        assert "finished" not in result

    def test_pass_returns_empty_dict(self):
        state = _state(contact_trust_tier=2)
        result = asyncio.get_event_loop().run_until_complete(identity_gate_node(state))
        assert result == {}

    @patch("src.brain.governance.identity_gate.get_session")
    def test_expired_temp_ban_clears_db(self, mock_get_session):
        """§5.2 — expired temp_ban triggers DB sanction clear."""
        session = AsyncMock()
        contact = MagicMock()
        contact.sanction = "temp_ban"
        contact.sanction_until = None
        session.get = AsyncMock(return_value=contact)
        session.commit = AsyncMock()

        ctx = MagicMock()
        ctx.__aenter__ = AsyncMock(return_value=session)
        ctx.__aexit__ = AsyncMock(return_value=False)
        mock_get_session.return_value = ctx

        past = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
        state = _state(contact_sanction="temp_ban", contact_sanction_until=past)

        with patch("src.brain.governance.identity_gate.invalidate_contact"):
            asyncio.get_event_loop().run_until_complete(identity_gate_node(state))

        assert contact.sanction is None
