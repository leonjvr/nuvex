"""Unit tests for Section 10 — Hook block/approval semantics."""
from __future__ import annotations

import asyncio
import pytest


class TestHookResultFields:
    """10.1 — HookResult has block, require_approval, reason."""

    def test_hook_result_has_block(self):
        from src.brain.hooks import HookResult
        r = HookResult()
        assert r.block is False

    def test_hook_result_has_require_approval(self):
        from src.brain.hooks import HookResult
        r = HookResult()
        assert r.require_approval is False

    def test_hook_result_has_reason(self):
        from src.brain.hooks import HookResult
        r = HookResult()
        assert r.reason is None

    def test_hook_result_block_true(self):
        from src.brain.hooks import HookResult
        r = HookResult(block=True, reason="too dangerous")
        assert r.block is True
        assert r.reason == "too dangerous"


class TestPreHookBlockSemantics:
    """10.2 / 10.8 — PreToolUse block stops chain, sets ctx.abort."""

    @pytest.mark.asyncio
    async def test_blocking_hook_sets_abort(self):
        from src.brain.hooks import HookContext, HookResult, _run_pre_hooks, HookFn

        async def blocking_hook(ctx: HookContext) -> HookResult:
            return HookResult(block=True, reason="policy block")

        ctx = HookContext(agent_id="a", thread_id="t", tool_name="shell", tool_input={})
        await _run_pre_hooks([blocking_hook], ctx)
        assert ctx.abort is True
        assert ctx.abort_reason == "policy block"

    @pytest.mark.asyncio
    async def test_first_block_stops_chain(self):
        """10.8 — chain stops on first block=True."""
        from src.brain.hooks import HookContext, HookResult, _run_pre_hooks

        calls: list[str] = []

        async def hook_a(ctx: HookContext) -> HookResult:
            calls.append("a")
            return HookResult(block=True, reason="blocked")

        async def hook_b(ctx: HookContext) -> None:
            calls.append("b")  # should NOT be called

        ctx = HookContext(agent_id="a", thread_id="t", tool_name="shell", tool_input={})
        await _run_pre_hooks([hook_a, hook_b], ctx)
        assert calls == ["a"]  # hook_b must not run
        assert ctx.abort is True

    @pytest.mark.asyncio
    async def test_require_approval_sets_abort(self):
        from src.brain.hooks import HookContext, HookResult, _run_pre_hooks

        async def approval_hook(ctx: HookContext) -> HookResult:
            return HookResult(require_approval=True, reason="needs supervisor sign-off")

        ctx = HookContext(agent_id="a", thread_id="t", tool_name="shell", tool_input={})
        await _run_pre_hooks([approval_hook], ctx)
        assert ctx.abort is True
        assert "supervisor" in ctx.abort_reason

    @pytest.mark.asyncio
    async def test_non_blocking_hook_does_not_abort(self):
        from src.brain.hooks import HookContext, _run_pre_hooks

        async def normal_hook(ctx: HookContext) -> None:
            pass

        ctx = HookContext(agent_id="a", thread_id="t", tool_name="shell", tool_input={})
        await _run_pre_hooks([normal_hook], ctx)
        assert ctx.abort is False


class TestHookContextSkillFields:
    """6.1 — HookContext has skill_name and skill_env."""

    def test_hook_context_has_skill_name(self):
        from src.brain.hooks import HookContext
        ctx = HookContext(agent_id="a", thread_id="t", tool_name="shell", tool_input={})
        assert ctx.skill_name is None

    def test_hook_context_has_skill_env(self):
        from src.brain.hooks import HookContext
        ctx = HookContext(agent_id="a", thread_id="t", tool_name="shell", tool_input={})
        assert ctx.skill_env is None

    def test_hook_context_skill_env_assignable(self):
        from src.brain.hooks import HookContext
        ctx = HookContext(agent_id="a", thread_id="t", tool_name="shell", tool_input={})
        ctx.skill_env = {"API_KEY": "secret"}
        assert ctx.skill_env["API_KEY"] == "secret"


class TestPendingApprovalModel:
    """10.4 — PendingApproval model."""

    def test_model_imports(self):
        from src.brain.models.approval import PendingApproval
        assert PendingApproval.__tablename__ == "pending_approvals"

    def test_model_has_required_columns(self):
        from src.brain.models.approval import PendingApproval
        from sqlalchemy import inspect
        mapper = inspect(PendingApproval)
        col_names = {c.key for c in mapper.mapper.column_attrs}
        expected = {"id", "agent_id", "thread_id", "tool_name", "tool_input",
                    "reason", "status", "created_at", "resolved_at", "resolved_by"}
        assert expected <= col_names

    def test_migration_0014_exists(self):
        from pathlib import Path
        mig = Path("src/brain/migrations/versions/0014_add_pending_approvals.py")
        assert mig.is_file()

    def test_migration_0014_chain(self):
        from pathlib import Path
        import importlib.util
        mig = Path("src/brain/migrations/versions/0014_add_pending_approvals.py")
        spec = importlib.util.spec_from_file_location("mig0014", mig)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        assert mod.revision == "0014"
        assert mod.down_revision == "0013"
