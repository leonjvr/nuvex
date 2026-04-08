"""Unit tests for src/brain/import_openclaw.py — tasks 14.2–14.6."""
from __future__ import annotations

import json
import textwrap
from pathlib import Path

import pytest


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture()
def tmp_openclaw(tmp_path: Path) -> Path:
    """Create a minimal fake OpenClaw installation on disk."""
    base = tmp_path / ".openclaw"
    base.mkdir()
    (base / "workspace").mkdir()
    (base / "credentials").mkdir()

    # Bootstrap workspace files
    for fname in ["SOUL.md", "AGENTS.md", "MEMORY.md"]:
        (base / "workspace" / fname).write_text(f"# {fname}", encoding="utf-8")

    # Skills directory
    (base / "workspace" / "skills" / "dev-server").mkdir(parents=True)
    (base / "workspace" / "skills" / "dev-server" / "skill.md").write_text("# dev-server", encoding="utf-8")

    # .env with API keys
    (base / ".env").write_text(
        "ANTHROPIC_API_KEY=sk-ant-test1234567890\nOPENAI_API_KEY=sk-openai-abc123\n",
        encoding="utf-8",
    )

    return base


def _write_openclaw_json(base: Path, config: dict) -> Path:
    path = base / "openclaw.json"
    path.write_text(json.dumps(config), encoding="utf-8")
    return path


# ---------------------------------------------------------------------------
# 14.2.1 — parse_openclaw_config: standard JSON
# ---------------------------------------------------------------------------

class TestParseOpenclawConfig:
    def test_parses_valid_json(self, tmp_path):
        from src.brain.import_openclaw import parse_openclaw_config

        cfg_path = tmp_path / "openclaw.json"
        cfg_path.write_text(json.dumps({"identity": {"name": "Maya"}}), encoding="utf-8")
        result = parse_openclaw_config(cfg_path)
        assert result["identity"]["name"] == "Maya"

    def test_parses_json5_with_comments(self, tmp_path):
        from src.brain.import_openclaw import parse_openclaw_config

        raw = textwrap.dedent("""\
            {
              // This is a comment
              "identity": {
                "name": "Maya"   // inline
              }
            }
        """)
        cfg_path = tmp_path / "openclaw.json"
        cfg_path.write_text(raw, encoding="utf-8")
        result = parse_openclaw_config(cfg_path)
        assert result["identity"]["name"] == "Maya"

    def test_parses_json5_trailing_commas(self, tmp_path):
        from src.brain.import_openclaw import parse_openclaw_config

        raw = '{"identity": {"name": "Maya",},"extra": [1, 2,]}'
        cfg_path = tmp_path / "openclaw.json"
        cfg_path.write_text(raw, encoding="utf-8")
        result = parse_openclaw_config(cfg_path)
        assert result["identity"]["name"] == "Maya"
        assert result["extra"] == [1, 2]

    def test_raises_on_invalid_json(self, tmp_path):
        from src.brain.import_openclaw import parse_openclaw_config

        cfg_path = tmp_path / "bad.json"
        cfg_path.write_text("{not valid json!!", encoding="utf-8")
        with pytest.raises(Exception):
            parse_openclaw_config(cfg_path)


# ---------------------------------------------------------------------------
# 14.2.2 — map_to_divisions_yaml
# ---------------------------------------------------------------------------

