"""Unit tests for Section 3 — skill library & resolution."""
from __future__ import annotations

import os
from pathlib import Path

import pytest


@pytest.fixture
def tmp_workspace(tmp_path):
    """Create a temporary workspace with some skills."""
    ws_skills = tmp_path / "workspace" / "skills"
    ws_skills.mkdir(parents=True)
    # workspace skill: ws-skill
    (ws_skills / "ws-skill").mkdir()
    (ws_skills / "ws-skill" / "SKILL.md").write_text(
        "---\nname: ws-skill\ndescription: workspace skill\n---\n",
        encoding="utf-8",
    )
    return tmp_path / "workspace"


@pytest.fixture
def tmp_global(tmp_path):
    """Create a temporary global library with some skills."""
    lib = tmp_path / "global-lib"
    lib.mkdir()
    (lib / "global-skill").mkdir()
    (lib / "global-skill" / "SKILL.md").write_text(
        "---\nname: global-skill\ndescription: global library skill\n---\n",
        encoding="utf-8",
    )
    # Also add a ws-skill to global to test precedence
    (lib / "ws-skill").mkdir()
    (lib / "ws-skill" / "SKILL.md").write_text(
        "---\nname: ws-skill\ndescription: global version — should lose to workspace\n---\n",
        encoding="utf-8",
    )
    return lib


class TestResolveSkillPath:
    """3.2 — resolve_skill_path precedence."""

    def test_workspace_takes_precedence(self, tmp_workspace, tmp_global):
        from src.brain.skills.resolver import resolve_skill_path
        result = resolve_skill_path(str(tmp_workspace), "ws-skill", str(tmp_global))
        assert result is not None
        assert str(result).startswith(str(tmp_workspace))

    def test_falls_back_to_global(self, tmp_workspace, tmp_global):
        from src.brain.skills.resolver import resolve_skill_path
        result = resolve_skill_path(str(tmp_workspace), "global-skill", str(tmp_global))
        assert result is not None
        assert str(result).startswith(str(tmp_global))

    def test_missing_skill_returns_none(self, tmp_workspace, tmp_global):
        from src.brain.skills.resolver import resolve_skill_path
        result = resolve_skill_path(str(tmp_workspace), "nonexistent", str(tmp_global))
        assert result is None

    def test_returns_path_object(self, tmp_workspace, tmp_global):
        from src.brain.skills.resolver import resolve_skill_path
        result = resolve_skill_path(str(tmp_workspace), "ws-skill", str(tmp_global))
        assert isinstance(result, Path)


class TestParseSkillMd:
    """3.3 — parse_skill_md frontmatter extraction."""

    def _write_skill(self, tmp_path, content):
        p = tmp_path / "SKILL.md"
        p.write_text(content, encoding="utf-8")
        return p

    def test_valid_frontmatter(self, tmp_path):
        from src.brain.skills.parser import parse_skill_md
        p = self._write_skill(tmp_path, "---\nname: my-skill\ndescription: does things\nlicense: MIT\n---\n\nBody here.\n")
        meta = parse_skill_md(p)
        assert meta.name == "my-skill"
        assert meta.description == "does things"
        assert meta.license == "MIT"
        assert "Body here." in meta.body

    def test_missing_frontmatter_gives_empty_meta(self, tmp_path):
        from src.brain.skills.parser import parse_skill_md
        p = self._write_skill(tmp_path, "# Just markdown\n\nNo YAML here.\n")
        meta = parse_skill_md(p)
        assert meta.name == ""
        assert meta.description == ""
        assert "Just markdown" in meta.body

    def test_openclaw_metadata(self, tmp_path):
        from src.brain.skills.parser import parse_skill_md
        content = (
            "---\n"
            "name: test\n"
            "openclaw:\n"
            "  requires:\n"
            "    bins: [git, node]\n"
            "    env: [GITHUB_TOKEN]\n"
            "---\n"
            "Body.\n"
        )
        p = self._write_skill(tmp_path, content)
        meta = parse_skill_md(p)
        assert meta.openclaw.requires.bins == ["git", "node"]
        assert meta.openclaw.requires.env == ["GITHUB_TOKEN"]

    def test_compatibility_list(self, tmp_path):
        from src.brain.skills.parser import parse_skill_md
        content = "---\nname: x\ncompatibility:\n  - nuvex-1.0\n  - sidjua-2.0\n---\n"
        p = self._write_skill(tmp_path, content)
        meta = parse_skill_md(p)
        assert "nuvex-1.0" in meta.compatibility


