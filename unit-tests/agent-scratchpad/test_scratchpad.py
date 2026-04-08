"""Unit tests for agent coordination scratchpad (§35)."""
from __future__ import annotations

import os
import pytest
import tempfile
from pathlib import Path
from unittest.mock import patch, MagicMock


class TestScratchDirManagement:
    def test_get_scratch_dir_returns_path_under_data_threads(self):
        from src.brain.tools.executor import get_scratch_dir
        path = get_scratch_dir("thread-abc")
        assert "thread-abc" in str(path)
        assert "scratch" in str(path)

    def test_different_threads_get_different_dirs(self):
        from src.brain.tools.executor import get_scratch_dir
        p1 = get_scratch_dir("thread-111")
        p2 = get_scratch_dir("thread-222")
        assert p1 != p2

    def test_ensure_scratch_dir_creates_dir(self):
        from src.brain.tools.executor import ensure_scratch_dir, get_scratch_dir
        thread_id = "thread-test-create"
        with patch("src.brain.tools.executor.get_scratch_dir") as mock_gsd:
            with tempfile.TemporaryDirectory() as tmp:
                scratch = Path(tmp) / "scratch"
                mock_gsd.return_value = scratch
                returned = ensure_scratch_dir(thread_id)
                assert scratch.exists()
                assert returned == scratch

    def test_ensure_scratch_dir_idempotent(self):
        from src.brain.tools.executor import ensure_scratch_dir
        with patch("src.brain.tools.executor.get_scratch_dir") as mock_gsd:
            with tempfile.TemporaryDirectory() as tmp:
                scratch = Path(tmp) / "scratch"
                scratch.mkdir()
                mock_gsd.return_value = scratch
                # Should not raise
                ensure_scratch_dir("thread-x")
                ensure_scratch_dir("thread-x")
                assert scratch.exists()


class TestScratchQuota:
    def test_under_quota_returns_ok(self):
        from src.brain.tools.executor import check_scratch_quota
        with patch("src.brain.tools.executor.get_scratch_dir") as mock_gsd:
            with tempfile.TemporaryDirectory() as tmp:
                scratch = Path(tmp) / "scratch"
                scratch.mkdir()
                (scratch / "small.txt").write_bytes(b"x" * 100)
                mock_gsd.return_value = scratch
                ok, msg = check_scratch_quota("thread-x", quota_mb=1)
                assert ok is True
                assert msg is None

    def test_over_quota_returns_error(self):
        from src.brain.tools.executor import check_scratch_quota, scratch_dir_size_mb
        with patch("src.brain.tools.executor.get_scratch_dir") as mock_gsd:
            with tempfile.TemporaryDirectory() as tmp:
                scratch = Path(tmp) / "scratch"
                scratch.mkdir()
                mock_gsd.return_value = scratch
                # Patch size function to exceed quota
                with patch("src.brain.tools.executor.scratch_dir_size_mb", return_value=200.0):
                    ok, msg = check_scratch_quota("thread-x", quota_mb=100)
                assert ok is False
                assert msg is not None
                assert "quota" in msg.lower() or "exceeded" in msg.lower() or "200" in msg

    def test_nonexistent_dir_returns_zero_size(self):
        from src.brain.tools.executor import scratch_dir_size_mb
        non_path = Path("/nonexistent/path/that/does/not/exist")
        size = scratch_dir_size_mb(non_path)
        assert size == 0.0


class TestScratchCleanup:
    def test_cleanup_removes_scratch_dir(self):
        from src.brain.tools.executor import cleanup_scratch_dir
        with patch("src.brain.tools.executor.get_scratch_dir") as mock_gsd:
            with tempfile.TemporaryDirectory() as tmp:
                scratch = Path(tmp) / "scratch"
                scratch.mkdir()
                (scratch / "file.txt").write_text("data")
                mock_gsd.return_value = scratch
                cleanup_scratch_dir("thread-x")
                assert not scratch.exists()

    def test_cleanup_nonexistent_dir_is_noop(self):
        from src.brain.tools.executor import cleanup_scratch_dir
        with patch("src.brain.tools.executor.get_scratch_dir") as mock_gsd:
            mock_gsd.return_value = Path("/nonexistent/scratch/that/does/not/exist")
            # Should not raise
            cleanup_scratch_dir("thread-x")
