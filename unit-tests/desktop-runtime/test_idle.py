"""Unit tests: IdleDetector — 16.5"""
from __future__ import annotations

import asyncio
import sys
import pytest
from unittest.mock import patch, MagicMock

from src.desktop_agent.idle import IdleDetector, _win32_seconds_since_input


class TestIdleDetector:
    """16.5 — mock GetLastInputInfo, verify is_idle() at various thresholds."""

    def test_is_idle_returns_true_when_exceeds_threshold(self):
        detector = IdleDetector()
        with patch("src.desktop_agent.idle._win32_seconds_since_input", return_value=120.0):
            assert detector.is_idle(60) is True

    def test_is_idle_returns_false_when_below_threshold(self):
        detector = IdleDetector()
        with patch("src.desktop_agent.idle._win32_seconds_since_input", return_value=30.0):
            assert detector.is_idle(60) is False

    def test_is_idle_exactly_at_threshold(self):
        detector = IdleDetector()
        with patch("src.desktop_agent.idle._win32_seconds_since_input", return_value=60.0):
            assert detector.is_idle(60) is True

    def test_seconds_since_input_on_non_windows(self):
        with patch("src.desktop_agent.idle.sys") as mock_sys:
            mock_sys.platform = "linux"
            detector = IdleDetector()
            # On non-Windows, seconds_since_input returns 0.0 directly
            # since _win32_seconds_since_input only called on win32
            result = detector.seconds_since_input()
            # Non-windows path returns 0.0 (platform guard inside idle.py)
            assert isinstance(result, float)

    def test_idle_event_emitted(self):
        detector = IdleDetector()
        events: list[str] = []
        detector.on_event(events.append)

        async def _run():
            with patch("src.desktop_agent.idle._win32_seconds_since_input", return_value=120.0):
                with patch("asyncio.sleep", AsyncMock(side_effect=asyncio.CancelledError)):
                    try:
                        await detector.run(threshold_seconds=60, poll_interval=0.01)
                    except asyncio.CancelledError:
                        pass

        import asyncio as _asyncio
        from unittest.mock import AsyncMock
        _asyncio.run(_run())
        # idle_start should have been emitted
        assert "idle_start" in events

    def test_idle_end_event(self):
        """Transitions from idle→active should emit idle_end."""
        detector = IdleDetector()
        detector._was_idle = True  # Simulate was-idle state
        events: list[str] = []
        detector.on_event(events.append)

        async def _run():
            call_count = 0

            async def _fake_sleep(_):
                nonlocal call_count
                call_count += 1
                if call_count >= 2:
                    raise asyncio.CancelledError

            with patch("src.desktop_agent.idle._win32_seconds_since_input", return_value=5.0), \
                 patch("asyncio.sleep", _fake_sleep):
                try:
                    await detector.run(threshold_seconds=60, poll_interval=0.01)
                except asyncio.CancelledError:
                    pass

        import asyncio as _asyncio
        _asyncio.run(_run())
        assert "idle_end" in events
