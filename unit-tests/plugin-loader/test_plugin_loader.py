"""Unit tests for §3 Plugin Loader."""
from __future__ import annotations

import pytest
from pathlib import Path
from unittest.mock import MagicMock, patch


def _reset_loader():
    from src.brain.plugin_loader import _loaded_plugins
    _loaded_plugins.clear()


class TestEntryPointDiscovery:
    """18.4 — Entry point discovery."""

    @pytest.mark.asyncio
    async def test_entry_point_plugin_loaded(self, tmp_path):
        _reset_loader()
        from src.nuvex_plugin import define_plugin, PluginAPI

        @define_plugin(id="ep-plugin", name="EP Plugin")
        def register(api: PluginAPI) -> None:
            pass

        mock_ep = MagicMock()
        mock_ep.name = "ep-plugin"
        mock_ep.load.return_value = register

        with patch(
            "src.brain.plugins.loader._load_from_entry_points",
        ) as mock_load:
            def _side():
                from src.brain.plugin_loader import _load_plugin_fn
                _load_plugin_fn(register, source="entry_point:ep-plugin")
            mock_load.side_effect = _side

            await _side_effect_load(tmp_path)

        from src.brain.plugin_loader import _loaded_plugins
        assert "ep-plugin" in _loaded_plugins

    @pytest.mark.asyncio
    async def test_directory_scan_loads_plugin(self, tmp_path):
        """Plugin dir with plugin.py is discovered."""
        _reset_loader()
        from src.nuvex_plugin import define_plugin, PluginAPI

        plugin_dir = tmp_path / "my-plugin"
        plugin_dir.mkdir()

        plugin_code = '''
from src.nuvex_plugin import define_plugin, PluginAPI

@define_plugin(id="dir-plugin", name="Dir Plugin")
def register(api: PluginAPI) -> None:
    pass
'''
        (plugin_dir / "plugin.py").write_text(plugin_code)

        from src.brain.plugin_loader import _load_from_directory, _loaded_plugins
        _loaded_plugins.clear()
        _load_from_directory(tmp_path)
        assert "dir-plugin" in _loaded_plugins

    @pytest.mark.asyncio
    async def test_duplicate_id_first_wins(self, tmp_path):
        """Second plugin with same id is skipped."""
        _reset_loader()
        from src.nuvex_plugin import define_plugin, PluginAPI
        from src.brain.plugin_loader import _load_plugin_fn, _loaded_plugins

        @define_plugin(id="dup-plugin", name="First")
        def first(api): pass

        @define_plugin(id="dup-plugin", name="Second")
        def second(api): pass

        _load_plugin_fn(first, source="test")
        _load_plugin_fn(second, source="test")

        assert _loaded_plugins["dup-plugin"]["meta"]["name"] == "First"

    @pytest.mark.asyncio
    async def test_exception_in_registration_skipped(self, tmp_path):
        """Plugin that raises during registration is skipped, others still load."""
        _reset_loader()
        from src.nuvex_plugin import define_plugin, PluginAPI
        from src.brain.plugin_loader import _load_plugin_fn, _loaded_plugins

        @define_plugin(id="bad-plugin", name="Bad Plugin")
        def bad_register(api):
            raise RuntimeError("oops")

        @define_plugin(id="good-plugin", name="Good Plugin")
        def good_register(api): pass

        _load_plugin_fn(bad_register, source="test")
        _load_plugin_fn(good_register, source="test")

        assert "bad-plugin" not in _loaded_plugins
        assert "good-plugin" in _loaded_plugins

    @pytest.mark.asyncio
    async def test_skill_directory_auto_wrapped(self, tmp_path):
        """Skill directory with SKILL.md but no plugin.py gets auto-wrapped."""
        _reset_loader()
        skills_dir = tmp_path / "skills"
        skills_dir.mkdir()
        skill_dir = skills_dir / "my-skill"
        skill_dir.mkdir()
        (skill_dir / "SKILL.md").write_text("# My Skill\nA test skill.")

        from src.brain.plugin_loader import _load_from_skills, _loaded_plugins
        _loaded_plugins.clear()
        _load_from_skills(skills_dir, prefix="skill")

        assert "skill:my-skill" in _loaded_plugins

    @pytest.mark.asyncio
    async def test_skill_with_plugin_py_not_double_wrapped(self, tmp_path):
        """Skill directory with SKILL.md AND plugin.py is skipped by skill auto-wrap."""
        _reset_loader()
        skills_dir = tmp_path / "skills"
        skills_dir.mkdir()
        skill_dir = skills_dir / "my-skill"
        skill_dir.mkdir()
        (skill_dir / "SKILL.md").write_text("# My Skill")
        (skill_dir / "plugin.py").write_text("")  # has plugin.py, skip auto-wrap

        from src.brain.plugin_loader import _load_from_skills, _loaded_plugins
        _loaded_plugins.clear()
        _load_from_skills(skills_dir, prefix="skill")

        assert "skill:my-skill" not in _loaded_plugins


async def _side_effect_load(tmp_path):
    from src.brain.plugin_loader import load_plugins
    await load_plugins(
        plugins_dir=tmp_path / "plugins",
        skills_dir=tmp_path / "skills",
    )


class TestBaseToolGeneration:
    """3.9 — BaseTool generation from register_tool() registrations."""

    def test_tool_generated_from_registration(self):
        _reset_loader()
        from pydantic import BaseModel
        from src.nuvex_plugin import define_plugin, PluginAPI
        from src.brain.plugin_loader import _load_plugin_fn, get_tools_for_plugin

        class MyInput(BaseModel):
            query: str

        async def execute(ctx, args):
            return f"result:{args.query}"

        @define_plugin(id="tool-plugin", name="Tool Plugin")
        def register(api: PluginAPI) -> None:
            api.register_tool("my-tool", "Does stuff", MyInput, execute)

        _load_plugin_fn(register, source="test")
        tools = get_tools_for_plugin("tool-plugin")
        assert len(tools) == 1
        assert tools[0].name == "my-tool"
        assert tools[0].description == "Does stuff"
