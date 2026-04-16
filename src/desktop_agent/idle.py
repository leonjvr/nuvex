"""Idle detection using GetLastInputInfo (Windows) — with cross-platform fallback."""
from __future__ import annotations

import asyncio
import logging
import sys
import time
from typing import Callable

log = logging.getLogger(__name__)

_idle_callbacks: list[Callback] = []
Callback = Callable[[str], None]


class IdleDetector:
    """Polls GetLastInputInfo every 5s; emits idle_start / idle_end events."""

    def __init__(self) -> None:
        self._was_idle = False
        self._callbacks: list[Callable[[str], None]] = []

    def on_event(self, cb: Callable[[str], None]) -> None:
        self._callbacks.append(cb)

    def seconds_since_input(self) -> float:
        if sys.platform == "win32":
            return _win32_seconds_since_input()
        return 0.0

    def is_idle(self, threshold_seconds: int) -> bool:
        return self.seconds_since_input() >= threshold_seconds

    async def run(self, threshold_seconds: int, poll_interval: float = 5.0) -> None:
        while True:
            idle_now = self.is_idle(threshold_seconds)
            if idle_now and not self._was_idle:
                self._was_idle = True
                self._emit("idle_start")
            elif not idle_now and self._was_idle:
                self._was_idle = False
                self._emit("idle_end")
            await asyncio.sleep(poll_interval)

    def _emit(self, event: str) -> None:
        for cb in self._callbacks:
            try:
                cb(event)
            except Exception as exc:
                log.warning("idle: callback error: %s", exc)


def _win32_seconds_since_input() -> float:
    try:
        import ctypes
        import ctypes.wintypes

        class LASTINPUTINFO(ctypes.Structure):
            _fields_ = [("cbSize", ctypes.c_uint), ("dwTime", ctypes.c_ulong)]

        lii = LASTINPUTINFO()
        lii.cbSize = ctypes.sizeof(LASTINPUTINFO)
        ctypes.windll.user32.GetLastInputInfo(ctypes.byref(lii))
        tick_count = ctypes.windll.kernel32.GetTickCount()
        elapsed_ms = tick_count - lii.dwTime
        return max(0.0, elapsed_ms / 1000.0)
    except Exception:
        return 0.0
