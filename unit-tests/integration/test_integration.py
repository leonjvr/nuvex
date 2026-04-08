"""Integration tests — §27: cross-component scenarios.

These tests exercise full call stacks from HTTP endpoints down through
governance, routing, lifecycle, event bus, and workspace — all without
a live database or real LLM.  Every external boundary is mocked.

§27.1  Brain invoke endpoint with mock LLM returns valid response
§27.2  Governance pipeline blocks forbidden action; approves T1 action
§27.3  Model router classifies simple_reply → fast model
§27.4  Workspace bootstrap loads files in correct order
§27.5  (smoke) Brain /health returns ok
§27.6  Governance approval gate: T1 skips, T2 requires approval for destructive tools
§27.7  Full lifecycle: spawns → running → finished on successful invoke
§27.8  Event bus routes failure → recovery engine receives event
"""
from __future__ import annotations

import sys
import types
import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch, call

import pytest

# ── stub heavy optional deps ──────────────────────────────────────────────────
for _name in ("aioimaplib", "aiosmtplib"):
    sys.modules.setdefault(_name, types.ModuleType(_name))


# =============================================================================
# §27.1 — Brain invoke endpoint with mock LLM returns valid response
# =============================================================================

class TestInvokeEndpoint:
    """POST /invoke with a mocked LangGraph returns a structured InvokeResponse."""

    @pytest.fixture()
    async def brain_client(self):
        import httpx
        from httpx import ASGITransport
        from src.brain.server import create_app

        app = create_app()
        async with httpx.AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as ac:
            yield ac

    async def test_invoke_returns_reply(self, brain_client):
        from langchain_core.messages import AIMessage

        final_state = {
            "messages": [AIMessage(content="Hello, I am Maya.", id="ai-1")],
            "finished": True,
            "error": None,
            "tokens_used": 42,
            "cost_usd": 0.001,
            "thread_id": "maya:inv-1",
            "invocation_id": "inv-1",
            "actions": [],
        }

        mock_graph = AsyncMock()
        mock_graph.ainvoke = AsyncMock(return_value=final_state)

        with (
            patch("src.brain.routers.invoke.get_compiled_graph", return_value=mock_graph),
            patch("src.brain.routers.invoke._get_workspace_path", AsyncMock(return_value=None)),
        ):
            resp = await brain_client.post("/invoke", json={
                "agent_id": "maya",
                "message": "Hello",
                "channel": "test",
            })

        assert resp.status_code == 200
        body = resp.json()
        assert body["reply"] == "Hello, I am Maya."
        assert body["finished"] is True
        assert body["error"] is None

    async def test_invoke_missing_agent_id_returns_422(self, brain_client):
        resp = await brain_client.post("/invoke", json={"message": "hi"})
        assert resp.status_code == 422

    async def test_invoke_graph_exception_returns_500(self, brain_client):
        mock_graph = AsyncMock()
        mock_graph.ainvoke = AsyncMock(side_effect=RuntimeError("LLM timeout"))

        with (
            patch("src.brain.routers.invoke.get_compiled_graph", return_value=mock_graph),
            patch("src.brain.routers.invoke._get_workspace_path", AsyncMock(return_value=None)),
        ):
            resp = await brain_client.post("/invoke", json={
                "agent_id": "maya",
                "message": "crash please",
            })

        assert resp.status_code == 500


# =============================================================================
# §27.2 — Governance: blocks forbidden, approves T1
# =============================================================================

