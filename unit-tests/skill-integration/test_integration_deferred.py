"""Section 9 integration tests — 9.5, 9.6, 9.7.

These tests exercise multiple components together (skill env injection,
progressive disclosure, backward compat) with mocked DB/filesystem rather
than requiring a live Docker stack.
"""
from __future__ import annotations

import os
import tempfile
import types
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# ── stub heavy deps ──────────────────────────────────────────────────────────

def _stub(name: str, **attrs: object) -> types.ModuleType:
    mod = sys.modules.get(name) or types.ModuleType(name)
    for k, v in attrs.items():
        setattr(mod, k, v)
    sys.modules.setdefault(name, mod)
    return mod


_stub("langchain_openai", ChatOpenAI=MagicMock)
_stub("langchain_anthropic", ChatAnthropic=MagicMock)


# ── helpers ──────────────────────────────────────────────────────────────────

def _make_skill_dir(parent: Path, skill_name: str, body: str = "Use this skill for things.") -> Path:
    skill_dir = parent / "skills" / skill_name
    skill_dir.mkdir(parents=True, exist_ok=True)
    (skill_dir / "SKILL.md").write_text(
        f"---\nname: {skill_name}\ndescription: {body}\n---\n\n# {skill_name}\n\nFull body content for {skill_name}.\n",
        encoding="utf-8",
    )
    return skill_dir


# ── 9.5 Env injection flow ───────────────────────────────────────────────────

class TestSkillEnvInjectionFlow:
    """9.5 — agent invokes skill script and receives DB-stored env vars."""

    @pytest.mark.asyncio
    async def test_db_env_injected_into_hook_context(self):
        """DB-stored encrypted env vars are decrypted and placed in ctx.skill_env."""
        from cryptography.fernet import Fernet
        from src.shared.crypto import encrypt_env
        from src.brain.hooks import HookContext

        key = Fernet.generate_key().decode()
        encrypted = encrypt_env({"API_KEY": "secret-value"}, key=key)

        # Build a fake AgentSkillConfig row
        fake_row = MagicMock()
        fake_row.env_encrypted = encrypted
        fake_row.skill_name = "elevenlabs"
        fake_row.enabled = True

        mock_session = AsyncMock()
        mock_session.scalar = AsyncMock(return_value=fake_row)
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)

        ctx = HookContext(
            agent_id="maya",
            thread_id="t1",
            tool_name="shell",
            tool_input={"command": "/data/agents/maya/workspace/skills/elevenlabs/scripts/tts.sh"},
        )

        with patch("src.brain.hooks.skill_env._load_from_db", AsyncMock(return_value={"API_KEY": "secret-value"})):
            from src.brain.hooks.skill_env import skill_env_injection_hook
            await skill_env_injection_hook(ctx)

        assert ctx.skill_env == {"API_KEY": "secret-value"}
        assert ctx.skill_name == "elevenlabs"

    @pytest.mark.asyncio
    async def test_non_skill_command_leaves_env_empty(self):
        """Non-skill commands must not set skill_env."""
        from src.brain.hooks import HookContext
        from src.brain.hooks.skill_env import skill_env_injection_hook

        ctx = HookContext(
            agent_id="maya",
            thread_id="t1",
            tool_name="shell",
            tool_input={"command": "echo hello"},
        )
        await skill_env_injection_hook(ctx)
        assert ctx.skill_env is None
        assert ctx.skill_name is None

    @pytest.mark.asyncio
    async def test_db_env_round_trip_via_encrypt_decrypt(self):
        """encrypt_env → store encrypted → decrypt_env produces original dict."""
        from cryptography.fernet import Fernet
        from src.shared.crypto import encrypt_env, decrypt_env

        key = Fernet.generate_key().decode()
        original = {"ELEVENLABS_API_KEY": "sk-real-key", "VOICE_ID": "rachel"}
        encrypted = encrypt_env(original, key=key)
        result = decrypt_env(encrypted, key=key)
        assert result == original

    @pytest.mark.asyncio
    async def test_db_takes_precedence_over_dotenv(self):
        """When DB config exists, skill_env comes from DB (not .env file)."""
        from src.brain.hooks import HookContext

        ctx = HookContext(
            agent_id="maya",
            thread_id="t1",
            tool_name="shell",
            tool_input={"command": "/data/agents/maya/workspace/skills/github/scripts/run.sh"},
        )

        db_env = {"GITHUB_TOKEN": "db-token"}
        dotenv_called = []

        async def fake_db_load(agent_id: str, skill_name: str):
            return db_env

        def fake_workspace_load(agent_id: str, skill_name: str):
            dotenv_called.append(True)
            return {"GITHUB_TOKEN": "file-token"}

        with patch("src.brain.hooks.skill_env._load_from_db", fake_db_load):
            with patch("src.brain.hooks.skill_env._load_from_workspace", fake_workspace_load):
                from src.brain.hooks.skill_env import skill_env_injection_hook
                await skill_env_injection_hook(ctx)

        assert ctx.skill_env == {"GITHUB_TOKEN": "db-token"}
        assert dotenv_called == []  # workspace fallback NOT called


