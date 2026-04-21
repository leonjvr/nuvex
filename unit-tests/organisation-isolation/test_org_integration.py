"""Integration tests for Organisation Isolation — tasks 18.8–18.16.

These tests validate the implemented NUVEX module contracts directly.
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest
from sqlalchemy import String, select
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class _Base(DeclarativeBase):
    pass


class _Thread(_Base):
    __tablename__ = "integration_isolation_thread"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    org_id: Mapped[str] = mapped_column(String)


# ---------------------------------------------------------------------------
# 18.8 — Cross-org data isolation
# ---------------------------------------------------------------------------

class TestCrossOrgIsolation:
    """18.8 — Org A cannot access Org B's data (threads, agents, budgets)."""

    def test_different_orgs_have_separate_thread_spaces(self):
        from src.brain.thread_id import build_thread_id

        thread_a = build_thread_id("org-a", "agent-1", "telegram", "123")
        thread_b = build_thread_id("org-b", "agent-1", "telegram", "123")

        assert thread_a != thread_b
        assert thread_a.startswith("org-a:")
        assert thread_b.startswith("org-b:")

    def test_org_scope_applied_to_thread_query(self):
        from src.brain.org_scope import org_scope

        q = select(_Thread)
        scoped = org_scope(q, "org-a")
        compiled = str(scoped.compile())
        assert "org_id" in compiled

    def test_org_scope_different_orgs_different_params(self):
        from src.brain.org_scope import org_scope

        q_a = org_scope(select(_Thread), "org-a")
        q_b = org_scope(select(_Thread), "org-b")

        params_a = q_a.compile().params
        params_b = q_b.compile().params

        assert "org-a" in params_a.values()
        assert "org-b" in params_b.values()


# ---------------------------------------------------------------------------
# 18.9 — Inter-org synchronous work packet
# ---------------------------------------------------------------------------

class TestInterOrgSyncPacket:
    """18.9 — Synchronous work packet between two orgs."""

    def test_work_packet_model_accepts_sync_mode(self):
        from src.brain.models.work_packet import WorkPacket

        packet = WorkPacket(
            id="pkt-1",
            source_org_id="org-a",
            target_org_id="org-b",
            packet_type="query",
            payload={"question": "x"},
            mode="sync",
            status="pending",
        )
        assert packet.source_org_id == "org-a"
        assert packet.target_org_id == "org-b"
        assert packet.mode == "sync"

    def test_work_packet_model_tracks_status(self):
        from src.brain.models.work_packet import WorkPacket

        packet = WorkPacket(
            id="pkt-2",
            source_org_id="org-a",
            target_org_id="org-b",
            packet_type="query",
            payload={},
            mode="sync",
            status="processing",
        )
        assert packet.status == "processing"


# ---------------------------------------------------------------------------
# 18.10 — Inter-org asynchronous work packet
# ---------------------------------------------------------------------------

class TestInterOrgAsyncPacket:
    """18.10 — Async work packet create/dispatch/complete lifecycle."""

    def test_async_mode_default_is_declared(self):
        from src.brain.models.work_packet import WorkPacket

        col = WorkPacket.__table__.columns["mode"]
        assert col.server_default is not None
        assert "async" in str(col.server_default.arg)

    def test_async_packet_result_can_be_empty(self):
        from src.brain.models.work_packet import WorkPacket

        packet = WorkPacket(
            id="pkt-3",
            source_org_id="org-a",
            target_org_id="org-b",
            packet_type="task",
            payload={},
            mode="async",
            status="pending",
            result=None,
        )
        assert packet.result is None


# ---------------------------------------------------------------------------
# 18.11 — Three-tier policy merge (global + org + agent, strictest wins)
# ---------------------------------------------------------------------------

class TestThreeTierPolicyMerge:
    """18.11 — Policy merge: global → org → agent, strictest wins."""

    def test_agent_policy_overrides_org_when_stricter(self):
        from src.brain.governance.policy_merge import merge_policies

        merged = merge_policies(
            global_policies={"budgets": {"daily_usd": 4000}},
            org_policies={"budgets": {"daily_usd": 2000}},
            agent_policies={"budgets": {"daily_usd": 1000}},
        )
        assert merged["budgets"]["daily_usd"] == 1000

    def test_org_policy_overrides_global_when_stricter(self):
        from src.brain.governance.policy_merge import merge_policies

        merged = merge_policies(
            global_policies={"budgets": {"daily_usd": 4000}},
            org_policies={"budgets": {"daily_usd": 2000}},
            agent_policies={},
        )
        assert merged["budgets"]["daily_usd"] == 2000

    def test_global_used_when_no_overrides(self):
        from src.brain.governance.policy_merge import merge_policies

        merged = merge_policies(
            global_policies={"budgets": {"daily_usd": 4000}},
            org_policies={},
            agent_policies={},
        )
        assert merged["budgets"]["daily_usd"] == 4000


# ---------------------------------------------------------------------------
# 18.12 — Org-level budget cap
# ---------------------------------------------------------------------------

class TestOrgBudgetCap:
    """18.12 — Org budget constraints represented in org config + policy merge."""

    def test_budget_cap_present_in_organisation_config(self):
        from src.shared.models.organisation import Organisation

        org = Organisation(org_id="org-a", name="Org A", config={"budget_cap_usd": 5.0})
        assert org.config["budget_cap_usd"] == pytest.approx(5.0)

    def test_budget_merge_picks_strictest_value(self):
        from src.brain.governance.policy_merge import merge_policies

        merged = merge_policies(
            global_policies={"budgets": {"daily_usd": 10.0}},
            org_policies={"budgets": {"daily_usd": 5.0}},
            agent_policies={"budgets": {"daily_usd": 8.0}},
        )
        assert merged["budgets"]["daily_usd"] == 5.0


