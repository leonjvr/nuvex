"""Unit tests for §4 Plugin Registry DB models."""
from __future__ import annotations

import uuid
from unittest.mock import MagicMock, patch


class TestPluginRegistryModel:
    """4.1 — PluginRegistry SQLAlchemy model."""

    def test_model_has_expected_columns(self):
        from src.brain.models.plugin_registry import PluginRegistry

        cols = {c.name for c in PluginRegistry.__table__.columns}
        assert "id" in cols
        assert "plugin_id" in cols
        assert "name" in cols
        assert "version" in cols
        assert "source" in cols
        assert "trust_tier" in cols
        assert "permissions" in cols
        assert "manifest_hash" in cols
        assert "installed_at" in cols

    def test_tablename(self):
        from src.brain.models.plugin_registry import PluginRegistry

        assert PluginRegistry.__tablename__ == "plugin_registry"

    def test_plugin_id_unique(self):
        from src.brain.models.plugin_registry import PluginRegistry

        col = PluginRegistry.__table__.c["plugin_id"]
        assert col.unique


class TestAgentPluginConfigModel:
    """4.2 — AgentPluginConfig SQLAlchemy model."""

    def test_model_has_expected_columns(self):
        from src.brain.models.plugin_config import AgentPluginConfig

        cols = {c.name for c in AgentPluginConfig.__table__.columns}
        assert "id" in cols
        assert "agent_id" in cols
        assert "plugin_id" in cols
        assert "plugin_type" in cols
        assert "enabled" in cols
        assert "env_encrypted" in cols
        assert "config_json" in cols
        assert "created_at" in cols
        assert "updated_at" in cols

    def test_tablename(self):
        from src.brain.models.plugin_config import AgentPluginConfig

        assert AgentPluginConfig.__tablename__ == "agent_plugin_config"

    def test_unique_constraint(self):
        from src.brain.models.plugin_config import AgentPluginConfig

        constraints = {
            c.name for c in AgentPluginConfig.__table__.constraints
        }
        assert "uq_agent_plugin" in constraints

    def test_separate_from_skill_config(self):
        """Ensure AgentPluginConfig and AgentSkillConfig are distinct models."""
        from src.brain.models.plugin_config import AgentPluginConfig
        from src.brain.models.skill_config import AgentSkillConfig

        assert AgentPluginConfig.__tablename__ != AgentSkillConfig.__tablename__
        assert AgentPluginConfig is not AgentSkillConfig


class TestModelsRegistered:
    """4.4 — Models imported in __init__.py."""

    def test_plugin_registry_in_init(self):
        from src.brain.models import PluginRegistry
        assert PluginRegistry is not None

    def test_agent_plugin_config_in_init(self):
        from src.brain.models import AgentPluginConfig
        assert AgentPluginConfig is not None