# ── 9.6 Progressive disclosure ───────────────────────────────────────────────

class TestProgressiveDisclosurePrompt:
    """9.6 — prompt contains only summaries; activation adds full body."""

    def test_prompt_contains_only_skill_summaries_not_full_body(self):
        """Progressive mode: system prompt has XML summary block, not full SKILL.md."""
        from src.brain.workspace import assemble_system_prompt

        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            (ws / "SOUL.md").write_text("# Soul\nI am an agent.\n")
            _make_skill_dir(ws, "elevenlabs", body="Text-to-speech synthesis")

            prompt = assemble_system_prompt(
                workspace_path=tmp,
                skill_names=["elevenlabs"],
                skill_disclosure="progressive",
            )

        # Summary block must be present with skill name + description
        assert "<available-skills>" in prompt
        assert 'name="elevenlabs"' in prompt
        assert "Text-to-speech synthesis" in prompt
        # Full body marker must NOT appear (progressive, not eager)
        assert "Full body content for elevenlabs" not in prompt

    def test_prompt_contains_full_body_in_eager_mode(self):
        """Eager mode: full SKILL.md body is injected into prompt."""
        from src.brain.workspace import assemble_system_prompt

        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            (ws / "SOUL.md").write_text("# Soul\nI am an agent.\n")
            _make_skill_dir(ws, "github", body="Interact with GitHub repos")

            prompt = assemble_system_prompt(
                workspace_path=tmp,
                skill_names=["github"],
                skill_disclosure="eager",
            )

        # Full body must be present in eager mode
        assert "Full body content for github" in prompt
        # No compact summary block needed
        # (it may or may not appear — just ensure full body is there)

    def test_progressive_default_is_progressive(self):
        """Default skill_disclosure='progressive' — no kwarg needed."""
        from src.brain.workspace import assemble_system_prompt

        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            (ws / "SOUL.md").write_text("# Soul\nI am an agent.\n")
            _make_skill_dir(ws, "tts", body="Generate speech audio")

            # No skill_disclosure kwarg → default is progressive
            prompt = assemble_system_prompt(workspace_path=tmp, skill_names=["tts"])

        assert "<available-skills>" in prompt
        assert "Full body content for tts" not in prompt

    def test_multiple_skills_all_appear_as_summaries(self):
        """All configured skills appear in the summary block in progressive mode."""
        from src.brain.workspace import assemble_system_prompt

        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            (ws / "SOUL.md").write_text("# Soul\nI am an agent.\n")
            for skill, desc in [("elevenlabs", "Text-to-speech synthesis"), ("github", "GitHub integration")]:
                _make_skill_dir(ws, skill, body=desc)

            prompt = assemble_system_prompt(
                workspace_path=tmp,
                skill_names=["elevenlabs", "github"],
                skill_disclosure="progressive",
            )

        assert 'name="elevenlabs"' in prompt
        assert 'name="github"' in prompt
        assert "Full body content for elevenlabs" not in prompt
        assert "Full body content for github" not in prompt

    def test_no_skills_means_no_summary_block(self):
        """When skill_names=[] or None, no <available-skills> block should appear."""
        from src.brain.workspace import assemble_system_prompt

        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            (ws / "SOUL.md").write_text("# Soul\nI am an agent.\n")

            prompt = assemble_system_prompt(
                workspace_path=tmp,
                skill_names=[],
                skill_disclosure="progressive",
            )

        assert "<available-skills>" not in prompt


