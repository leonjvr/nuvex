"""Unit tests for output style overlays (§30)."""
from __future__ import annotations

import os
import tempfile
import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock


class TestResolveStyle:
    def test_inline_style_returned_as_is(self):
        from src.brain.workspace import _resolve_style
        inline = "Be concise.\nUse bullet points."
        result = _resolve_style(inline, "/some/workspace", "agent-1")
        assert result == inline

    def test_named_style_loads_from_defaults(self):
        from src.brain.workspace import _resolve_style
        # defaults/styles/concise.md exists in the repo root
        result = _resolve_style("concise", ".", "agent-1")
        # Should return file contents (not None, not the name itself)
        assert result is not None
        assert len(result) > 0

    def test_named_style_loads_from_agent_workspace(self):
        from src.brain.workspace import _resolve_style
        with tempfile.TemporaryDirectory() as tmp:
            style_dir = Path(tmp) / "styles"
            style_dir.mkdir(parents=True)
            style_file = style_dir / "custom.md"
            style_file.write_text("Custom style instructions.")
            result = _resolve_style("custom", tmp, "agent-x")
        assert result == "Custom style instructions."

    def test_missing_style_returns_none(self):
        from src.brain.workspace import _resolve_style
        import logging
        with tempfile.TemporaryDirectory() as tmp:
            result = _resolve_style("nonexistent_style_xyz", tmp, "agent-1")
        assert result is None


class TestStyleInjectionInPrompt:
    def test_style_injected_when_set(self):
        from src.brain.workspace import assemble_system_prompt
        with tempfile.TemporaryDirectory() as tmp:
            style_dir = Path(tmp) / "styles"
            style_dir.mkdir(parents=True)
            (style_dir / "tight.md").write_text("Reply in 10 words max.")
            result = assemble_system_prompt(
                tmp,
                response_style="tight",
                agent_id="any-agent",
            )
        assert "Reply in 10 words max." in result

    def test_no_style_block_when_no_style(self):
        from src.brain.workspace import assemble_system_prompt
        with tempfile.TemporaryDirectory() as tmp:
            result = assemble_system_prompt(tmp)
        assert "## Response Style" not in result

    def test_style_block_header_present(self):
        from src.brain.workspace import assemble_system_prompt
        with tempfile.TemporaryDirectory() as tmp:
            style_dir = Path(tmp) / "styles"
            style_dir.mkdir(parents=True)
            (style_dir / "verbose.md").write_text("Give full explanations.")
            result = assemble_system_prompt(
                tmp,
                response_style="verbose",
                agent_id="agent-2",
            )
        assert "## Response Style" in result