class TestCheckSkillEligible:
    """3.4 — check_skill_eligible gating."""

    def _make_meta(self, bins=None, env=None):
        from src.brain.skills.parser import SkillMetadata, OpenClawMetadata, OpenClawRequires
        return SkillMetadata(
            name="test",
            openclaw=OpenClawMetadata(
                requires=OpenClawRequires(bins=bins or [], env=env or [])
            ),
        )

    def test_no_requirements_eligible(self):
        from src.brain.skills.gating import check_skill_eligible
        meta = self._make_meta()
        eligible, reason = check_skill_eligible(meta)
        assert eligible is True
        assert reason is None

    def test_missing_binary_blocks(self):
        from src.brain.skills.gating import check_skill_eligible
        meta = self._make_meta(bins=["definitely_not_on_path_xyzzy"])
        eligible, reason = check_skill_eligible(meta)
        assert eligible is False
        assert "definitely_not_on_path_xyzzy" in reason

    def test_present_binary_allowed(self):
        from src.brain.skills.gating import check_skill_eligible
        # "python" or "python3" should always be available in test env
        import shutil
        bin_name = "python" if shutil.which("python") else "python3"
        meta = self._make_meta(bins=[bin_name])
        eligible, _ = check_skill_eligible(meta)
        assert eligible is True

    def test_missing_env_blocks(self, monkeypatch):
        from src.brain.skills.gating import check_skill_eligible
        monkeypatch.delenv("REQUIRED_VAR_XYZ", raising=False)
        meta = self._make_meta(env=["REQUIRED_VAR_XYZ"])
        eligible, reason = check_skill_eligible(meta)
        assert eligible is False
        assert "REQUIRED_VAR_XYZ" in reason

    def test_present_env_allowed(self, monkeypatch):
        from src.brain.skills.gating import check_skill_eligible
        monkeypatch.setenv("MY_TEST_VAR", "value")
        meta = self._make_meta(env=["MY_TEST_VAR"])
        eligible, _ = check_skill_eligible(meta)
        assert eligible is True


class TestParseEnvExample:
    """3.5 — parse_env_example and parse_config_schema."""

    def test_basic_parsing(self, tmp_path):
        from src.brain.skills.schema_parser import parse_env_example
        env_file = tmp_path / ".env.example"
        env_file.write_text("# @required\n# @secret\nAPI_KEY=\nDB_HOST=localhost\n", encoding="utf-8")
        fields = parse_env_example(env_file)
        assert len(fields) == 2
        api_key = fields[0]
        assert api_key.name == "API_KEY"
        assert api_key.required is True
        assert api_key.secret is True
        db_host = fields[1]
        assert db_host.name == "DB_HOST"
        assert db_host.required is False

    def test_description_tag(self, tmp_path):
        from src.brain.skills.schema_parser import parse_env_example
        env_file = tmp_path / ".env.example"
        env_file.write_text("# @description The API token\nTOKEN=\n", encoding="utf-8")
        fields = parse_env_example(env_file)
        assert fields[0].description == "The API token"

    def test_no_comments(self, tmp_path):
        from src.brain.skills.schema_parser import parse_env_example
        env_file = tmp_path / ".env.example"
        env_file.write_text("FOO=bar\nBAR=baz\n", encoding="utf-8")
        fields = parse_env_example(env_file)
        assert len(fields) == 2
        assert fields[0].name == "FOO"

    def test_empty_file(self, tmp_path):
        from src.brain.skills.schema_parser import parse_env_example
        env_file = tmp_path / ".env.example"
        env_file.write_text("", encoding="utf-8")
        fields = parse_env_example(env_file)
        assert fields == []

    def test_config_schema_json(self, tmp_path):
        from src.brain.skills.schema_parser import parse_config_schema
        import json
        schema_file = tmp_path / "config.schema.json"
        schema_file.write_text(json.dumps({
            "properties": {
                "API_KEY": {"type": "string", "description": "The key", "x-secret": True},
                "OPTIONAL_VAR": {"type": "string"},
            },
            "required": ["API_KEY"],
        }), encoding="utf-8")
        fields = parse_config_schema(schema_file)
        api_key = next(f for f in fields if f.name == "API_KEY")
        assert api_key.required is True
        assert api_key.secret is True
        opt_var = next(f for f in fields if f.name == "OPTIONAL_VAR")
        assert opt_var.required is False
