"""Unit tests for post-tool result masking via hooks (§34)."""
from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, MagicMock, patch


def _make_hook_ctx(tool_output: str, agent_id: str = "agent-1"):
    from src.brain.hooks import HookContext
    ctx = HookContext(
        tool_name="web_fetch",
        tool_input={},
        tool_output=tool_output,
        agent_id=agent_id,
        thread_id="thread-1",
    )
    return ctx


class TestHookResultDataclass:
    def test_defaults(self):
        from src.brain.hooks import HookResult
        hr = HookResult()
        assert hr.result_override is None
        assert hr.skip_model_feedback is False

    def test_with_override(self):
        from src.brain.hooks import HookResult
        hr = HookResult(result_override="masked", skip_model_feedback=False)
        assert hr.result_override == "masked"


class TestRunPostHooks:
    @pytest.mark.asyncio
    async def test_result_override_used_as_output(self):
        from src.brain.hooks import HookResult, run_post_hooks, HookContext

        async def masking_hook(ctx: HookContext):
            return HookResult(result_override="[REDACTED]")

        ctx = _make_hook_ctx("secret token abc123")
        result = await run_post_hooks(ctx, hooks=[masking_hook])
        assert result == "[REDACTED]"

    @pytest.mark.asyncio
    async def test_skip_model_feedback_returns_none(self):
        from src.brain.hooks import HookResult, run_post_hooks, HookContext

        async def suppress_hook(ctx: HookContext):
            return HookResult(skip_model_feedback=True)

        ctx = _make_hook_ctx("some output")
        result = await run_post_hooks(ctx, hooks=[suppress_hook])
        assert result is None

    @pytest.mark.asyncio
    async def test_chain_second_hook_receives_override(self):
        from src.brain.hooks import HookResult, run_post_hooks, HookContext

        received = []

        async def hook_a(ctx: HookContext):
            return HookResult(result_override="MASKED_A")

        async def hook_b(ctx: HookContext):
            received.append(ctx.tool_output)
            return None

        ctx = _make_hook_ctx("original")
        result = await run_post_hooks(ctx, hooks=[hook_a, hook_b])
        assert received[0] == "MASKED_A"
        assert result == "MASKED_A"

    @pytest.mark.asyncio
    async def test_no_hooks_returns_original(self):
        from src.brain.hooks import run_post_hooks, HookContext

        ctx = _make_hook_ctx("original output")
        result = await run_post_hooks(ctx, hooks=[])
        assert result == "original output"


class TestPiiMaskHook:
    def test_email_redacted(self):
        from src.brain.hooks.pii_mask import PiiMaskHook
        from src.brain.hooks import HookContext, HookResult
        import asyncio

        hook = PiiMaskHook(patterns=[r"\b[\w.+-]+@[\w-]+\.\w{2,}\b"])
        ctx = _make_hook_ctx("Contact us at admin@example.com for more info.")

        result = asyncio.get_event_loop().run_until_complete(hook(ctx))
        assert isinstance(result, HookResult)
        assert "[REDACTED]" in result.result_override
        assert "admin@example.com" not in result.result_override

    def test_no_match_returns_no_override(self):
        from src.brain.hooks.pii_mask import PiiMaskHook
        from src.brain.hooks import HookContext, HookResult
        import asyncio

        hook = PiiMaskHook(patterns=[r"\b[\w.+-]+@[\w-]+\.\w{2,}\b"])
        ctx = _make_hook_ctx("Hello world, no email here.")

        result = asyncio.get_event_loop().run_until_complete(hook(ctx))
        # No match: override is None or result is None
        if result is not None:
            assert result.result_override is None

    def test_make_pii_mask_hook_returns_none_without_patterns(self):
        from src.brain.hooks.pii_mask import make_pii_mask_hook

        with patch("src.shared.config.get_cached_config") as mock_cfg, \
             patch("src.shared.config.get_agent") as mock_get_agent:
            mock_agent = MagicMock()
            mock_agent.pii_patterns = []
            mock_get_agent.return_value = mock_agent
            mock_cfg.return_value = MagicMock()
            result = make_pii_mask_hook("agent-1")
        assert result is None

    def test_make_pii_mask_hook_with_patterns(self):
        from src.brain.hooks.pii_mask import make_pii_mask_hook

        with patch("src.shared.config.get_cached_config") as mock_cfg, \
             patch("src.shared.config.get_agent") as mock_get_agent:
            mock_agent = MagicMock()
            mock_agent.pii_patterns = [r"\d{4}-\d{4}-\d{4}-\d{4}"]
            mock_get_agent.return_value = mock_agent
            mock_cfg.return_value = MagicMock()
            result = make_pii_mask_hook("agent-2")
        assert result is not None