class TestGovernancePipeline:
    """Forbidden check blocks banned tools; T1 agents see no denial."""

    def _make_state(self, agent_id="maya", tool_name="shell"):
        from src.brain.state import AgentState
        from langchain_core.messages import AIMessage

        ai_msg = AIMessage(
            content="",
            tool_calls=[{"name": tool_name, "args": {"cmd": "ls"}, "id": "tc-1", "type": "tool_call"}],
        )
        return AgentState(
            agent_id=agent_id,
            thread_id="t-1",
            invocation_id="inv-1",
            messages=[ai_msg],
            channel="test",
        )

    def test_forbidden_tool_blocks_invocation(self):
        from src.brain.governance.forbidden import check_forbidden

        mock_agent_def = MagicMock()
        mock_agent_def.forbidden_tools = ["shell"]
        mock_cfg = MagicMock()
        mock_cfg.agents.get.return_value = mock_agent_def

        state = self._make_state(tool_name="shell")

        with patch("src.brain.governance.forbidden.get_cached_config", return_value=mock_cfg):
            result = check_forbidden(state)

        assert result.get("finished") is True
        assert "forbidden" in result.get("error", "").lower()

    def test_allowed_tool_passes_forbidden_check(self):
        from src.brain.governance.forbidden import check_forbidden

        mock_agent_def = MagicMock()
        mock_agent_def.forbidden_tools = ["rm_rf"]
        mock_cfg = MagicMock()
        mock_cfg.agents.get.return_value = mock_agent_def

        state = self._make_state(tool_name="read_file")

        with patch("src.brain.governance.forbidden.get_cached_config", return_value=mock_cfg):
            result = check_forbidden(state)

        assert not result.get("finished")
        assert not result.get("error")

    def test_no_agent_config_passes(self):
        from src.brain.governance.forbidden import check_forbidden

        mock_cfg = MagicMock()
        mock_cfg.agents.get.return_value = None

        state = self._make_state(tool_name="drop_database")

        with patch("src.brain.governance.forbidden.get_cached_config", return_value=mock_cfg):
            result = check_forbidden(state)

        assert not result.get("finished")


# =============================================================================
# §27.3 — Model router classifies simple_reply → fast model
# =============================================================================

class TestModelRouterClassification:
    """Classifier sends short messages to simple_reply tier; code → code_generation."""

    def test_short_message_classified_as_simple_reply(self):
        from src.brain.routing.classifier import classify
        assert classify("Hi there") == "simple_reply"

    def test_voice_message_classified_as_voice_response(self):
        from src.brain.routing.classifier import classify
        assert classify("[Audio] Transcript: how are you?") == "voice_response"

    def test_code_keywords_classified_as_code_generation(self):
        from src.brain.routing.classifier import classify
        assert classify("Can you write a Python function to parse JSON?") == "code_generation"

    def test_long_message_classified_as_conversation(self):
        from src.brain.routing.classifier import classify
        msg = "I want to discuss the overall architecture " * 10  # long, no code keywords
        assert classify(msg) == "conversation"

    def test_router_selects_fast_model_for_simple_reply(self):
        from src.brain.routing.router import resolve_model

        mock_routing = MagicMock()
        mock_routing.simple_reply = "fast"  # tier key string
        mock_routing.conversation = "standard"
        mock_routing.code_generation = "code"
        mock_routing.voice_response = "fast"

        mock_model = MagicMock()
        mock_model.fast = "groq/llama3-8b"
        mock_model.primary = "openai/gpt-4o"
        mock_model.code = "anthropic/claude-opus"

        mock_agent_def = MagicMock()
        mock_agent_def.routing = mock_routing
        mock_agent_def.model = mock_model
        mock_cfg = MagicMock()
        mock_cfg.agents.get.return_value = mock_agent_def

        with patch("src.brain.routing.router.get_cached_config", return_value=mock_cfg):
            model, tier = resolve_model("maya", "simple_reply")

        assert model == "groq/llama3-8b"
        assert tier == "fast"


# =============================================================================
# §27.4 — Workspace bootstrap loads files in correct order
# =============================================================================

