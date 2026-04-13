"""Unit tests — system agents enforcement (identity spec §7.1–7.3)."""
from __future__ import annotations

import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

from src.brain.routers.agents import router, AgentUpdateBody
from fastapi import FastAPI

# ---------------------------------------------------------------------------
# Test app setup
# ---------------------------------------------------------------------------

app = FastAPI()
app.include_router(router)
client = TestClient(app)


def _make_agent(system: bool = False):
    agent = MagicMock()
    agent.system = system
    agent.name = "gatekeeper" if system else "research"
    agent.tier = "T3"
    return agent


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestSystemAgentProtection:
    @patch("src.brain.routers.agents.get_cached_config")
    def test_delete_system_agent_returns_403(self, mock_cfg):
        """§7.3 — DELETE on system agent → 403."""
        mock_cfg.return_value.agents = {"gatekeeper": _make_agent(system=True)}
        resp = client.delete("/agents/gatekeeper")
        assert resp.status_code == 403

    @patch("src.brain.routers.agents.get_cached_config")
    def test_delete_normal_agent_returns_204(self, mock_cfg):
        """§7.3 — DELETE on non-system agent → 204."""
        mock_cfg.return_value.agents = {"research": _make_agent(system=False)}
        resp = client.delete("/agents/research")
        assert resp.status_code == 204

    @patch("src.brain.routers.agents.get_cached_config")
    def test_suspend_system_agent_returns_403(self, mock_cfg):
        """§7.3 — PATCH lifecycle_state=suspended on system agent → 403."""
        mock_cfg.return_value.agents = {"gatekeeper": _make_agent(system=True)}
        resp = client.patch(
            "/agents/gatekeeper",
            json={"lifecycle_state": "suspended"},
        )
        assert resp.status_code == 403

    @patch("src.brain.routers.agents.get_cached_config")
    def test_suspend_normal_agent_succeeds(self, mock_cfg):
        """§7.3 — PATCH lifecycle_state=suspended on non-system agent → 200."""
        mock_cfg.return_value.agents = {"research": _make_agent(system=False)}
        resp = client.patch(
            "/agents/research",
            json={"lifecycle_state": "suspended"},
        )
        assert resp.status_code == 200

    @patch("src.brain.routers.agents.get_cached_config")
    def test_empty_tool_list_on_system_agent_returns_403(self, mock_cfg):
        """§7.3 — PATCH with tools=[] on system agent → 403."""
        mock_cfg.return_value.agents = {"gatekeeper": _make_agent(system=True)}
        resp = client.patch(
            "/agents/gatekeeper",
            json={"tools": []},
        )
        assert resp.status_code == 403

    @patch("src.brain.routers.agents.get_cached_config")
    def test_unknown_agent_returns_404(self, mock_cfg):
        """§7.3 — agent not found → 404."""
        mock_cfg.return_value.agents = {}
        resp = client.delete("/agents/unknown-agent")
        assert resp.status_code == 404
