"""Scheduler — holds local task queue, manages execution based on idle/permission state."""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Awaitable

log = logging.getLogger(__name__)

_MAX_TOOL_CALLS_PER_SECOND = 5


@dataclass
class LocalTask:
    call_id: str
    tool: str
    args: dict[str, Any]
    conn: Any  # Connection reference


class Scheduler:
    """Manages local task execution with cooperative idle/permission scheduling."""

    def __init__(self, config) -> None:
        self._cfg = config
        self._queue: list[LocalTask] = []
        self._executing = False
        self._paused = False
        self._mode = config.desktop_mode
        self._rate_tokens = _MAX_TOOL_CALLS_PER_SECOND
        self._last_token_refill = time.monotonic()
        self._load_persisted()

    def enqueue(self, task: LocalTask) -> None:
        self._queue.append(task)
        self._persist()

    def on_idle_start(self) -> None:
        if self._queue and not self._executing:
            asyncio.create_task(self._run_queued())

    def on_idle_end(self) -> None:
        self._paused = True

    async def _run_queued(self) -> None:
        if self._mode == "ask":
            await self._ask_permission()
        else:
            await self._execute_all()

    async def _ask_permission(self) -> None:
        from .notifications import NotificationManager
        nm = NotificationManager()
        approved = await nm.show_approval_popup(self._queue)
        if approved:
            await self._execute_all()
        else:
            log.info("scheduler: tasks rejected by user")

    async def _execute_all(self) -> None:
        self._executing = True
        self._paused = False
        try:
            while self._queue:
                if self._paused:
                    log.info("scheduler: pausing — user is active")
                    break
                task = self._queue.pop(0)
                await self._execute_one(task)
                self._persist()
        finally:
            self._executing = False

    async def _execute_one(self, task: LocalTask) -> None:
        await self._rate_limit()
        from .dispatcher import Dispatcher
        from .tools import TOOL_REGISTRY
        dispatcher = Dispatcher(TOOL_REGISTRY)
        await dispatcher.dispatch(
            {"type": "tool_call", "call_id": task.call_id, "tool": task.tool, "args": task.args},
            task.conn,
        )

    async def _rate_limit(self) -> None:
        now = time.monotonic()
        elapsed = now - self._last_token_refill
        self._rate_tokens = min(_MAX_TOOL_CALLS_PER_SECOND, self._rate_tokens + elapsed * _MAX_TOOL_CALLS_PER_SECOND)
        self._last_token_refill = now
        if self._rate_tokens < 1:
            await asyncio.sleep(1.0 / _MAX_TOOL_CALLS_PER_SECOND)
        else:
            self._rate_tokens -= 1

    def _queue_path(self) -> Path:
        appdata = os.environ.get("APPDATA", str(Path.home() / "AppData" / "Roaming"))
        return Path(appdata) / "Nuvex" / "queue.json"

    def _persist(self) -> None:
        try:
            path = self._queue_path()
            path.parent.mkdir(parents=True, exist_ok=True)
            data = [{"call_id": t.call_id, "tool": t.tool, "args": t.args} for t in self._queue]
            path.write_text(json.dumps(data), encoding="utf-8")
        except Exception as exc:
            log.warning("scheduler: persist failed: %s", exc)

    def _load_persisted(self) -> None:
        try:
            path = self._queue_path()
            if path.is_file():
                data = json.loads(path.read_text(encoding="utf-8"))
                for item in data:
                    self._queue.append(LocalTask(
                        call_id=item["call_id"], tool=item["tool"],
                        args=item.get("args", {}), conn=None,
                    ))
                log.info("scheduler: restored %d tasks from disk", len(self._queue))
        except Exception as exc:
            log.warning("scheduler: load persisted failed: %s", exc)
