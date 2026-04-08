"""Unit tests — governance audit chain: hash function and verify_chain."""
from __future__ import annotations

import hashlib
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.brain.governance.audit import _hash, verify_chain


# ---------------------------------------------------------------------------
# _hash
# ---------------------------------------------------------------------------

class TestHashFunction:
    def test_returns_64_char_hex(self):
        result = _hash({"agent_id": "maya", "action": "tool_call", "decision": "approved"}, None)
        assert len(result) == 64
        assert all(c in "0123456789abcdef" for c in result)

    def test_deterministic(self):
        data = {"agent_id": "maya", "action": "shell", "decision": "denied"}
        assert _hash(data, "abc") == _hash(data, "abc")

    def test_prev_hash_included_in_digest(self):
        data = {"agent_id": "maya", "action": "tool_call", "decision": "approved"}
        h1 = _hash(data, None)
        h2 = _hash(data, "some-previous-hash")
        assert h1 != h2

    def test_different_data_different_hash(self):
        data_a = {"agent_id": "agent-a", "action": "shell", "decision": "approved"}
        data_b = {"agent_id": "agent-b", "action": "shell", "decision": "approved"}
        assert _hash(data_a, None) != _hash(data_b, None)

    def test_matches_manual_sha256(self):
        data = {"agent_id": "x", "action": "a", "decision": "d"}
        expected_input = json.dumps({**data, "prev_hash": ""}, sort_keys=True, default=str)
        expected = hashlib.sha256(expected_input.encode()).hexdigest()
        assert _hash(data, None) == expected


# ---------------------------------------------------------------------------
# verify_chain — using mocked DB session
# ---------------------------------------------------------------------------

def _make_entry(
    id_: int,
    agent_id: str,
    prev_hash: str | None,
    *,
    action: str = "tool_call",
    invocation_id: str = "inv-1",
    thread_id: str = "t-1",
    tool_name: str | None = "shell",
    decision: str = "approved",
    stage: str = "check_policy",
    reason: str | None = None,
    cost_usd: float = 0.0,
) -> MagicMock:
    """Build a fake GovernanceAudit ORM row with a correct hash."""
    row_data = {
        "agent_id": agent_id,
        "invocation_id": invocation_id,
        "thread_id": thread_id,
        "action": action,
        "tool_name": tool_name,
        "decision": decision,
        "stage": stage,
        "reason": reason,
        "cost_usd": cost_usd,
    }
    sha = _hash(row_data, prev_hash)
    entry = MagicMock()
    entry.id = id_
    for k, v in row_data.items():
        setattr(entry, k, v)
    entry.sha256_hash = sha
    entry.prev_hash = prev_hash
    return entry


class TestVerifyChain:
    async def _run_verify(self, entries):
        mock_result = MagicMock()
        mock_result.scalars.return_value = entries
        mock_session = AsyncMock()
        mock_session.execute = AsyncMock(return_value=mock_result)
        mock_ctx = MagicMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=mock_session)
        mock_ctx.__aexit__ = AsyncMock(return_value=False)
        with patch("src.brain.governance.audit.get_session", return_value=mock_ctx):
            return await verify_chain("maya")

    @pytest.mark.asyncio
    async def test_empty_chain_is_valid(self):
        valid, msg = await self._run_verify([])
        assert valid is True
        assert "no entries" in msg

    @pytest.mark.asyncio
    async def test_single_entry_valid(self):
        e = _make_entry(1, "maya", None)
        valid, msg = await self._run_verify([e])
        assert valid is True
        assert "1 entries" in msg

    @pytest.mark.asyncio
    async def test_two_linked_entries_valid(self):
        e1 = _make_entry(1, "maya", None)
        e2 = _make_entry(2, "maya", e1.sha256_hash, action="shell", invocation_id="inv-2")
        valid, msg = await self._run_verify([e1, e2])
        assert valid is True
        assert "2 entries" in msg

    @pytest.mark.asyncio
    async def test_tampered_hash_detected(self):
        e1 = _make_entry(1, "maya", None)
        e1.sha256_hash = "0" * 64  # tamper
        valid, msg = await self._run_verify([e1])
        assert valid is False
        assert "mismatch" in msg
        assert "id=1" in msg

    @pytest.mark.asyncio
    async def test_tampered_field_detected(self):
        e1 = _make_entry(1, "maya", None)
        # Change decision after hash was stored — hash no longer valid
        e1.decision = "denied"
        valid, msg = await self._run_verify([e1])
        assert valid is False

    @pytest.mark.asyncio
    async def test_second_entry_tamper_detected(self):
        e1 = _make_entry(1, "maya", None)
        e2 = _make_entry(2, "maya", e1.sha256_hash)
        e2.sha256_hash = "a" * 64  # tamper second entry
        valid, msg = await self._run_verify([e1, e2])
        assert valid is False
        assert "id=2" in msg