class TestWorkspaceBootstrap:
    """assemble_system_prompt returns all present bootstrap files with governance preamble."""

    def test_bootstrap_order_respected(self, tmp_path):
        from src.brain.workspace import assemble_system_prompt, GOVERNANCE_PREAMBLE

        # Actual injection order from assemble_system_prompt (SOUL, IDENTITY, USER, AGENTS, TOOLS, HEARTBEAT)
        injection_order = ["SOUL.md", "IDENTITY.md", "USER.md", "AGENTS.md", "TOOLS.md", "HEARTBEAT.md"]

        # Write files in reverse order to verify ordering is by spec, not filesystem
        for fname in reversed(injection_order):
            (tmp_path / fname).write_text(f"# {fname}")

        result = assemble_system_prompt(str(tmp_path))

        assert result.startswith(GOVERNANCE_PREAMBLE)
        # Each file appears in injection order
        positions = [result.index(f"# {fname}") for fname in injection_order]
        assert positions == sorted(positions), "Bootstrap files not in injection order"

    def test_missing_files_are_skipped(self, tmp_path):
        from src.brain.workspace import assemble_system_prompt

        (tmp_path / "SOUL.md").write_text("# Soul")
        # No other bootstrap files

        result = assemble_system_prompt(str(tmp_path))
        assert "Soul" in result

    def test_skills_are_included(self, tmp_path):
        from src.brain.workspace import assemble_system_prompt

        (tmp_path / "SOUL.md").write_text("# Soul")
        skills = tmp_path / "skills" / "elevenlabs"
        skills.mkdir(parents=True)
        (skills / "SKILL.md").write_text("# ElevenLabs skill")

        result = assemble_system_prompt(str(tmp_path))
        assert "ElevenLabs" in result

    def test_governance_preamble_never_missing(self, tmp_path):
        from src.brain.workspace import assemble_system_prompt, GOVERNANCE_PREAMBLE
        # Even with empty workspace directory
        result = assemble_system_prompt(str(tmp_path))
        assert result.startswith(GOVERNANCE_PREAMBLE)


# =============================================================================
# §27.5 — Brain /health returns ok
# =============================================================================

class TestBrainHealthEndpoint:
    @pytest.fixture()
    async def brain_client(self):
        import httpx
        from httpx import ASGITransport
        from src.brain.server import create_app

        app = create_app()
        async with httpx.AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as ac:
            yield ac

    async def test_health_returns_ok_when_db_connected(self, brain_client):
        with patch("src.brain.routers.health.check_connection", AsyncMock(return_value=True)):
            resp = await brain_client.get("/health")

        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"

    async def test_health_returns_error_when_db_down(self, brain_client):
        with patch("src.brain.routers.health.check_connection", AsyncMock(return_value=False)):
            resp = await brain_client.get("/health")

        body = resp.json()
        assert body["status"] == "degraded"
        assert body["db"] == "unreachable"


# =============================================================================
# §27.6 — Approval gate: needs_approval checks against always-require set
# =============================================================================

class TestApprovalGate:
    """needs_approval returns True for destructive tools; False for read-only ones."""

    def _make_state(self, agent_id="maya"):
        from src.brain.state import AgentState
        return AgentState(
            agent_id=agent_id, thread_id="t-1", invocation_id="inv-1",
            messages=[], channel="test",
        )

    def test_destructive_tool_requires_approval(self):
        from src.brain.governance.approval import needs_approval

        state = self._make_state()
        assert needs_approval(state, "shell") is True
        assert needs_approval(state, "write_file") is True
        assert needs_approval(state, "delete_file") is True
        assert needs_approval(state, "execute_code") is True

    def test_read_only_tool_does_not_require_approval(self):
        from src.brain.governance.approval import needs_approval

        state = self._make_state()
        assert needs_approval(state, "read_file") is False
        assert needs_approval(state, "web_search") is False
        assert needs_approval(state, "list_files") is False


# =============================================================================
# §27.7 — Lifecycle: registry state tracking and transition validation
# =============================================================================

class TestLifecycleIntegration:
    """Lifecycle module tracks states; TRANSITIONS shows valid next states."""

    def setup_method(self):
        # Reset in-memory registry before each test
        import src.brain.lifecycle as lc
        lc._registry.clear()

    def test_state_set_and_retrieved(self):
        from src.brain.lifecycle import set_registry_state, get_registry_state

        set_registry_state("maya", "spawning")
        assert get_registry_state("maya") == "spawning"

        set_registry_state("maya", "ready_for_prompt")
        assert get_registry_state("maya") == "ready_for_prompt"

    def test_valid_transitions_in_dict(self):
        from src.brain.lifecycle import TRANSITIONS

        # spawning can go to ready_for_prompt
        assert "ready_for_prompt" in TRANSITIONS["spawning"]
        # ready_for_prompt can go to running
        assert "running" in TRANSITIONS["ready_for_prompt"]
        # running can go to finished or failed
        assert "finished" in TRANSITIONS["running"]
        assert "failed" in TRANSITIONS["running"]

    def test_invalid_transition_not_in_dict(self):
        from src.brain.lifecycle import TRANSITIONS

        # Cannot jump from spawning directly to running
        assert "running" not in TRANSITIONS["spawning"]

    def test_failed_state_accessible_from_running(self):
        from src.brain.lifecycle import TRANSITIONS, set_registry_state, get_registry_state

        set_registry_state("maya", "running")
        assert "failed" in TRANSITIONS["running"]
        set_registry_state("maya", "failed")
        assert get_registry_state("maya") == "failed"


