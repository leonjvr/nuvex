"""Unit tests — workspace: system prompt assembly, file loading, trimming."""
from __future__ import annotations

import tempfile
from pathlib import Path

import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


# ---------------------------------------------------------------------------
# load_workspace_files
# ---------------------------------------------------------------------------

class TestLoadWorkspaceFiles:
    def test_returns_present_files(self):
        from src.brain.workspace import load_workspace_files

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write(root / "SOUL.md", "soul")
            _write(root / "TOOLS.md", "tools")

            result = load_workspace_files(tmp)

        assert result["SOUL.md"] == "soul"
        assert result["TOOLS.md"] == "tools"

    def test_omits_missing_files(self):
        from src.brain.workspace import load_workspace_files

        with tempfile.TemporaryDirectory() as tmp:
            result = load_workspace_files(tmp)

        assert result == {}

    def test_all_known_bootstrap_files_loaded(self):
        from src.brain.workspace import load_workspace_files, _BOOTSTRAP_FILES

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for f in _BOOTSTRAP_FILES:
                _write(root / f, f"content of {f}")

            result = load_workspace_files(tmp)

        assert set(result.keys()) == set(_BOOTSTRAP_FILES)


# ---------------------------------------------------------------------------
# load_skill_files
# ---------------------------------------------------------------------------

class TestLoadSkillFiles:
    def test_finds_skill_md_in_subdirs(self):
        from src.brain.workspace import load_skill_files

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write(root / "skills" / "email" / "SKILL.md", "email skill")
            _write(root / "skills" / "shell" / "SKILL.md", "shell skill")

            result = load_skill_files(tmp)

        assert set(result.keys()) == {"email", "shell"}
        assert result["email"] == "email skill"

    def test_returns_empty_if_no_skills_dir(self):
        from src.brain.workspace import load_skill_files

        with tempfile.TemporaryDirectory() as tmp:
            result = load_skill_files(tmp)

        assert result == {}

    def test_ignores_dirs_without_skill_md(self):
        from src.brain.workspace import load_skill_files

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "skills" / "empty-skill").mkdir(parents=True)

            result = load_skill_files(tmp)

        assert result == {}


# ---------------------------------------------------------------------------
# consume_bootstrap_md
# ---------------------------------------------------------------------------

class TestConsumeBootstrapMd:
    def test_returns_content_and_deletes_file(self):
        from src.brain.workspace import consume_bootstrap_md

        with tempfile.TemporaryDirectory() as tmp:
            bootstrap = Path(tmp) / "BOOTSTRAP.md"
            bootstrap.write_text("first run instructions", encoding="utf-8")

            content = consume_bootstrap_md(tmp)

            assert content == "first run instructions"
            assert not bootstrap.exists()

    def test_returns_none_when_file_absent(self):
        from src.brain.workspace import consume_bootstrap_md

        with tempfile.TemporaryDirectory() as tmp:
            result = consume_bootstrap_md(tmp)

        assert result is None


# ---------------------------------------------------------------------------
# assemble_system_prompt
# ---------------------------------------------------------------------------

class TestAssembleSystemPrompt:
    def test_includes_governance_preamble(self):
        from src.brain.workspace import assemble_system_prompt, GOVERNANCE_PREAMBLE

        with tempfile.TemporaryDirectory() as tmp:
            prompt = assemble_system_prompt(tmp)

        assert GOVERNANCE_PREAMBLE.strip()[:30] in prompt

    def test_includes_soul_md(self):
        from src.brain.workspace import assemble_system_prompt

        with tempfile.TemporaryDirectory() as tmp:
            _write(Path(tmp) / "SOUL.md", "I am an agent.")
            prompt = assemble_system_prompt(tmp)

        assert "I am an agent." in prompt

    def test_soul_md_never_trimmed(self):
        """SOUL.md must appear even when tokens are extremely tight."""
        from src.brain.workspace import assemble_system_prompt

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write(root / "SOUL.md", "core identity")
            # Fill with lots of content to force trimming
            _write(root / "AGENTS.md", "A" * 100_000)
            _write(root / "TOOLS.md", "T" * 100_000)

            prompt = assemble_system_prompt(tmp, max_tokens=500)

        assert "core identity" in prompt

    def test_bootstrap_md_consumed_on_first_run(self):
        from src.brain.workspace import assemble_system_prompt

        with tempfile.TemporaryDirectory() as tmp:
            bootstrap = Path(tmp) / "BOOTSTRAP.md"
            bootstrap.write_text("onboarding steps", encoding="utf-8")

            prompt = assemble_system_prompt(tmp, is_first_run=True)

            assert "onboarding steps" in prompt
            assert not bootstrap.exists()

    def test_skills_included_in_prompt(self):
        from src.brain.workspace import assemble_system_prompt

        with tempfile.TemporaryDirectory() as tmp:
            _write(Path(tmp) / "skills" / "voice" / "SKILL.md", "voice skill content")
            prompt = assemble_system_prompt(tmp)

        assert "voice skill content" in prompt

    def test_empty_workspace_returns_preamble_only(self):
        from src.brain.workspace import assemble_system_prompt, GOVERNANCE_PREAMBLE

        with tempfile.TemporaryDirectory() as tmp:
            prompt = assemble_system_prompt(tmp)

        # Should still have preamble
        assert len(prompt) > 0
        assert "governed AI agent" in prompt


# ---------------------------------------------------------------------------
# _count_tokens
# ---------------------------------------------------------------------------

class TestCountTokens:
    def test_returns_integer(self):
        from src.brain.workspace import _count_tokens

        result = _count_tokens("Hello world, this is a test sentence.")
        assert isinstance(result, int)
        assert result > 0

    def test_empty_string_returns_zero(self):
        from src.brain.workspace import _count_tokens

        assert _count_tokens("") == 0

    def test_longer_text_has_more_tokens(self):
        from src.brain.workspace import _count_tokens

        short = _count_tokens("hi")
        long = _count_tokens("hi " * 1000)
        assert long > short