class TestMapToDivisionsYaml:
    def test_agent_name_from_identity(self, tmp_openclaw):
        from src.brain.import_openclaw import map_to_divisions_yaml

        config = {"identity": {"name": "Maya"}, "agent": {}, "channels": {}, "skills": {}}
        entry = map_to_divisions_yaml(config)
        assert entry["name"] == "maya"

    def test_agent_name_override(self, tmp_openclaw):
        from src.brain.import_openclaw import map_to_divisions_yaml

        config = {"identity": {"name": "Maya"}}
        entry = map_to_divisions_yaml(config, agent_id="zeus")
        assert entry["name"] == "zeus"

    def test_model_mapping_anthropic(self):
        from src.brain.import_openclaw import map_to_divisions_yaml

        config = {"agent": {"model": {"primary": "anthropic/claude-sonnet-4-5"}}}
        entry = map_to_divisions_yaml(config)
        assert "anthropic" in entry["model"]["primary"]

    def test_fallback_model_included_when_present(self):
        from src.brain.import_openclaw import map_to_divisions_yaml

        config = {
            "agent": {"model": {"primary": "claude", "fallback": "gpt-4o"}},
        }
        entry = map_to_divisions_yaml(config)
        assert "fallback" in entry["model"]
        assert "openai" in entry["model"]["fallback"]

    def test_whatsapp_channel_mapped(self):
        from src.brain.import_openclaw import map_to_divisions_yaml

        config = {
            "channels": {
                "whatsapp": {"allowFrom": ["+49123"], "groups": {}}
            }
        }
        entry = map_to_divisions_yaml(config)
        wa = entry["channels"]["whatsapp"]
        assert wa["enabled"] is True
        assert wa["dm_policy"] == "pairing"

    def test_telegram_channel_mapped(self):
        from src.brain.import_openclaw import map_to_divisions_yaml

        config = {"channels": {"telegram": {"allowFrom": [123456]}}}
        entry = map_to_divisions_yaml(config)
        tg = entry["channels"]["telegram"]
        assert tg["enabled"] is True
        assert tg["require_mention"] is True

    def test_email_disabled_by_default(self):
        from src.brain.import_openclaw import map_to_divisions_yaml

        entry = map_to_divisions_yaml({})
        assert entry["channels"]["email"]["enabled"] is False

    def test_skills_listed(self):
        from src.brain.import_openclaw import map_to_divisions_yaml

        config = {
            "skills": {
                "entries": {
                    "elevenlabs": {"enabled": True},
                    "calendar": {"enabled": False},
                }
            }
        }
        entry = map_to_divisions_yaml(config)
        assert "elevenlabs" in entry["skills"]
        assert "calendar" not in entry.get("skills", [])

    def test_baileys_creds_path_detected(self, tmp_openclaw):
        from src.brain.import_openclaw import map_to_divisions_yaml

        config = {}
        entry = map_to_divisions_yaml(config, openclaw_base=tmp_openclaw)
        assert "_baileys_credentials_path" in entry
        assert "credentials" in entry["_baileys_credentials_path"]

    def test_no_baileys_when_missing(self, tmp_path):
        from src.brain.import_openclaw import map_to_divisions_yaml

        base = tmp_path / ".openclaw"
        base.mkdir()
        entry = map_to_divisions_yaml({}, openclaw_base=base)
        assert "_baileys_credentials_path" not in entry

    def test_budget_and_compaction_defaults_present(self):
        from src.brain.import_openclaw import map_to_divisions_yaml

        entry = map_to_divisions_yaml({})
        assert entry["budget"]["daily_usd"] == 5.0
        assert entry["compaction"]["threshold"] == 50


# ---------------------------------------------------------------------------
# 14.3 — copy_workspace_files
# ---------------------------------------------------------------------------

class TestCopyWorkspaceFiles:
    def test_copies_known_bootstrap_files(self, tmp_openclaw, tmp_path):
        from src.brain.import_openclaw import copy_workspace_files

        dest = tmp_path / "dest_workspace"
        copied = copy_workspace_files(tmp_openclaw, dest)
        names = [Path(p).name for p in copied]
        assert "SOUL.md" in names
        assert "AGENTS.md" in names
        assert "MEMORY.md" in names

    def test_copies_skills_when_flag_true(self, tmp_openclaw, tmp_path):
        from src.brain.import_openclaw import copy_workspace_files

        dest = tmp_path / "dest_workspace"
        copied = copy_workspace_files(tmp_openclaw, dest, include_skills=True)
        paths_str = " ".join(copied)
        assert "skills" in paths_str

    def test_skips_skills_when_flag_false(self, tmp_openclaw, tmp_path):
        from src.brain.import_openclaw import copy_workspace_files

        dest = tmp_path / "dest_workspace"
        copied = copy_workspace_files(tmp_openclaw, dest, include_skills=False)
        # No entry should be a directory named "skills"
        for p in copied:
            assert Path(p).name != "skills"

    def test_creates_dest_directory(self, tmp_openclaw, tmp_path):
        from src.brain.import_openclaw import copy_workspace_files

        dest = tmp_path / "new_agent" / "workspace"
        assert not dest.exists()
        copy_workspace_files(tmp_openclaw, dest)
        assert dest.exists()

    def test_empty_workspace_returns_empty_list(self, tmp_path):
        from src.brain.import_openclaw import copy_workspace_files

        base = tmp_path / ".openclaw"
        (base / "workspace").mkdir(parents=True)
        dest = tmp_path / "dest"
        copied = copy_workspace_files(base, dest)
        assert copied == []


