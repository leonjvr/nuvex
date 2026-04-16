"""Unit tests for §8 Config Loader Update — skills → plugins expansion."""
from __future__ import annotations

import pytest


class TestSkillsToPluginsExpansion:
    """18.10 — skills: shorthand, plugins: override, conflict resolution."""

    def test_skills_list_expanded_to_plugins(self):
        from src.shared.config import _parse_agent

        agent = _parse_agent({
            "name": "maya",
            "skills": ["elevenlabs", "google-search"],
        })
        assert "elevenlabs" in agent.plugins
        assert "google-search" in agent.plugins
        assert agent.plugins["elevenlabs"].enabled is True

    def test_plugins_key_takes_precedence_over_skills(self):
        from src.shared.config import _parse_agent

        agent = _parse_agent({
            "name": "maya",
            "skills": ["elevenlabs"],
            "plugins": {"elevenlabs": {"enabled": False, "config": {"voice": "Bella"}}},
        })
        # plugins: key wins
        assert agent.plugins["elevenlabs"].enabled is False
        assert agent.plugins["elevenlabs"].config == {"voice": "Bella"}

    def test_plugins_merge_with_skills_expansion(self):
        from src.shared.config import _parse_agent

        agent = _parse_agent({
            "name": "maya",
            "skills": ["elevenlabs", "google-search"],
            "plugins": {"custom-plugin": {"enabled": True}},
        })
        # Both skills AND explicit plugins present
        assert "elevenlabs" in agent.plugins
        assert "google-search" in agent.plugins
        assert "custom-plugin" in agent.plugins

    def test_no_skills_no_plugins_empty_dict(self):
        from src.shared.config import _parse_agent

        agent = _parse_agent({"name": "maya"})
        assert agent.plugins == {}

    def test_plugin_agent_config_fields(self):
        from src.shared.models.config import PluginAgentConfig

        cfg = PluginAgentConfig(enabled=True, config={"key": "val"})
        assert cfg.enabled is True
        assert cfg.config["key"] == "val"

    def test_plugin_agent_config_defaults(self):
        from src.shared.models.config import PluginAgentConfig

        cfg = PluginAgentConfig()
        assert cfg.enabled is True
        assert cfg.config == {}

    def test_agent_definition_has_plugins_field(self):
        from src.shared.models.config import AgentDefinition

        agent = AgentDefinition(name="test")
        assert hasattr(agent, "plugins")
        assert isinstance(agent.plugins, dict)
