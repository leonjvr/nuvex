"""Unit tests for sandbox runtime (tool-execution-sandboxing §1, §5)."""
from __future__ import annotations

import platform
import pytest

from src.brain.sandbox.config import SandboxConfig
from src.brain.sandbox.result import SandboxResult


class TestSandboxConfig:
    def test_default_values(self):
        cfg = SandboxConfig()
        assert cfg.cpu_seconds == 30
        assert cfg.memory_mb == 256
        assert cfg.max_pids == 32
        assert cfg.network is False
        assert cfg.tmpfs_mb == 50
        assert cfg.allow_paths == []

    def test_custom_values(self):
        cfg = SandboxConfig(cpu_seconds=10, memory_mb=512, max_pids=16, network=True)
        assert cfg.cpu_seconds == 10
        assert cfg.memory_mb == 512
        assert cfg.network is True

    def test_rejects_negative_cpu(self):
        with pytest.raises(Exception):
            SandboxConfig(cpu_seconds=-1)

    def test_rejects_zero_memory(self):
        with pytest.raises(Exception):
            SandboxConfig(memory_mb=0)


class TestPlatformDetection:
    def test_fallback_on_non_linux(self):
        """On non-Linux, SandboxExecutor must be FallbackExecutor."""
        if platform.system() != "Linux":
            from src.brain.sandbox import SandboxExecutor
            from src.brain.sandbox.fallback import FallbackExecutor
            assert isinstance(SandboxExecutor(), FallbackExecutor)

    def test_sandbox_executor_importable(self):
        from src.brain.sandbox import SandboxExecutor, SandboxConfig, SandboxResult
        assert SandboxExecutor is not None
        assert SandboxConfig is not None
        assert SandboxResult is not None


@pytest.mark.skipif(platform.system() != "Linux", reason="FallbackExecutor subprocess tests require Linux")
class TestFallbackExecutor:
    @pytest.mark.asyncio
    async def test_run_returns_sandbox_result(self):
        from src.brain.sandbox.fallback import FallbackExecutor

        ex = FallbackExecutor()
        result = await ex.run(["echo", "hello"])
        assert isinstance(result, SandboxResult)
        assert result.sandbox_active is False
        assert "hello" in result.stdout

    @pytest.mark.asyncio
    async def test_exit_code_captured(self):
        from src.brain.sandbox.fallback import FallbackExecutor

        ex = FallbackExecutor()
        result = await ex.run(["sh", "-c", "exit 42"])
        assert result.exit_code == 42

    @pytest.mark.asyncio
    async def test_timeout_kills_process(self):
        from src.brain.sandbox.fallback import FallbackExecutor

        ex = FallbackExecutor()
        cfg = SandboxConfig(cpu_seconds=1)
        result = await ex.run(["sleep", "60"], config=cfg)
        assert result.killed_by == "timeout"
        assert result.exit_code == -1


class TestSandboxResult:
    def test_defaults(self):
        r = SandboxResult(stdout="out", stderr="err", exit_code=0, sandbox_active=True)
        assert r.cpu_ms == 0
        assert r.memory_peak_mb == 0.0
        assert r.network_bytes_out == 0
        assert r.killed_by is None
