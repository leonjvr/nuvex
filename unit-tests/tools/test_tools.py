"""Unit tests — built-in tools: ReadFileTool, WriteFileTool, ShellTool, WebFetchTool."""
from __future__ import annotations

import asyncio
import tempfile
import os
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.brain.tools.builtin import ReadFileTool, WriteFileTool, WebFetchTool
from src.brain.tools.shell_tool import ShellTool


# ---------------------------------------------------------------------------
# ReadFileTool
# ---------------------------------------------------------------------------

class TestReadFileTool:
    def test_reads_existing_file(self, tmp_path):
        p = tmp_path / "hello.txt"
        p.write_text("hello world")
        tool = ReadFileTool()
        result = asyncio.run(tool._arun(str(p)))
        assert "hello world" in result

    def test_returns_error_for_missing_file(self):
        tool = ReadFileTool()
        result = asyncio.run(tool._arun("/nonexistent/path/file.txt"))
        assert "[error]" in result

    def test_truncates_at_max_bytes(self, tmp_path):
        p = tmp_path / "big.txt"
        p.write_text("A" * 1000)
        tool = ReadFileTool()
        result = asyncio.run(tool._arun(str(p), max_bytes=100))
        # Should show truncation note
        assert "truncated" in result.lower() or len(result) <= 200

    def test_reads_up_to_max_bytes_exactly(self, tmp_path):
        p = tmp_path / "exact.txt"
        p.write_text("X" * 500)
        tool = ReadFileTool()
        result = asyncio.run(tool._arun(str(p), max_bytes=500))
        # No truncation needed
        assert "truncated" not in result


# ---------------------------------------------------------------------------
# WriteFileTool
# ---------------------------------------------------------------------------

class TestWriteFileTool:
    def test_writes_new_file(self, tmp_path):
        p = tmp_path / "out.txt"
        tool = WriteFileTool()
        result = asyncio.run(tool._arun(str(p), "hello\n"))
        assert "[ok]" in result
        assert p.read_text() == "hello\n"

    def test_overwrites_existing_file(self, tmp_path):
        p = tmp_path / "over.txt"
        p.write_text("old content")
        tool = WriteFileTool()
        asyncio.run(tool._arun(str(p), "new content"))
        assert p.read_text() == "new content"

    def test_append_mode(self, tmp_path):
        p = tmp_path / "append.txt"
        p.write_text("line1\n")
        tool = WriteFileTool()
        asyncio.run(tool._arun(str(p), "line2\n", append=True))
        assert p.read_text() == "line1\nline2\n"

    def test_creates_parent_dirs(self, tmp_path):
        p = tmp_path / "nested" / "dir" / "file.txt"
        tool = WriteFileTool()
        asyncio.run(tool._arun(str(p), "content"))
        assert p.exists()

    def test_returns_ok_with_char_count(self, tmp_path):
        p = tmp_path / "count.txt"
        tool = WriteFileTool()
        result = asyncio.run(tool._arun(str(p), "hello"))
        assert "[ok]" in result
        assert "5" in result  # 5 chars


# ---------------------------------------------------------------------------
# ShellTool
# ---------------------------------------------------------------------------

class TestShellTool:
    def test_blocks_non_skill_command(self):
        """Shell tool enforces skill-script-only policy; arbitrary commands are blocked."""
        tool = ShellTool()
        result = asyncio.run(tool._arun('python -c "print(\'hi\')"\''))
        assert "[blocked]" in result

    def test_blocks_sleep_command(self):
        tool = ShellTool()
        result = asyncio.run(tool._arun("python -c \"import time; time.sleep(10)\""))
        assert "[blocked]" in result

    def test_blocks_inline_python(self):
        tool = ShellTool()
        result = asyncio.run(tool._arun('python -c "import sys; sys.stderr.write(\'err\')"\''))
        assert "[blocked]" in result

    def test_invalid_command_returns_error(self):
        tool = ShellTool()
        result = asyncio.run(tool._arun("this_command_definitely_does_not_exist_xyz"))
        # Either the shell returns an error or we catch an exception
        assert result  # not empty


# ---------------------------------------------------------------------------
# WebFetchTool
# ---------------------------------------------------------------------------

class TestWebFetchTool:
    @pytest.mark.asyncio
    async def test_successful_fetch(self):
        tool = WebFetchTool()
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.text = "response body here"

        mock_client = AsyncMock()
        mock_client.get = AsyncMock(return_value=mock_resp)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch("src.brain.tools.builtin.httpx.AsyncClient", return_value=mock_client):
            result = await tool._arun("http://example.com")

        assert "200" in result
        assert "response body here" in result

    @pytest.mark.asyncio
    async def test_truncates_long_response(self):
        tool = WebFetchTool()
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.text = "X" * 10000

        mock_client = AsyncMock()
        mock_client.get = AsyncMock(return_value=mock_resp)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch("src.brain.tools.builtin.httpx.AsyncClient", return_value=mock_client):
            result = await tool._arun("http://example.com", max_chars=100)

        assert "truncated" in result

    @pytest.mark.asyncio
    async def test_handles_connection_error(self):
        tool = WebFetchTool()
        mock_client = AsyncMock()
        mock_client.get = AsyncMock(side_effect=Exception("connection refused"))
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch("src.brain.tools.builtin.httpx.AsyncClient", return_value=mock_client):
            result = await tool._arun("http://unreachable.example.com")

        assert "[error]" in result


# ---------------------------------------------------------------------------
# Cost estimator
# ---------------------------------------------------------------------------

class TestEstimateCost:
    def test_gpt4o_has_cost(self):
        from src.brain.nodes.call_llm import _estimate_cost
        cost = _estimate_cost("gpt-4o", 1000, 1000)
        assert cost > 0

    def test_unknown_model_returns_zero(self):
        from src.brain.nodes.call_llm import _estimate_cost
        cost = _estimate_cost("mystery-model-xyz", 1000, 1000)
        assert cost == 0.0

    def test_mini_cheaper_than_gpt4o(self):
        from src.brain.nodes.call_llm import _estimate_cost
        # Use enough output tokens where gpt-4o-mini's lower output rate shows difference
        cost_mini = _estimate_cost("gpt-4o-mini", 10000, 10000)
        cost_full = _estimate_cost("gpt-4o", 10000, 10000)
        assert cost_mini < cost_full

    def test_zero_tokens_is_zero_cost(self):
        from src.brain.nodes.call_llm import _estimate_cost
        assert _estimate_cost("gpt-4o", 0, 0) == 0.0
