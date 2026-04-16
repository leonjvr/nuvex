"""Unit tests — Gatekeeper tools (identity spec §9.1–9.9)."""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.brain.tools.gatekeeper._auth import check_gatekeeper_access
from src.brain.tools.gatekeeper.promote_contact import promote_contact
from src.brain.tools.gatekeeper.apply_sanction import apply_sanction
from src.brain.tools.gatekeeper.lift_sanction import lift_sanction
from src.brain.tools.gatekeeper.resolve_contact import resolve_contact


# ---------------------------------------------------------------------------
# Tests: _auth
# ---------------------------------------------------------------------------

class TestGatekeeperAccess:
    """§9.9 — access check requires T3+ or operator/admin/owner."""

    def test_t3_caller_allowed(self):
        check_gatekeeper_access(caller_trust_tier=3, caller_principal_role=None)

    def test_t4_caller_allowed(self):
        check_gatekeeper_access(caller_trust_tier=4, caller_principal_role=None)

    def test_operator_role_allowed(self):
        check_gatekeeper_access(caller_trust_tier=0, caller_principal_role="operator")

    def test_admin_role_allowed(self):
        check_gatekeeper_access(caller_trust_tier=1, caller_principal_role="admin")

    def test_owner_role_allowed(self):
        check_gatekeeper_access(caller_trust_tier=0, caller_principal_role="owner")

    def test_t1_no_role_rejected(self):
        """§9.9 — T1 caller without role is rejected."""
        with pytest.raises(PermissionError):
            check_gatekeeper_access(caller_trust_tier=1, caller_principal_role=None)

    def test_t2_no_role_rejected(self):
        with pytest.raises(PermissionError):
            check_gatekeeper_access(caller_trust_tier=2, caller_principal_role=None)


# ---------------------------------------------------------------------------
# Tests: promote_contact
# ---------------------------------------------------------------------------

class TestPromoteContact:
    @patch("src.brain.tools.gatekeeper.promote_contact.TrustProgressionService")
    def test_promote_succeeds_for_admin(self, MockService):
        """§9.2 — promote_contact works for admin caller."""
        mock_service = MagicMock()
        mock_service.set_tier = AsyncMock()
        MockService.return_value = mock_service

        result = asyncio.get_event_loop().run_until_complete(
            promote_contact(
                contact_id="c1",
                new_tier=2,
                caller_trust_tier=0,
                caller_principal_role="admin",
            )
        )
        assert result["new_tier"] == 2
        assert result["action"] == "promoted"

    def test_promote_rejected_for_t1_no_role(self):
        """§9.9 — T1 caller without role rejected at auth check."""
        with pytest.raises(PermissionError):
            asyncio.get_event_loop().run_until_complete(
                promote_contact(
                    contact_id="c1",
                    new_tier=2,
                    caller_trust_tier=1,
                    caller_principal_role=None,
                )
            )


# ---------------------------------------------------------------------------
# Tests: apply_sanction
# ---------------------------------------------------------------------------

class TestApplySanction:
    @patch("src.brain.tools.gatekeeper.apply_sanction.get_session")
    @patch("src.brain.tools.gatekeeper.apply_sanction.invalidate_contact")
    def test_apply_temp_ban_succeeds_for_admin(self, mock_inv, mock_get_session):
        """§9.4 — admin can apply temp_ban."""
        contact = MagicMock()
        contact.sanction = None
        session = AsyncMock()
        session.get = AsyncMock(return_value=contact)
        session.commit = AsyncMock()

        ctx = MagicMock()
        ctx.__aenter__ = AsyncMock(return_value=session)
        ctx.__aexit__ = AsyncMock(return_value=False)
        mock_get_session.return_value = ctx

        result = asyncio.get_event_loop().run_until_complete(
            apply_sanction(
                contact_id="c1",
                sanction="temp_ban",
                reason="spamming",
                caller_trust_tier=0,
                caller_principal_role="admin",
            )
        )
        assert result["sanction"] == "temp_ban"
        assert contact.sanction == "temp_ban"

    @patch("src.brain.tools.gatekeeper.apply_sanction.get_session")
    def test_hard_ban_requires_owner(self, mock_get_session):
        """§9.4 — hard_ban can only be applied by owner."""
        with pytest.raises(PermissionError, match="owner"):
            asyncio.get_event_loop().run_until_complete(
                apply_sanction(
                    contact_id="c1",
                    sanction="hard_ban",
                    reason="fraud",
                    caller_trust_tier=0,
                    caller_principal_role="admin",
                )
            )

    def test_invalid_sanction_raises(self):
        with pytest.raises(ValueError):
            asyncio.get_event_loop().run_until_complete(
                apply_sanction(
                    contact_id="c1",
                    sanction="invalid_sanction",
                    reason="test",
                    caller_principal_role="owner",
                )
            )


# ---------------------------------------------------------------------------
# Tests: lift_sanction
# ---------------------------------------------------------------------------

class TestLiftSanction:
    @patch("src.brain.tools.gatekeeper.lift_sanction.get_session")
    @patch("src.brain.tools.gatekeeper.lift_sanction.invalidate_contact")
    def test_lift_temp_ban_succeeds_for_admin(self, mock_inv, mock_get_session):
        """§9.5 — admin can lift temp_ban."""
        contact = MagicMock()
        contact.sanction = "temp_ban"
        session = AsyncMock()
        session.get = AsyncMock(return_value=contact)
        session.commit = AsyncMock()

        ctx = MagicMock()
        ctx.__aenter__ = AsyncMock(return_value=session)
        ctx.__aexit__ = AsyncMock(return_value=False)
        mock_get_session.return_value = ctx

        result = asyncio.get_event_loop().run_until_complete(
            lift_sanction(
                contact_id="c1",
                caller_trust_tier=0,
                caller_principal_role="admin",
            )
        )
        assert result["lifted_sanction"] == "temp_ban"
        assert contact.sanction is None

    @patch("src.brain.tools.gatekeeper.lift_sanction.get_session")
    def test_lift_hard_ban_requires_owner(self, mock_get_session):
        """§9.5 — lifting hard_ban requires owner."""
        contact = MagicMock()
        contact.sanction = "hard_ban"
        session = AsyncMock()
        session.get = AsyncMock(return_value=contact)

        ctx = MagicMock()
        ctx.__aenter__ = AsyncMock(return_value=session)
        ctx.__aexit__ = AsyncMock(return_value=False)
        mock_get_session.return_value = ctx

        with pytest.raises(PermissionError, match="owner"):
            asyncio.get_event_loop().run_until_complete(
                lift_sanction(
                    contact_id="c1",
                    caller_trust_tier=0,
                    caller_principal_role="admin",
                )
            )
