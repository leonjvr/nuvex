"""API tests: device token CRUD — 16.11"""
from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, MagicMock, patch


class TestDeviceTokenCreate:
    """16.11a — POST /device-tokens returns plaintext once."""

    @pytest.mark.asyncio
    async def test_create_returns_plaintext_token(self):
        mock_session = AsyncMock()
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)
        mock_session.add = MagicMock()
        mock_session.commit = AsyncMock()

        with patch("src.dashboard.routers.device_tokens.get_session", return_value=mock_session):
            from src.dashboard.routers.device_tokens import create_token, CreateTokenRequest
            req = CreateTokenRequest(name="Office PC", created_by="operator")
            result = await create_token(req)

        assert "token" in result
        assert len(result["token"]) > 10  # plaintext token is long
        assert "token_hash" in result
        # Verify hash matches token
        import hashlib
        assert result["token_hash"] == hashlib.sha256(result["token"].encode()).hexdigest()

    @pytest.mark.asyncio
    async def test_list_does_not_expose_plaintext(self):
        mock_token = MagicMock()
        mock_token.id = "tok-1"
        mock_token.device_id = None
        mock_token.created_by = "operator"
        mock_token.created_at = None
        mock_token.revoked_at = None

        mock_session = AsyncMock()
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)
        mock_execute_result = MagicMock()
        mock_execute_result.scalars.return_value.all.return_value = [mock_token]
        mock_session.execute = AsyncMock(return_value=mock_execute_result)
        mock_session.get = AsyncMock(return_value=None)

        with patch("src.dashboard.routers.device_tokens.get_session", return_value=mock_session):
            from src.dashboard.routers.device_tokens import list_tokens
            result = await list_tokens()

        assert len(result) == 1
        # No plaintext token in response
        assert "token" not in result[0]
        assert result[0]["status"] == "active"

    @pytest.mark.asyncio
    async def test_revoke_sets_revoked_at(self):
        mock_token = MagicMock()
        mock_token.id = "tok-1"
        mock_token.revoked_at = None
        mock_token.device_id = None

        mock_session = AsyncMock()
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)
        mock_session.get = AsyncMock(return_value=mock_token)
        mock_session.commit = AsyncMock()

        mock_registry = MagicMock()
        mock_registry.get.return_value = None

        with patch("src.dashboard.routers.device_tokens.get_session", return_value=mock_session), \
             patch("src.dashboard.routers.device_tokens.get_registry", return_value=mock_registry):
            from src.dashboard.routers.device_tokens import revoke_token
            await revoke_token("tok-1")

        assert mock_token.revoked_at is not None


class TestDeviceTokenValidation:
    """16.11b — token validation: hash lookup, revoked check."""

    @pytest.mark.asyncio
    async def test_plaintext_stored_as_hash_only(self):
        """Verify we never store the plaintext token."""
        stored_rows: list = []

        mock_session = AsyncMock()
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)
        mock_session.add = lambda row: stored_rows.append(row)
        mock_session.commit = AsyncMock()

        with patch("src.dashboard.routers.device_tokens.get_session", return_value=mock_session):
            from src.dashboard.routers.device_tokens import create_token, CreateTokenRequest
            req = CreateTokenRequest(name="test")
            result = await create_token(req)

        assert len(stored_rows) == 1
        row = stored_rows[0]
        # token_hash should not equal the plaintext
        assert row.token_hash != result["token"]
        # But should match the sha256 hash
        import hashlib
        assert row.token_hash == hashlib.sha256(result["token"].encode()).hexdigest()