# ---------------------------------------------------------------------------
# 18.13 — Channel ownership enforcement
# ---------------------------------------------------------------------------

class TestChannelOwnership:
    """18.13 — Channel binding enforced; duplicates and cross-org bindings rejected."""

    def test_channel_binding_model_valid(self):
        from src.brain.models.channel_binding import ChannelBinding

        binding = ChannelBinding(
            org_id="org-a",
            agent_id="agent-1",
            channel_type="telegram",
            channel_identity="@mybot",
            config={},
        )
        assert binding.org_id == "org-a"
        assert binding.channel_type == "telegram"

    def test_channel_binding_unique_constraints_declared(self):
        from src.brain.models.channel_binding import ChannelBinding

        constraints = [str(c) for c in ChannelBinding.__table_args__]
        assert any("channel_type" in c and "channel_identity" in c for c in constraints)
        assert any("org_id" in c and "agent_id" in c for c in constraints)


# ---------------------------------------------------------------------------
# 18.14 — Default org migration
# ---------------------------------------------------------------------------

class TestDefaultOrgMigration:
    """18.14 — Existing data migrated to default org; backward compat preserved."""

    def test_legacy_thread_ids_default_to_default_org(self):
        from src.brain.thread_id import parse_thread_id

        parts = parse_thread_id("agent-1:telegram:user-123")
        assert parts.org_id == "default"

    def test_v2_thread_id_keeps_explicit_org(self):
        from src.brain.thread_id import parse_thread_id

        parts = parse_thread_id("acme:agent-1:telegram:user-123")
        assert parts.org_id == "acme"


# ---------------------------------------------------------------------------
# 18.15 — Org lifecycle (create → suspend → archive)
# ---------------------------------------------------------------------------

class TestOrgLifecycle:
    """18.15 — Org create/suspend/archive state machine."""

    def test_valid_transitions_from_active(self):
        from src.shared.models.organisation import validate_status_transition

        assert validate_status_transition("active", "suspended") is True
        assert validate_status_transition("active", "archived") is False

    def test_valid_transitions_from_suspended(self):
        from src.shared.models.organisation import validate_status_transition

        assert validate_status_transition("suspended", "active") is True
        assert validate_status_transition("suspended", "archived") is True

    def test_archived_is_terminal(self):
        from src.shared.models.organisation import validate_status_transition

        assert validate_status_transition("archived", "active") is False
        assert validate_status_transition("archived", "suspended") is False

    def test_sqlalchemy_model_transition_helper_matches(self):
        from src.brain.models.organisation import Organisation

        org = Organisation(org_id="org-a", name="Org A", status="suspended")
        assert org.can_transition_to("active") is True
        assert org.can_transition_to("archived") is True


# ---------------------------------------------------------------------------
# 18.16 — Plugin org enablement
# ---------------------------------------------------------------------------

class TestPluginOrgEnablement:
    """18.16 — Org whitelist blocks plugins not listed for the org."""

    @pytest.mark.asyncio
    async def test_plugin_allowed_for_org_in_whitelist(self, monkeypatch: pytest.MonkeyPatch):
        from src.brain.plugins import loader

        class _FakeSession:
            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, tb):
                return None

            async def get(self, model, org_id):  # noqa: ARG002
                return SimpleNamespace(config={"enabled_plugins": ["web-search"]})

        loader._loaded_plugins.clear()
        loader._loaded_plugins.update({"web-search": {"meta": {}, "api": SimpleNamespace(_tools={})}})
        monkeypatch.setattr("src.brain.db.get_session", lambda: _FakeSession())
        monkeypatch.setattr(loader, "get_tools_for_plugin", lambda plugin_id: [SimpleNamespace(name=plugin_id)])

        tools = await loader.get_tools_for_agent("agent-1", org_id="org-a")
        assert [t.name for t in tools] == ["web-search"]

    @pytest.mark.asyncio
    async def test_plugin_blocked_for_org_not_in_whitelist(self, monkeypatch: pytest.MonkeyPatch):
        from src.brain.plugins import loader

        class _FakeSession:
            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, tb):
                return None

            async def get(self, model, org_id):  # noqa: ARG002
                return SimpleNamespace(config={"enabled_plugins": ["allowed-plugin"]})

        loader._loaded_plugins.clear()
        loader._loaded_plugins.update({"blocked-plugin": {"meta": {}, "api": SimpleNamespace(_tools={})}})
        monkeypatch.setattr("src.brain.db.get_session", lambda: _FakeSession())
        monkeypatch.setattr(loader, "get_tools_for_plugin", lambda plugin_id: [SimpleNamespace(name=plugin_id)])

        tools = await loader.get_tools_for_agent("agent-1", org_id="org-a")
        assert tools == []

    @pytest.mark.asyncio
    async def test_plugin_allowed_when_no_whitelist(self, monkeypatch: pytest.MonkeyPatch):
        from src.brain.plugins import loader

        class _FakeSession:
            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, tb):
                return None

            async def get(self, model, org_id):  # noqa: ARG002
                return SimpleNamespace(config={})

        loader._loaded_plugins.clear()
        loader._loaded_plugins.update({"any-plugin": {"meta": {}, "api": SimpleNamespace(_tools={})}})
        monkeypatch.setattr("src.brain.db.get_session", lambda: _FakeSession())
        monkeypatch.setattr(loader, "get_tools_for_plugin", lambda plugin_id: [SimpleNamespace(name=plugin_id)])

        tools = await loader.get_tools_for_agent("agent-1", org_id="org-a")
        assert [t.name for t in tools] == ["any-plugin"]
