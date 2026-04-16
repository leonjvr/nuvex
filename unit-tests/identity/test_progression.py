"""Unit tests — TrustProgressionService (identity spec §4.1–4.3)."""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.brain.identity.progression import TrustProgressionService


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_contact(
    id="c1",
    trust_tier=0,
    message_count=0,
    created_days_ago=2,
):
    c = MagicMock()
    c.id = id
    c.trust_tier = trust_tier
    c.message_count = message_count
    now = datetime.now(timezone.utc)
    c.created_at = now - timedelta(days=created_days_ago)
    c.updated_at = now
    return c


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestT0ToT1Promotion:
    """§4.1 — auto promotion T0→T1 when thresholds met."""

    @patch("src.brain.identity.progression.get_session")
    @patch("src.brain.identity.progression.invalidate_contact")
    def test_promotion_when_thresholds_met(self, mock_inv, mock_get_session):
        contact = _make_contact(trust_tier=0, message_count=10, created_days_ago=3)
        session = AsyncMock()
        session.get = AsyncMock(return_value=contact)
        session.commit = AsyncMock()

        ctx = MagicMock()
        ctx.__aenter__ = AsyncMock(return_value=session)
        ctx.__aexit__ = AsyncMock(return_value=False)
        mock_get_session.return_value = ctx

        service = TrustProgressionService(min_messages=5, min_days=1)
        promoted = asyncio.get_event_loop().run_until_complete(
            service.maybe_promote_t0("c1", "default")
        )
        assert promoted is True
        assert contact.trust_tier == 1
        mock_inv.assert_called_once_with("c1")

    @patch("src.brain.identity.progression.get_session")
    def test_no_promotion_when_messages_too_few(self, mock_get_session):
        contact = _make_contact(trust_tier=0, message_count=2, created_days_ago=5)
        session = AsyncMock()
        session.get = AsyncMock(return_value=contact)

        ctx = MagicMock()
        ctx.__aenter__ = AsyncMock(return_value=session)
        ctx.__aexit__ = AsyncMock(return_value=False)
        mock_get_session.return_value = ctx

        service = TrustProgressionService(min_messages=5, min_days=1)
        promoted = asyncio.get_event_loop().run_until_complete(
            service.maybe_promote_t0("c1", "default")
        )
        assert promoted is False
        assert contact.trust_tier == 0

    @patch("src.brain.identity.progression.get_session")
    def test_no_promotion_when_not_t0(self, mock_get_session):
        """Already T1 contact is not promoted again."""
        contact = _make_contact(trust_tier=1, message_count=100, created_days_ago=30)
        session = AsyncMock()
        session.get = AsyncMock(return_value=contact)

        ctx = MagicMock()
        ctx.__aenter__ = AsyncMock(return_value=session)
        ctx.__aexit__ = AsyncMock(return_value=False)
        mock_get_session.return_value = ctx

        service = TrustProgressionService(min_messages=5, min_days=1)
        promoted = asyncio.get_event_loop().run_until_complete(
            service.maybe_promote_t0("c1", "default")
        )
        assert promoted is False


class TestManualTierSetting:
    """§4.1 — manual tier changes require auth."""

    @patch("src.brain.identity.progression.get_session")
    @patch("src.brain.identity.progression.invalidate_contact")
    def test_admin_can_set_t2(self, mock_inv, mock_get_session):
        contact = _make_contact(trust_tier=1)
        session = AsyncMock()
        session.get = AsyncMock(return_value=contact)
        session.commit = AsyncMock()

        ctx = MagicMock()
        ctx.__aenter__ = AsyncMock(return_value=session)
        ctx.__aexit__ = AsyncMock(return_value=False)
        mock_get_session.return_value = ctx

        service = TrustProgressionService()
        asyncio.get_event_loop().run_until_complete(
            service.set_tier("c1", new_tier=2, caller_tier=1, caller_principal_role="admin")
        )
        assert contact.trust_tier == 2

    def test_t3_to_t4_requires_owner(self):
        """§4.3 — T3→T4 promotion is owner-only."""
        service = TrustProgressionService()
        with pytest.raises(PermissionError):
            asyncio.get_event_loop().run_until_complete(
                service.set_tier(
                    "c1", new_tier=4, caller_tier=3, caller_principal_role="admin"
                )
            )

    def test_t1_to_t2_blocked_without_manual(self):
        """§4.2 — T1→T2 is manual only; T1 caller without admin role blocked."""
        service = TrustProgressionService()
        with pytest.raises(PermissionError):
            asyncio.get_event_loop().run_until_complete(
                service.set_tier(
                    "c1", new_tier=2, caller_tier=1, caller_principal_role=None
                )
            )

    def test_invalid_tier_raises_value_error(self):
        service = TrustProgressionService()
        with pytest.raises(ValueError):
            asyncio.get_event_loop().run_until_complete(
                service.set_tier(
                    "c1", new_tier=5, caller_tier=3, caller_principal_role="owner"
                )
            )
