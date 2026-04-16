"""WebSocket connection client with reconnect loop and heartbeat."""
from __future__ import annotations

import asyncio
import logging
from typing import Any, AsyncGenerator, Callable

log = logging.getLogger(__name__)

_INITIAL_BACKOFF = 2.0
_MAX_BACKOFF = 60.0


class Connection:
    def __init__(self, config, dispatcher) -> None:
        self._cfg = config
        self._dispatcher = dispatcher
        self._ws = None
        self._connected = False
        self._on_connect_callbacks: list[Callable] = []
        self._on_disconnect_callbacks: list[Callable] = []

    @property
    def is_connected(self) -> bool:
        return self._connected

    def add_connect_callback(self, cb: Callable) -> None:
        self._on_connect_callbacks.append(cb)

    def add_disconnect_callback(self, cb: Callable) -> None:
        self._on_disconnect_callbacks.append(cb)

    async def send(self, msg: dict) -> None:
        if self._ws:
            try:
                import json
                await self._ws.send(json.dumps(msg))
            except Exception as exc:
                log.warning("connection: send failed: %s", exc)

    async def connect_loop(self) -> None:
        backoff = _INITIAL_BACKOFF
        while True:
            try:
                await self._run()
                backoff = _INITIAL_BACKOFF
            except Exception as exc:
                log.warning("connection: error %s — reconnecting in %.0fs", exc, backoff)
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, _MAX_BACKOFF)

    async def _run(self) -> None:
        try:
            import websockets
        except ImportError:
            log.error("connection: 'websockets' package not installed")
            await asyncio.sleep(10)
            return

        if not self._cfg.auth_token:
            log.warning("connection: no auth token configured — waiting for setup")
            await asyncio.sleep(10)
            return

        # Step 1: register to obtain/confirm device_id
        device_id = await self._register()
        if not device_id:
            return  # error already logged; backoff handled by connect_loop

        ws_base = self._cfg.brain_url.replace("http://", "ws://").replace("https://", "wss://")
        url = f"{ws_base}/devices/{device_id}/ws"
        log.info("connection: connecting to %s", url)
        async with websockets.connect(url) as ws:
            self._ws = ws
            self._connected = True
            log.info("connection: connected")
            for cb in self._on_connect_callbacks:
                try:
                    cb()
                except Exception:
                    pass
            try:
                async for raw in ws:
                    try:
                        import json
                        msg = json.loads(raw)
                        await self._handle(msg)
                    except Exception as exc:
                        log.warning("connection: message error: %s", exc)
            finally:
                self._connected = False
                self._ws = None
                for cb in self._on_disconnect_callbacks:
                    try:
                        cb()
                    except Exception:
                        pass

    async def _register(self) -> str | None:
        """Call POST /devices/register, persist device_id, return it (or None on failure)."""
        import json as _json
        import socket
        import urllib.request

        url = self._cfg.brain_url.rstrip("/") + "/devices/register"
        payload = _json.dumps({
            "token": self._cfg.auth_token,
            "device_name": socket.gethostname(),
            "platform": "windows",
        }).encode()
        try:
            req = urllib.request.Request(
                url, data=payload,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = _json.loads(resp.read())
            device_id = data["device_id"]
            if device_id != self._cfg.device_id:
                self._cfg.device_id = device_id
                from desktop_agent.config import save_config
                save_config(self._cfg)
                log.info("connection: registered as device %s", device_id)
            return device_id
        except urllib.error.HTTPError as exc:
            log.error("connection: register failed HTTP %s — check token", exc.code)
        except Exception as exc:
            log.error("connection: register failed: %s", exc)
        return None

    async def _handle(self, msg: dict) -> None:
        msg_type = msg.get("type")
        if msg_type == "heartbeat":
            await self.send({"type": "heartbeat"})
        elif msg_type == "tool_call":
            asyncio.create_task(self._dispatcher.dispatch(msg, self))
        elif msg_type == "queue_drain":
            for task in msg.get("tasks", []):
                asyncio.create_task(self._dispatcher.dispatch(
                    {"type": "tool_call", "call_id": task["call_id"],
                     "tool": task["tool"], "args": task.get("args", {})},
                    self,
                ))
