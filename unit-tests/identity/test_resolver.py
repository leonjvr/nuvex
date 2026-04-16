"""Unit tests — ContactResolver (identity spec §2.1, §2.2, §2.3)."""
from __future__ import annotations

import asyncio
import time
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch
import pytest

from src.brain.identity.resolver import (
    ContactResolver,
    ContactResolution,
    _cache,
    _cache_key,
    _get_cached,
    _set_cached,
    invalidate,
    invalidate_contact,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_contact(id="abc", org_id="default", display_name="Alice", trust_tier=0, sanction=None):
    c = MagicMock()
    c.id = id
    c.org_id = org_id
    c.display_name = display_name
    c.trust_tier = trust_tier
    c.sanction = sanction
    c.sanction_until = None
    c.last_seen_at = None
    return c


def _make_handle(contact_id="abc", channel_type="whatsapp", handle="+27821234567"):
    h = MagicMock()
    h.contact_id = contact_id
    h.channel_type = channel_type
    h.handle = handle
    return h


# ---------------------------------------------------------------------------
# Tests: anonymous fallback
# ---------------------------------------------------------------------------

class TestAnonymousFallback:
    def test_handle_none_returns_anonymous_t0(self):
        """§2.1: handle=None → anonymous T0 resolution, no DB write."""
        resolver = ContactResolver()
        result = asyncio.get_event_loop().run_until_complete(
            resolver.resolve("default", "whatsapp", None, "Ghost")
        )
        assert result.is_anonymous is True
        assert result.trust_tier == 0
        assert result.contact_id is None
        assert result.display_name == "Ghost"

    def test_anonymous_without_sender_name(self):
        resolver = ContactResolver()
        result = asyncio.get_event_loop().run_until_complete(
            resolver.resolve("default", "telegram", None, None)
        )
        assert result.is_anonymous is True
        assert result.display_name == "Anonymous"


# ---------------------------------------------------------------------------
# Tests: TTL cache
# ---------------------------------------------------------------------------

class TestTTLCache:
    def setup_method(self):
        _cache.clear()

    def test_set_and_get_cached(self):
        """§2.2: cache stores and retrieves resolutions."""
        key = _cache_key("org1", "whatsapp", "+27821111111")
        res = ContactResolution(
            contact_id="x", display_name="X", trust_tier=1,
            sanction=None, sanction_until=None
        )
        _set_cached(key, res)
        assert _get_cached(key) is res

    def test_cache_expired(self):
        """§2.2: expired entries are removed from cache."""
        key = _cache_key("org1", "whatsapp", "+27829999999")
        res = ContactResolution(
            contact_id="y", display_name="Y", trust_tier=0,
            sanction=None, sanction_until=None
        )
        # Insert with past timestamp
        _cache[key] = (res, time.monotonic() - 35)  # 35s ago > 30s TTL
        assert _get_cached(key) is None

    def test_invalidate_removes_entry(self):
        key = _cache_key("org1", "whatsapp", "+27820000000")
        res = ContactResolution(
            contact_id="z", display_name="Z", trust_tier=2, sanction=None, sanction_until=None
        )
        _set_cached(key, res)
        invalidate("org1", "whatsapp", "+27820000000")
        assert _get_cached(key) is None

    def test_invalidate_contact_removes_all_entries(self):
        for handle in ["+1", "+2", "+3"]:
            key = _cache_key("org", "sms", handle)
            res = ContactResolution(
                contact_id="same-id", display_name="Sam", trust_tier=1,
                sanction=None, sanction_until=None
            )
            _set_cached(key, res)
        invalidate_contact("same-id")
        for handle in ["+1", "+2", "+3"]:
            assert _get_cached(_cache_key("org", "sms", handle)) is None


# ---------------------------------------------------------------------------
# Tests: resolve_or_create
# ---------------------------------------------------------------------------

class TestResolveOrCreate:
    def setup_method(self):
        _cache.clear()

    @patch("src.brain.identity.resolver.get_session")
    def test_auto_create_new_contact(self, mock_get_session):
        """§2.1: Unknown handle → auto-create T0 contact with display_name from sender_name."""
        session = AsyncMock()
        session.execute = AsyncMock()
        # No handle found
        handle_result = MagicMock()
        handle_result.scalar_one_or_none.return_value = None
        session.execute.return_value = handle_result
        session.add = MagicMock()
        session.flush = AsyncMock()
        session.commit = AsyncMock()

        ctx = MagicMock()
        ctx.__aenter__ = AsyncMock(return_value=session)
        ctx.__aexit__ = AsyncMock(return_value=False)
        mock_get_session.return_value = ctx

        resolver = ContactResolver()
        result = asyncio.get_event_loop().run_until_complete(
            resolver.resolve("default", "whatsapp", "+27821234567", "Bob")
        )
        assert result.trust_tier == 0
        assert result.display_name == "Bob"
        assert result.contact_id is not None
        assert session.add.call_count == 2  # Contact + ContactHandle

    @patch("src.brain.identity.resolver.get_session")
    def test_return_existing_contact(self, mock_get_session):
        """§2.1: Known handle → return existing contact with correct tier."""
        session = AsyncMock()
        handle = _make_handle(contact_id="existing-id")
        contact = _make_contact(id="existing-id", trust_tier=2)

        handle_result = MagicMock()
        handle_result.scalar_one_or_none.return_value = handle

        principal_result = MagicMock()
        principal_result.scalar_one_or_none.return_value = None

        session.execute = AsyncMock(side_effect=[handle_result, principal_result])
        session.get = AsyncMock(return_value=contact)
        session.commit = AsyncMock()

        ctx = MagicMock()
        ctx.__aenter__ = AsyncMock(return_value=session)
        ctx.__aexit__ = AsyncMock(return_value=False)
        mock_get_session.return_value = ctx

        resolver = ContactResolver()
        result = asyncio.get_event_loop().run_until_complete(
            resolver.resolve("default", "whatsapp", handle.handle, None)
        )
        assert result.contact_id == "existing-id"
        assert result.trust_tier == 2

    @patch("src.brain.identity.resolver.get_session")
    def test_sender_name_used_for_display_name(self, mock_get_session):
        """§2.1: sender_name is used as display_name for new contacts."""
        session = AsyncMock()
        none_result = MagicMock()
        none_result.scalar_one_or_none.return_value = None
        session.execute = AsyncMock(return_value=none_result)
        session.add = MagicMock()
        session.commit = AsyncMock()

        ctx = MagicMock()
        ctx.__aenter__ = AsyncMock(return_value=session)
        ctx.__aexit__ = AsyncMock(return_value=False)
        mock_get_session.return_value = ctx

        resolver = ContactResolver()
        result = asyncio.get_event_loop().run_until_complete(
            resolver.resolve("default", "telegram", "@charlie", "Charlie Smith")
        )
        assert result.display_name == "Charlie Smith"
