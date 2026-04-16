"""Unit tests — org config loader: YAML scan, DB sync, legacy fallback, divergence. (§18.5)"""
from __future__ import annotations

import types, sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_org(org_id: str, name: str = "Test Org", status: str = "active", policies: dict | None = None):
    org = MagicMock()
    org.org_id = org_id
    org.name = name
    org.status = status
    org.policies = policies or {}
    return org


# ---------------------------------------------------------------------------
# 18.5 — scan_org_configs
# ---------------------------------------------------------------------------

class TestScanOrgConfigs:
    def test_returns_empty_when_no_orgs_dir(self, tmp_path):
        from src.brain.org_config_loader import scan_org_configs
        with patch("src.brain.org_config_loader._data_root", return_value=tmp_path):
            result = scan_org_configs()
        assert result == {}

    def test_reads_org_configs(self, tmp_path):
        from src.brain.org_config_loader import scan_org_configs
        orgs = tmp_path / "orgs" / "acme"
        orgs.mkdir(parents=True)
        (orgs / "config.yaml").write_text("org_id: acme\nname: Acme Corp\n")
        with patch("src.brain.org_config_loader._data_root", return_value=tmp_path):
            result = scan_org_configs()
        assert "acme" in result
        assert result["acme"]["name"] == "Acme Corp"

    def test_skips_missing_config_yaml(self, tmp_path):
        from src.brain.org_config_loader import scan_org_configs
        orgs = tmp_path / "orgs" / "empty-org"
        orgs.mkdir(parents=True)
        with patch("src.brain.org_config_loader._data_root", return_value=tmp_path):
            result = scan_org_configs()
        assert result == {}

    def test_uses_directory_name_as_fallback_org_id(self, tmp_path):
        from src.brain.org_config_loader import scan_org_configs
        orgs = tmp_path / "orgs" / "beta"
        orgs.mkdir(parents=True)
        (orgs / "config.yaml").write_text("name: Beta Org\n")  # no org_id key
        with patch("src.brain.org_config_loader._data_root", return_value=tmp_path):
            result = scan_org_configs()
        assert "beta" in result


# ---------------------------------------------------------------------------
# 18.5 — sync_orgs_to_db
# ---------------------------------------------------------------------------

class TestSyncOrgsToDb:
    @pytest.mark.asyncio
    async def test_creates_org_when_not_in_db(self, tmp_path):
        from src.brain.org_config_loader import sync_orgs_to_db

        orgs_dir = tmp_path / "orgs" / "testorg"
        orgs_dir.mkdir(parents=True)
        (orgs_dir / "config.yaml").write_text("org_id: testorg\nname: Test\n")

        session = AsyncMock()
        session.get = AsyncMock(return_value=None)
        session.add = MagicMock()
        session.commit = AsyncMock()

        with (
            patch("src.brain.org_config_loader._data_root", return_value=tmp_path),
            patch("src.brain.org_config_loader.load_org_governance", return_value={}),
        ):
            changed = await sync_orgs_to_db(session)

        session.add.assert_called_once()
        assert "testorg" in changed

    @pytest.mark.asyncio
    async def test_no_change_when_org_exists_and_policies_match(self, tmp_path):
        from src.brain.org_config_loader import sync_orgs_to_db

        orgs_dir = tmp_path / "orgs" / "stable"
        orgs_dir.mkdir(parents=True)
        (orgs_dir / "config.yaml").write_text("org_id: stable\nname: Stable\n")

        existing = _make_org("stable", policies={"budgets": {"daily_usd": 10}})
        session = AsyncMock()
        session.get = AsyncMock(return_value=existing)
        session.add = MagicMock()
        session.commit = AsyncMock()

        same_gov = {"budgets": {"daily_usd": 10}}
        with (
            patch("src.brain.org_config_loader._data_root", return_value=tmp_path),
            patch("src.brain.org_config_loader.load_org_governance", return_value=same_gov),
        ):
            changed = await sync_orgs_to_db(session)

        session.add.assert_not_called()
        assert "stable" not in changed

    @pytest.mark.asyncio
    async def test_legacy_fallback_creates_default_org(self, tmp_path):
        """When no orgs/ directory exists, ensures 'default' org is created."""
        from src.brain.org_config_loader import sync_orgs_to_db

        session = AsyncMock()
        session.get = AsyncMock(return_value=None)
        session.add = MagicMock()
        session.commit = AsyncMock()

        with patch("src.brain.org_config_loader._data_root", return_value=tmp_path):
            changed = await sync_orgs_to_db(session)

        session.add.assert_called_once()
        args = session.add.call_args[0][0]
        assert args.org_id == "default"
        assert "default" in changed


# ---------------------------------------------------------------------------
# 18.5 — check_divergence
# ---------------------------------------------------------------------------

class TestCheckDivergence:
    @pytest.mark.asyncio
    async def test_reports_org_missing_from_db(self, tmp_path):
        from src.brain.org_config_loader import check_divergence

        orgs_dir = tmp_path / "orgs" / "neworg"
        orgs_dir.mkdir(parents=True)
        (orgs_dir / "config.yaml").write_text("org_id: neworg\nname: New\n")

        session = AsyncMock()
        session.get = AsyncMock(return_value=None)

        with (
            patch("src.brain.org_config_loader._data_root", return_value=tmp_path),
            patch("src.brain.org_config_loader.load_org_governance", return_value={}),
        ):
            divergent = await check_divergence(session)

        assert "neworg" in divergent

    @pytest.mark.asyncio
    async def test_reports_policy_mismatch(self, tmp_path):
        from src.brain.org_config_loader import check_divergence

        orgs_dir = tmp_path / "orgs" / "mismatch"
        orgs_dir.mkdir(parents=True)
        (orgs_dir / "config.yaml").write_text("org_id: mismatch\nname: M\n")

        existing = _make_org("mismatch", policies={"budgets": {"daily_usd": 10}})
        session = AsyncMock()
        session.get = AsyncMock(return_value=existing)

        new_policies = {"budgets": {"daily_usd": 99}}
        with (
            patch("src.brain.org_config_loader._data_root", return_value=tmp_path),
            patch("src.brain.org_config_loader.load_org_governance", return_value=new_policies),
        ):
            divergent = await check_divergence(session)

        assert "mismatch" in divergent

    @pytest.mark.asyncio
    async def test_no_divergence_when_in_sync(self, tmp_path):
        from src.brain.org_config_loader import check_divergence

        orgs_dir = tmp_path / "orgs" / "synced"
        orgs_dir.mkdir(parents=True)
        (orgs_dir / "config.yaml").write_text("org_id: synced\nname: Synced\n")

        policies = {"budgets": {"daily_usd": 5}}
        existing = _make_org("synced", policies=policies)
        session = AsyncMock()
        session.get = AsyncMock(return_value=existing)

        with (
            patch("src.brain.org_config_loader._data_root", return_value=tmp_path),
            patch("src.brain.org_config_loader.load_org_governance", return_value=policies),
        ):
            divergent = await check_divergence(session)

        assert "synced" not in divergent
