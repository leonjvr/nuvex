"""Tests for thread ID parsing — task 18.4."""
from __future__ import annotations

import pytest
from src.brain.thread_id import build_thread_id, parse_thread_id, ThreadIDParts


class TestBuildThreadId:
    """18.4 — build_thread_id produces correct v2 format."""

    def test_v2_format(self):
        tid = build_thread_id("acme", "maya", "telegram", "123456")
        assert tid == "acme:maya:telegram:123456"

    def test_default_org(self):
        tid = build_thread_id("default", "agent1", "email", "user@example.com")
        assert tid.startswith("default:")


class TestParseThreadId:
    """18.4 — parse_thread_id handles v2 and v1 (legacy) formats."""

    def test_parse_v2_four_parts(self):
        parts = parse_thread_id("acme:maya:telegram:123456")
        assert parts.org_id == "acme"
        assert parts.agent_id == "maya"
        assert parts.channel == "telegram"
        assert parts.participant == "123456"

    def test_parse_v1_three_parts_defaults_org(self):
        parts = parse_thread_id("maya:whatsapp:123456")
        assert parts.org_id == "default"
        assert parts.agent_id == "maya"
        assert parts.channel == "whatsapp"
        assert parts.participant == "123456"

    def test_participant_with_colon(self):
        """Participant can contain colons (e.g. email addresses or JIDs)."""
        parts = parse_thread_id("acme:agent1:email:user@example.com")
        assert parts.org_id == "acme"
        assert parts.participant == "user@example.com"

    def test_v2_roundtrip(self):
        original = "org1:bot:sms:+1234567890"
        parts = parse_thread_id(original)
        rebuilt = build_thread_id(parts.org_id, parts.agent_id, parts.channel, parts.participant)
        assert rebuilt == original

    def test_invalid_format_raises(self):
        """A thread ID with fewer than 3 parts is invalid."""
        with pytest.raises((ValueError, IndexError)):
            parse_thread_id("onlyone")
