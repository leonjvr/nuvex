"""Unit tests for tool result budget (hermes-inspired-runtime §2)."""
from __future__ import annotations

import uuid
from pathlib import Path

import pytest


class TestEnforceToolBudget:
    def test_output_within_limit_passes_through(self, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        from src.brain.tools.result_budget import enforce_tool_budget

        output = "x" * 100
        result, ref = enforce_tool_budget("read_file", output, "thread1", max_chars=30000)
        assert result == output
        assert ref is None

    def test_output_over_limit_is_truncated(self, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        from src.brain.tools.result_budget import enforce_tool_budget

        output = "A" * 50000
        result, ref = enforce_tool_budget("web_fetch", output, "thread1", max_chars=30000)
        assert len(result) > 30000  # includes truncation suffix
        assert "truncated at 30,000" in result
        assert ref is not None
        assert ref.original_chars == 50000
        assert ref.truncated_at == 30000

    def test_reference_handle_is_uuid(self, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        from src.brain.tools.result_budget import enforce_tool_budget

        _, ref = enforce_tool_budget("tool", "X" * 50000, "thread1", max_chars=100)
        assert ref is not None
        # Must be a valid UUID
        uuid.UUID(ref.handle)

    def test_overflow_file_created(self, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        from src.brain.tools.result_budget import enforce_tool_budget

        output = "B" * 50000
        _, ref = enforce_tool_budget("tool", output, "thread2", max_chars=100)
        assert ref is not None
        out_file = tmp_path / "data" / "threads" / "thread2" / "tool_results" / f"{ref.handle}.txt"
        assert out_file.exists()
        assert out_file.read_text(encoding="utf-8") == output


class TestReadOverflow:
    def test_valid_handle_returns_content(self, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        from src.brain.tools.result_budget import save_overflow, read_overflow

        ref = save_overflow("t1", "mytool", "hello world")
        result = read_overflow(ref.handle, "t1", max_chars=30000)
        assert result == "hello world"

    def test_invalid_uuid_returns_error(self):
        from src.brain.tools.result_budget import read_overflow

        result = read_overflow("../../etc/passwd", "t1")
        assert "Invalid reference handle" in result

    def test_missing_file_returns_error(self, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        from src.brain.tools.result_budget import read_overflow

        result = read_overflow(str(uuid.uuid4()), "t1")
        assert "not found" in result

    def test_offset_pagination(self, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        from src.brain.tools.result_budget import save_overflow, read_overflow

        content = "ABCDE" * 20
        ref = save_overflow("t2", "tool", content)
        first = read_overflow(ref.handle, "t2", max_chars=50, offset=0)
        second = read_overflow(ref.handle, "t2", max_chars=50, offset=50)
        # Content should be paged
        assert first[:50] == content[:50]


class TestEnforceTurnBudget:
    def test_within_budget_unchanged(self):
        from src.brain.tools.result_budget import enforce_turn_budget

        pairs = [("tool_a", "short"), ("tool_b", "also short")]
        results = enforce_turn_budget(pairs, "t1", turn_budget_chars=10000)
        assert results == ["short", "also short"]

    def test_over_budget_replaces_oldest(self, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        from src.brain.tools.result_budget import enforce_turn_budget

        large = "X" * 100
        pairs = [("tool_a", large), ("tool_b", large), ("tool_c", "small")]
        results = enforce_turn_budget(pairs, "t1", turn_budget_chars=150, max_result_chars=100)
        # oldest (tool_a) should have been replaced with a handle stub
        assert "reference" in results[0] or len(results[0]) < len(large)


class TestCleanup:
    def test_cleanup_removes_dir(self, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        from src.brain.tools.result_budget import save_overflow, cleanup_tool_results

        save_overflow("t3", "tool", "data")
        out_dir = tmp_path / "data" / "threads" / "t3" / "tool_results"
        assert out_dir.exists()
        cleanup_tool_results("t3")
        assert not out_dir.exists()