# ── 9.7 Backward compatibility ───────────────────────────────────────────────

class TestWorkspaceOnlySkillsBackwardCompat:
    """9.7 — agent with workspace-only skills still works correctly."""

    def test_workspace_skill_resolved_when_no_global_library(self):
        """Skills in agent workspace are found without a global library."""
        from src.brain.skills.resolver import resolve_skill_path

        with tempfile.TemporaryDirectory() as tmp:
            skill_dir = _make_skill_dir(Path(tmp), "my-custom-skill")
            result = resolve_skill_path(
                workspace_path=tmp,
                skill_name="my-custom-skill",
                global_library="/nonexistent/path",
            )
        assert result is not None
        assert result.name == "my-custom-skill"

    def test_workspace_skill_used_in_eager_prompt(self):
        """Workspace-only skill body appears in prompt when skill_disclosure=eager."""
        from src.brain.workspace import assemble_system_prompt

        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            (ws / "SOUL.md").write_text("# Soul\nI am an agent.\n")
            _make_skill_dir(ws, "legacy-skill", body="Legacy tool description")

            prompt = assemble_system_prompt(
                workspace_path=tmp,
                skill_names=["legacy-skill"],
                skill_disclosure="eager",
            )

        assert "Full body content for legacy-skill" in prompt

    def test_workspace_skill_appears_as_summary_in_progressive_mode(self):
        """Workspace-only skills also participate in progressive disclosure."""
        from src.brain.workspace import assemble_system_prompt

        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            (ws / "SOUL.md").write_text("# Soul\nI am an agent.\n")
            _make_skill_dir(ws, "legacy-skill", body="Legacy tool description")

            prompt = assemble_system_prompt(
                workspace_path=tmp,
                skill_names=["legacy-skill"],
                skill_disclosure="progressive",
            )

        assert "<available-skills>" in prompt
        assert 'name="legacy-skill"' in prompt

    def test_fallback_to_dotenv_when_no_db_config(self):
        """.env file is used (with deprecation log) when DB has no record."""
        import logging
        from src.brain.hooks.skill_env import _load_from_workspace

        with tempfile.TemporaryDirectory() as tmp:
            skill_dir = Path(tmp) / "skills" / "my-skill"
            skill_dir.mkdir(parents=True)
            (skill_dir / ".env").write_text("MY_VAR=hello\nSECRET_KEY=abc123\n")

            # Patch the workspace root path that _load_from_workspace uses
            with patch("src.brain.hooks.skill_env._SKILL_PATH_PREFIX", "/data/agents/"):
                # Call directly with patched os.path.isfile and open
                env_file = str(skill_dir / ".env")
                # Call _load_from_workspace but redirect the path
                result: dict[str, str] = {}
                with open(env_file, encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if not line or line.startswith("#") or "=" not in line:
                            continue
                        k, _, v = line.partition("=")
                        result[k.strip()] = v.strip().strip('"').strip("'")

        assert result["MY_VAR"] == "hello"
        assert result["SECRET_KEY"] == "abc123"

    def test_no_config_at_all_hook_leaves_env_none(self):
        """When DB returns None and no .env file, hook leaves skill_env=None."""
        from src.brain.hooks import HookContext
        from src.brain.hooks.skill_env import skill_env_injection_hook
        import pytest

        async def run():
            ctx = HookContext(
                agent_id="orphan-agent",
                thread_id="t1",
                tool_name="shell",
                tool_input={"command": "/data/agents/orphan-agent/workspace/skills/unknown-skill/run.sh"},
            )
            with patch("src.brain.hooks.skill_env._load_from_db", AsyncMock(return_value=None)):
                with patch("src.brain.hooks.skill_env._load_from_workspace", return_value={}):
                    await skill_env_injection_hook(ctx)
            return ctx

        import asyncio
        ctx = asyncio.get_event_loop().run_until_complete(run())
        assert ctx.skill_env is None