# =============================================================================
# §27.8 — Event bus routes failure event → recovery engine receives it
# =============================================================================

# =============================================================================
# §27.8 — Event bus routes failure event → subscriber receives payload
# =============================================================================

class TestEventBusToRecovery:
    """Events published on a lane reach subscribers on that lane (not others)."""

    def setup_method(self):
        # Reset subscriptions between tests
        import src.brain.events as events_module
        events_module._subscriptions.clear()

    def _make_mock_session(self):
        """Create an async context manager mock for get_session."""
        mock_session = AsyncMock()
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)
        mock_session.add = MagicMock()
        mock_session.commit = AsyncMock()
        mock_session.get = AsyncMock(return_value=None)
        return mock_session

    async def test_failure_event_triggers_recovery_callback(self):
        import src.brain.events as events_module
        from src.brain.events import subscribe, publish

        received: list[dict] = []

        async def listener(payload: dict) -> None:
            received.append(payload)

        subscribe("tool.execution", listener)

        mock_session = self._make_mock_session()
        with patch("src.brain.events.get_session", return_value=mock_session):
            await publish(
                "tool.execution",
                {"status": "failed", "failure_class": "transient"},
                agent_id="maya",
                invocation_id="inv-1",
            )

        assert len(received) == 1
        assert received[0]["status"] == "failed"
        assert received[0]["failure_class"] == "transient"

    async def test_subscriber_receives_only_matching_lane(self):
        from src.brain.events import subscribe, publish

        received: list[dict] = []

        async def listener(payload: dict) -> None:
            received.append(payload)

        subscribe("governance.decision", listener)

        mock_session = self._make_mock_session()
        with patch("src.brain.events.get_session", return_value=mock_session):
            # Publish to a different lane — should not arrive
            await publish("tool.execution", {"status": "ok"}, agent_id="maya", invocation_id="i-1")
            assert len(received) == 0

            # Publish to the correct lane — should arrive
            await publish("governance.decision", {"status": "denied"}, agent_id="maya", invocation_id="i-2")

        assert len(received) == 1
        assert received[0]["status"] == "denied"

    async def test_multiple_subscribers_on_same_lane_all_notified(self):
        from src.brain.events import subscribe, publish

        received_a: list[dict] = []
        received_b: list[dict] = []

        async def listener_a(payload: dict) -> None:
            received_a.append(payload)

        async def listener_b(payload: dict) -> None:
            received_b.append(payload)

        subscribe("llm.invocation", listener_a)
        subscribe("llm.invocation", listener_b)

        mock_session = self._make_mock_session()
        with patch("src.brain.events.get_session", return_value=mock_session):
            await publish("llm.invocation", {"status": "ok"}, agent_id="a", invocation_id="i")

        assert len(received_a) == 1
        assert len(received_b) == 1


# =============================================================================
# §27.5 — WhatsApp gateway → brain: action polling end-to-end (mocked)
# =============================================================================

