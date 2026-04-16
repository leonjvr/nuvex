"""Unit tests — communication links validation (§18.6)."""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest


def _make_org(org_id: str, allowed_targets: list[str] | None = None):
    org = MagicMock()
    org.org_id = org_id
    org.communication_links = {}
    org.config = {}
    if allowed_targets is not None:
        org.communication_links = {"allowed_targets": allowed_targets}
    return org


class TestValidateCommunicationLink:
    """§11.2 — communication link validation before allowing work packet dispatch."""

    @pytest.mark.asyncio
    async def test_allows_declared_target(self):
        from src.brain.work_packets import _validate_communication_link

        source = _make_org("org-a", allowed_targets=["org-b", "org-c"])
        # Should not raise
        await _validate_communication_link(source, "org-b")

    @pytest.mark.asyncio
    async def test_rejects_undeclared_target(self):
        from src.brain.work_packets import _validate_communication_link

        source = _make_org("org-a", allowed_targets=["org-b"])
        with pytest.raises(ValueError, match="no communication link"):
            await _validate_communication_link(source, "org-z")

    @pytest.mark.asyncio
    async def test_open_policy_allows_all_when_no_allowed_targets(self):
        """When allowed_targets is empty/absent, any target is permitted (open policy)."""
        from src.brain.work_packets import _validate_communication_link

        source = _make_org("org-a", allowed_targets=[])
        # Should not raise — empty list means unrestricted
        await _validate_communication_link(source, "any-org")

    @pytest.mark.asyncio
    async def test_empty_communication_links_allows_all(self):
        from src.brain.work_packets import _validate_communication_link

        source = _make_org("org-a")  # no allowed_targets key
        await _validate_communication_link(source, "any-org")


class TestValidatePayloadSize:
    """§11.8 — payload size enforcement."""

    @pytest.mark.asyncio
    async def test_allows_small_payload(self):
        from src.brain.work_packets import _validate_payload_size

        org = _make_org("org-a")
        await _validate_payload_size(org, {"key": "value"})

    @pytest.mark.asyncio
    async def test_rejects_oversized_payload(self):
        from src.brain.work_packets import _validate_payload_size

        org = _make_org("org-a")
        org.config = {"max_packet_size_bytes": 10}  # tiny limit
        with pytest.raises(ValueError, match="exceeds limit"):
            await _validate_payload_size(org, {"data": "x" * 100})

    @pytest.mark.asyncio
    async def test_uses_default_1mb_limit(self):
        from src.brain.work_packets import _validate_payload_size

        org = _make_org("org-a")
        # 500KB payload — should pass with default 1MB limit
        await _validate_payload_size(org, {"data": "x" * 500_000})
