"""Unit tests for Section 1 — AgentSkillConfig database schema."""
from __future__ import annotations

import uuid

import pytest


class TestAgentSkillConfigModel:
    """1.1 — AgentSkillConfig SQLAlchemy model."""

    def test_model_imports(self):
        from src.brain.models.skill_config import AgentSkillConfig
        assert AgentSkillConfig.__tablename__ == "agent_skill_config"

    def test_model_has_required_columns(self):
        from src.brain.models.skill_config import AgentSkillConfig
        from sqlalchemy import inspect
        mapper = inspect(AgentSkillConfig)
        col_names = {c.key for c in mapper.mapper.column_attrs}
        assert "id" in col_names
        assert "agent_id" in col_names
        assert "skill_name" in col_names
        assert "enabled" in col_names
        assert "env_encrypted" in col_names
        assert "config_json" in col_names
        assert "created_at" in col_names
        assert "updated_at" in col_names

    def test_model_unique_constraint(self):
        from src.brain.models.skill_config import AgentSkillConfig
        constraints = {c.name for c in AgentSkillConfig.__table__.constraints}
        assert "uq_agent_skill" in constraints

    def test_model_registered_in_init(self):
        from src.brain.models import AgentSkillConfig
        assert AgentSkillConfig.__tablename__ == "agent_skill_config"

    def test_migration_file_exists(self):
        from pathlib import Path
        mig = Path("src/brain/migrations/versions/0013_add_agent_skill_config.py")
        assert mig.is_file(), "Migration 0013 must exist"

    def test_migration_revision_chain(self):
        from pathlib import Path
        import importlib.util
        mig = Path("src/brain/migrations/versions/0013_add_agent_skill_config.py")
        spec = importlib.util.spec_from_file_location("mig0013", mig)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        assert mod.revision == "0013"
        assert mod.down_revision == "0012"

    def test_approval_model_registered(self):
        from src.brain.models import PendingApproval
        assert PendingApproval.__tablename__ == "pending_approvals"