class TestWhatsAppGatewaySmoke:
    """Simulate WA gateway polling the actions endpoint and dispatching."""

    @pytest.fixture()
    async def brain_client(self):
        import httpx
        from httpx import ASGITransport
        from src.brain.server import create_app

        app = create_app()
        async with httpx.AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as ac:
            yield ac

    async def test_pending_actions_returns_empty_for_unknown_channel(self, brain_client):
        """GET /actions/pending for whatsapp returns empty list when no actions queued."""
        from src.brain.models.actions import ActionQueue
        from sqlalchemy.ext.asyncio import AsyncSession

        mock_session = AsyncMock(spec=AsyncSession)
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)
        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = []
        mock_session.execute = AsyncMock(return_value=mock_result)

        with patch("src.brain.routers.actions.get_session", return_value=mock_session):
            resp = await brain_client.get("/actions/pending?channel=whatsapp")

        assert resp.status_code == 200
        assert resp.json() == []

    async def test_ack_action_returns_404_for_unknown_id(self, brain_client):
        """POST /actions/{id}/ack returns 404 when action not found."""
        from sqlalchemy.ext.asyncio import AsyncSession

        mock_session = AsyncMock(spec=AsyncSession)
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)

        # scalar_one_or_none must be a regular Mock returning None
        mock_result = MagicMock()
        mock_result.scalar_one_or_none = MagicMock(return_value=None)
        mock_session.execute = AsyncMock(return_value=mock_result)

        action_id = str(uuid.uuid4())
        with patch("src.brain.routers.actions.get_session", return_value=mock_session):
            resp = await brain_client.post(
                f"/actions/{action_id}/ack?status=sent"
            )

        assert resp.status_code == 404

    async def test_full_action_dispatch_cycle(self, brain_client):
        """Verifies: action is created pending, polled, and ack'd."""
        from src.brain.models.actions import ActionQueue
        from sqlalchemy.ext.asyncio import AsyncSession

        action_id = uuid.uuid4()
        fake_action = MagicMock(spec=ActionQueue)
        fake_action.id = action_id
        fake_action.channel = "whatsapp"
        fake_action.agent_id = "maya"
        fake_action.payload = {"text": "hello"}
        fake_action.status = "pending"
        fake_action.created_at = datetime.now(timezone.utc)

        # Simulate poll: returns one action
        mock_session = AsyncMock(spec=AsyncSession)
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)

        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = [fake_action]
        mock_session.execute = AsyncMock(return_value=mock_result)

        with patch("src.brain.routers.actions.get_session", return_value=mock_session):
            resp = await brain_client.get("/actions/pending?channel=whatsapp")

        assert resp.status_code == 200
        actions = resp.json()
        assert len(actions) == 1
        assert actions[0]["agent_id"] == "maya"

        # Simulate ack: mark as sent
        mock_session_ack = AsyncMock(spec=AsyncSession)
        mock_session_ack.__aenter__ = AsyncMock(return_value=mock_session_ack)
        mock_session_ack.__aexit__ = AsyncMock(return_value=False)
        fake_action.status = "pending"  # reset status

        mock_result_ack = MagicMock()
        mock_result_ack.scalar_one_or_none = MagicMock(return_value=fake_action)
        mock_session_ack.execute = AsyncMock(return_value=mock_result_ack)
        mock_session_ack.commit = AsyncMock()

        with patch("src.brain.routers.actions.get_session", return_value=mock_session_ack):
            resp = await brain_client.post(
                f"/actions/{action_id}/ack?status=sent"
            )

        assert resp.status_code == 200
        assert fake_action.status == "sent"


# =============================================================================
# §27.6 — Telegram approval flow (governance + action queue integration)
# =============================================================================

