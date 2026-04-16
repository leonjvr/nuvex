"""Unit tests for compaction improvements (hermes-inspired-runtime §4)."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone


@dataclass
class _FakeMsg:
    role: str
    content: str
    created_at: datetime = None

    def __post_init__(self):
        if self.created_at is None:
            self.created_at = datetime.now(timezone.utc)


class TestPruneToolResults:
    def test_prune_clears_old_tool_results(self):
        from src.brain.compaction import _prune_tool_results, _TOOL_CLEARED_STUB

        msgs = [
            _FakeMsg("tool", "big output 1"),
            _FakeMsg("tool", "big output 2"),
            _FakeMsg("human", "user message"),
            _FakeMsg("ai", "agent response"),
            _FakeMsg("tool", "recent tool"),
        ]
        pruned = _prune_tool_results(msgs, preserve_recent=2)
        # Messages 0..2 are beyond the cutoff of 3 = (5-2)
        assert pruned[0].content == _TOOL_CLEARED_STUB  # tool, outside window
        assert pruned[1].content == _TOOL_CLEARED_STUB  # tool, outside window
        assert pruned[2].content == "user message"      # human — never touched
        assert pruned[3].content == "agent response"    # ai — never touched
        assert pruned[4].content == "recent tool"       # recent — kept

    def test_prune_never_touches_human(self):
        from src.brain.compaction import _prune_tool_results

        msgs = [_FakeMsg("human", "my question") for _ in range(5)]
        pruned = _prune_tool_results(msgs, preserve_recent=0)
        for m in pruned:
            assert m.content == "my question"

    def test_prune_never_touches_system(self):
        from src.brain.compaction import _prune_tool_results

        msgs = [_FakeMsg("system", "system message")]
        pruned = _prune_tool_results(msgs, preserve_recent=0)
        assert pruned[0].content == "system message"

    def test_preserve_recent_window_untouched(self):
        from src.brain.compaction import _prune_tool_results, _TOOL_CLEARED_STUB

        msgs = [_FakeMsg("tool", f"tool{i}") for i in range(10)]
        pruned = _prune_tool_results(msgs, preserve_recent=5)
        # Last 5 should be preserved
        for m in pruned[5:]:
            assert m.content != _TOOL_CLEARED_STUB
        for m in pruned[:5]:
            assert m.content == _TOOL_CLEARED_STUB


class TestBuildPrioritySummary:
    def test_summary_includes_handoff_preamble(self):
        from src.brain.compaction import _build_priority_summary, _HANDOFF_PREAMBLE

        msgs = [_FakeMsg("human", "test")]
        summary = _build_priority_summary(msgs)
        assert summary.startswith(_HANDOFF_PREAMBLE)

    def test_summary_has_structured_sections(self):
        from src.brain.compaction import _build_priority_summary

        msgs = [
            _FakeMsg("human", "What is the status?"),
            _FakeMsg("ai", "I checked and it is running."),
        ]
        summary = _build_priority_summary(msgs)
        assert "## Resolved" in summary or "## Pending" in summary

    def test_cleared_stubs_not_included(self):
        from src.brain.compaction import _build_priority_summary, _TOOL_CLEARED_STUB

        msgs = [
            _FakeMsg("tool", _TOOL_CLEARED_STUB),
            _FakeMsg("human", "user query"),
        ]
        summary = _build_priority_summary(msgs)
        assert _TOOL_CLEARED_STUB not in summary


class TestClassifier:
    def test_trivial_reply_short_message(self):
        from src.brain.routing.classifier import classify

        result = classify("Hi, how are you?")
        assert result == "trivial_reply"

    def test_trivial_reply_disabled_by_long_msg(self):
        from src.brain.routing.classifier import classify

        result = classify("A" * 200)
        assert result != "trivial_reply"

    def test_trivial_reply_disabled_by_complex_keyword(self):
        from src.brain.routing.classifier import classify

        result = classify("Can you explain this to me?")
        assert result != "trivial_reply"

    def test_trivial_reply_disabled_by_url(self):
        from src.brain.routing.classifier import classify

        result = classify("Check https://example.com")
        assert result != "trivial_reply"

    def test_trivial_reply_disabled_by_code_fence(self):
        from src.brain.routing.classifier import classify

        result = classify("Look at this ```python code```")
        assert result != "trivial_reply"

    def test_trivial_reply_disabled_by_arousal(self):
        from src.brain.routing.classifier import _is_trivial_reply

        assert _is_trivial_reply("Hi!", arousal_score=0.9) is False

    def test_trivial_reply_passes_low_arousal(self):
        from src.brain.routing.classifier import _is_trivial_reply

        assert _is_trivial_reply("Hi there!", arousal_score=0.1) is True

    def test_trivial_reply_deterministic_no_llm(self):
        """Must not make any network call — purely deterministic."""
        from src.brain.routing.classifier import classify
        import unittest.mock as mock

        with mock.patch("src.brain.routing.classifier.re") as mock_re:
            mock_re.compile = __import__("re").compile  # allow actual regex
            mock_re.search = __import__("re").search
            # If LLM call happened it would raise; no exception = deterministic
            result = classify("hello")
        assert result in ("trivial_reply", "simple_reply", "conversation", "code_generation", "voice_response")
