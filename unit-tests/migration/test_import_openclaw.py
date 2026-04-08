"""Unit tests — OpenClaw → NUVEX migration helper (src.shared.migration.import_openclaw).

All tests use tmp_path — no real filesystem writes outside of pytest's temp directories.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest
import yaml

from src.shared.migration.import_openclaw import (
    _build_nuvex_config,
    _extract_channels,
    _extract_model,
    _migrate_workspace,
    _parse_openclaw_config,
)

# ── fixtures ──────────────────────────────────────────────────────────────────

_MINIMAL_CFG: dict = {
    "channels": {
        "whatsapp": {"enabled": True},
        "telegram": {"enabled": False},
    },
    "agents": {
        "defaults": {
            "model": {
                "primary": "openai-codex/gpt-5.4",
                "fallback": "anthropic/claude-haiku-4-5",
            }
        }
    },
}

_BOOTSTRAP_FILENAMES = [
    "SOUL.md", "IDENTITY.md", "AGENTS.md", "TOOLS.md",
    "USER.md", "HEARTBEAT.md", "BOOTSTRAP.md",
]


@pytest.fixture()
def openclaw_json(tmp_path) -> Path:
    p = tmp_path / "openclaw.json"
    p.write_text(json.dumps(_MINIMAL_CFG), encoding="utf-8")
    return p


@pytest.fixture()
def workspace_src(tmp_path) -> Path:
    src = tmp_path / "workspace_src"
    src.mkdir()
    for fname in _BOOTSTRAP_FILENAMES:
        (src / fname).write_text(f"# {fname}")
    skills = src / "skills"
    skills.mkdir()
    (skills / "elevenlabs").mkdir()
    (skills / "elevenlabs" / "SKILL.md").write_text("# ElevenLabs skill")
    return src


# =============================================================================
# _parse_openclaw_config
# =============================================================================

class TestParseOpenclawConfig:
    def test_loads_valid_json(self, openclaw_json):
        cfg = _parse_openclaw_config(openclaw_json)
        assert "channels" in cfg
        assert "agents" in cfg

    def test_raises_on_missing_file(self, tmp_path):
        with pytest.raises(FileNotFoundError):
            _parse_openclaw_config(tmp_path / "nonexistent.json")

    def test_raises_on_invalid_json(self, tmp_path):
        p = tmp_path / "bad.json"
        p.write_text("not json")
        with pytest.raises(Exception):  # json.JSONDecodeError
            _parse_openclaw_config(p)


# =============================================================================
# _extract_channels
# =============================================================================

class TestExtractChannels:
    def test_only_enabled_channels_returned(self):
        channels = _extract_channels(_MINIMAL_CFG)
        assert "whatsapp" in channels
        assert "telegram" not in channels

    def test_no_enabled_key_defaults_to_included(self):
        cfg = {"channels": {"telegram": {}, "whatsapp": {"enabled": False}}}
        channels = _extract_channels(cfg)
        assert "telegram" in channels
        assert "whatsapp" not in channels

    def test_empty_channels_returns_empty(self):
        assert _extract_channels({}) == []
        assert _extract_channels({"channels": {}}) == []


# =============================================================================
# _extract_model
# =============================================================================

class TestExtractModel:
    def test_extracts_primary_and_fallback(self):
        model = _extract_model(_MINIMAL_CFG)
        assert model["primary"] == "openai-codex/gpt-5.4"
        assert model["fallback"] == "anthropic/claude-haiku-4-5"

    def test_defaults_when_no_model_config(self):
        model = _extract_model({})
        assert model["primary"] == "openai/gpt-4o-mini"
        assert model["fallback"] == "openai/gpt-4o-mini"

    def test_defaults_when_agents_empty(self):
        model = _extract_model({"agents": {}})
        assert model["primary"] == "openai/gpt-4o-mini"


# =============================================================================
# _build_nuvex_config
# =============================================================================

class TestBuildNuvexConfig:
    def test_produces_expected_shape(self):
        cfg = _build_nuvex_config(_MINIMAL_CFG, "maya", "workspace/")
        assert "agents" in cfg
        assert "maya" in cfg["agents"]
        agent = cfg["agents"]["maya"]
        assert agent["name"] == "maya"
        assert "routing" in agent
        assert "budget" in agent
        assert "compaction" in agent

    def test_model_normalisation(self):
        cfg = _build_nuvex_config(_MINIMAL_CFG, "maya", "workspace/")
        agent = cfg["agents"]["maya"]
        # openai-codex/gpt-5.4 → openai/gpt-4o
        assert agent["model"]["primary"] == "openai/gpt-4o"
        # anthropic/claude-haiku-4-5 → normalised form
        assert "anthropic" in agent["model"]["fallback"]

    def test_unknown_model_passes_through_unchanged(self):
        cfg_raw = {"channels": {}, "agents": {"defaults": {"model": {"primary": "custom/my-model"}}}}
        cfg = _build_nuvex_config(cfg_raw, "agent", "workspace/")
        assert cfg["agents"]["agent"]["model"]["primary"] == "custom/my-model"

    def test_workspace_path_set(self):
        cfg = _build_nuvex_config(_MINIMAL_CFG, "maya", "my/workspace/")
        assert cfg["agents"]["maya"]["workspace_path"] == "my/workspace/"

    def test_channels_in_description(self):
        cfg = _build_nuvex_config(_MINIMAL_CFG, "maya", "workspace/")
        desc = cfg["agents"]["maya"]["description"]
        assert "whatsapp" in desc


# =============================================================================
# _migrate_workspace
# =============================================================================

class TestMigrateWorkspace:
    def test_copies_bootstrap_files(self, workspace_src, tmp_path):
        dst = tmp_path / "workspace_dst"
        copied = _migrate_workspace(workspace_src, dst)

        for fname in _BOOTSTRAP_FILENAMES:
            assert (dst / fname).is_file(), f"Expected {fname} to be copied"
        assert any("SOUL.md" in c for c in copied)

    def test_copies_skills_directory(self, workspace_src, tmp_path):
        dst = tmp_path / "workspace_dst"
        _migrate_workspace(workspace_src, dst)

        assert (dst / "skills" / "elevenlabs" / "SKILL.md").is_file()

    def test_creates_dst_if_missing(self, workspace_src, tmp_path):
        dst = tmp_path / "brand_new_dst"
        assert not dst.exists()
        _migrate_workspace(workspace_src, dst)
        assert dst.is_dir()

    def test_skips_missing_bootstrap_files(self, tmp_path):
        src = tmp_path / "sparse_ws"
        src.mkdir()
        (src / "SOUL.md").write_text("# soul only")
        dst = tmp_path / "dst"

        copied = _migrate_workspace(src, dst)

        assert (dst / "SOUL.md").is_file()
        # Only SOUL.md was copied
        assert len([c for c in copied if ".md" in c]) == 1

    def test_replaces_existing_skills_dir(self, workspace_src, tmp_path):
        dst = tmp_path / "workspace_dst"
        dst.mkdir()
        old_skills = dst / "skills"
        old_skills.mkdir()
        (old_skills / "old-skill").mkdir()
        (old_skills / "old-skill" / "SKILL.md").write_text("old")

        _migrate_workspace(workspace_src, dst)

        # Old skill gone, new one present
        assert not (dst / "skills" / "old-skill").exists()
        assert (dst / "skills" / "elevenlabs" / "SKILL.md").is_file()


# =============================================================================
# End-to-end: full YAML output
# =============================================================================

class TestEndToEndYamlGeneration:
    def test_yaml_round_trip(self, openclaw_json, workspace_src, tmp_path):
        """Build config from a real openclaw.json and verify valid YAML output."""
        from src.shared.migration.import_openclaw import (
            _build_nuvex_config,
            _parse_openclaw_config,
        )

        cfg = _parse_openclaw_config(openclaw_json)
        nuvex_cfg = _build_nuvex_config(cfg, "maya", str(tmp_path / "workspace"))
        yaml_text = yaml.dump(nuvex_cfg, default_flow_style=False, allow_unicode=True)

        # Must round-trip cleanly
        reloaded = yaml.safe_load(yaml_text)
        assert reloaded["agents"]["maya"]["name"] == "maya"
        assert "routing" in reloaded["agents"]["maya"]