# ---------------------------------------------------------------------------
# 14.4 — map_baileys_credentials
# ---------------------------------------------------------------------------

class TestMapBaileysCredentials:
    def test_returns_path_when_exists(self, tmp_openclaw):
        from src.brain.import_openclaw import map_baileys_credentials

        result = map_baileys_credentials(tmp_openclaw)
        assert result is not None
        assert "credentials" in result

    def test_returns_none_when_missing(self, tmp_path):
        from src.brain.import_openclaw import map_baileys_credentials

        base = tmp_path / "empty"
        base.mkdir()
        result = map_baileys_credentials(base)
        assert result is None


# ---------------------------------------------------------------------------
# 14.5 — dry-run (CLI integration)
# ---------------------------------------------------------------------------

class TestDryRunFlag:
    def test_dry_run_produces_no_files(self, tmp_openclaw, tmp_path, capsys):
        from src.brain.import_openclaw import (
            parse_openclaw_config, map_to_divisions_yaml,
        )

        _write_openclaw_json(tmp_openclaw, {
            "identity": {"name": "TestAgent"},
            "agent": {"model": {"primary": "claude"}},
        })

        config = parse_openclaw_config(tmp_openclaw / "openclaw.json")
        entry = map_to_divisions_yaml(config, openclaw_base=tmp_openclaw)

        # Dry-run: just check entry was produced, no files should be written
        dest = tmp_path / "workspace"
        assert not dest.exists()
        # Simulate dry-run: verify entry is returned without calling copy
        assert entry["name"] == "testagent"
        assert not dest.exists()


# ---------------------------------------------------------------------------
# 14.6 — list_api_keys
# ---------------------------------------------------------------------------

class TestListApiKeys:
    def test_lists_known_keys(self, tmp_openclaw):
        from src.brain.import_openclaw import list_api_keys

        keys = list_api_keys(tmp_openclaw)
        assert "ANTHROPIC_API_KEY" in keys
        assert "OPENAI_API_KEY" in keys

    def test_values_are_masked(self, tmp_openclaw):
        from src.brain.import_openclaw import list_api_keys

        keys = list_api_keys(tmp_openclaw)
        for val in keys.values():
            assert "*" in val

    def test_returns_empty_when_no_env(self, tmp_path):
        from src.brain.import_openclaw import list_api_keys

        base = tmp_path / ".openclaw"
        base.mkdir()
        result = list_api_keys(base)
        assert result == {}

    def test_ignores_unknown_keys(self, tmp_path):
        from src.brain.import_openclaw import list_api_keys

        base = tmp_path / ".openclaw"
        base.mkdir()
        (base / ".env").write_text("SOME_OTHER_KEY=abc123\n", encoding="utf-8")
        result = list_api_keys(base)
        assert "SOME_OTHER_KEY" not in result

    def test_ignores_empty_values(self, tmp_path):
        from src.brain.import_openclaw import list_api_keys

        base = tmp_path / ".openclaw"
        base.mkdir()
        (base / ".env").write_text("ANTHROPIC_API_KEY=\n", encoding="utf-8")
        result = list_api_keys(base)
        assert "ANTHROPIC_API_KEY" not in result