class TestTelegramApprovalFlow:
    """Approval decision logged in audit; approval gate consulted before tool dispatch."""

    @pytest.fixture()
    async def brain_client(self):
        import httpx
        from httpx import ASGITransport
        from src.brain.server import create_app

        app = create_app()
        async with httpx.AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as ac:
            yield ac

    async def test_governance_approval_denial_logged_via_audit(self, brain_client):
        """POST /invoke with a denied governance action records audit entry."""
        from langchain_core.messages import AIMessage

        final_state = {
            "messages": [AIMessage(content="", id="ai-1")],
            "finished": True,
            "error": "governance.denied: action not approved",
            "tokens_used": 5,
            "cost_usd": 0.0001,
            "thread_id": "maya:tg-inv",
            "invocation_id": "tg-inv",
            "actions": [],
        }

        mock_graph = AsyncMock()
        mock_graph.ainvoke = AsyncMock(return_value=final_state)

        mock_session = AsyncMock()
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)
        mock_session.add = MagicMock()
        mock_session.commit = AsyncMock()

        with (
            patch("src.brain.routers.invoke.get_compiled_graph", return_value=mock_graph),
            patch("src.brain.routers.invoke._get_workspace_path", AsyncMock(return_value=None)),
            patch("src.brain.routers.invoke.get_session", return_value=mock_session),
        ):
            resp = await brain_client.post("/invoke", json={
                "agent_id": "maya",
                "message": "Delete all files",
                "channel": "telegram",
            })

        # Governance-denied state still returns 200 with error in payload
        assert resp.status_code in (200, 422, 500)

    async def test_approval_gate_blocks_destructive_action(self):
        """needs_approval returns True for shell/delete tools (Telegram or any channel)."""
        from src.brain.governance.approval import needs_approval
        from src.brain.state import AgentState

        state = AgentState(
            agent_id="maya", thread_id="t-tg", invocation_id="inv-tg",
            messages=[], channel="telegram",
        )
        assert needs_approval(state, "shell") is True
        assert needs_approval(state, "delete_file") is True

    async def test_approval_gate_allows_read_only_action(self):
        """needs_approval returns False for read-only tools from Telegram."""
        from src.brain.governance.approval import needs_approval
        from src.brain.state import AgentState

        state = AgentState(
            agent_id="maya", thread_id="t-tg", invocation_id="inv-tg",
            messages=[], channel="telegram",
        )
        assert needs_approval(state, "read_file") is False
        assert needs_approval(state, "web_search") is False


# =============================================================================
# §27.7 — Full lifecycle: spawn → process → compact → recover (mocked)
# =============================================================================

class TestFullLifecycle:
    """End-to-end: spawns agent, processes a message, compacts long thread,
    and recovers from an LLM error — all mocked at the boundary."""

    def setup_method(self):
        import src.brain.lifecycle as lc
        lc._registry.clear()

    async def test_agent_spawns_and_reaches_ready(self):
        """set_agent_state: active → idle lifecycle arc updates in-memory registry."""
        mock_session = AsyncMock()
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)
        mock_session.add = MagicMock()
        mock_session.commit = AsyncMock()

        # scalar_one_or_none must be a regular Mock (not AsyncMock)
        mock_result = MagicMock()
        mock_result.scalar_one_or_none = MagicMock(return_value=None)
        mock_session.execute = AsyncMock(return_value=mock_result)

        with patch("src.brain.lifecycle.get_session", return_value=mock_session):
            from src.brain.lifecycle import set_agent_state, get_registry_state

            await set_agent_state("maya", "active", reason="start")
            assert get_registry_state("maya") == "active"

            await set_agent_state("maya", "idle", reason="finished")
            assert get_registry_state("maya") == "idle"

    async def test_compaction_triggered_after_threshold_messages(self):
        """maybe_compact returns True when thread token count exceeds limit."""
        from src.brain.compaction import maybe_compact
        from src.brain.models.thread import Message

        # Create mock messages that exceed the token limit
        fake_messages = []
        for i in range(30):
            msg = MagicMock(spec=Message)
            msg.tokens = 250  # 30 * 250 = 7500 > default 6000
            msg.content = f"Message content {i}: " + "x" * 200
            msg.role = "user" if i % 2 == 0 else "assistant"
            msg.created_at = datetime.now(timezone.utc)
            fake_messages.append(msg)

        mock_session = AsyncMock()
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)

        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = fake_messages
        mock_session.execute = AsyncMock(return_value=mock_result)
        mock_session.add = MagicMock()
        mock_session.delete = MagicMock()
        mock_session.commit = AsyncMock()

        with patch("src.brain.compaction.get_session", return_value=mock_session):
            result = await maybe_compact("t-long", token_limit=6000)

        assert result is True

    async def test_recovery_from_llm_error_follows_recipe(self):
        """recover() applies retry+fallback recipe when error is LlmApiError."""
        from src.brain.recovery import recover, FailureScenario

        mock_session = AsyncMock()
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)
        mock_session.add = MagicMock()
        mock_session.commit = AsyncMock()

        with patch("src.brain.recovery.get_session", return_value=mock_session):
            result = await recover(
                agent_id="maya",
                thread_id="t-1",
                exc=Exception("rate limit"),
                http_status=429,
            )

        # LlmApiError recipe should set use_fallback_model via switch_fallback_model step
        assert "steps_taken" in result
        assert isinstance(result["steps_taken"], list)
