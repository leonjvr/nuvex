"""System tray icon with state machine (pystray)."""
from __future__ import annotations

import logging
import sys
import threading
from typing import Any

log = logging.getLogger(__name__)

_STATES = {
    "disconnected": "grey",
    "connected_idle": "green",
    "queued_user_active": "orange",
    "awaiting_permission": "orange",
    "executing": "green",
    "error": "red",
}


class DesktopTray:
    def __init__(self, conn) -> None:
        self._conn = conn
        self._state = "disconnected"
        self._icon = None
        self._pending_count = 0
        self._settings_open = False

    def set_state(self, state: str, pending: int = 0) -> None:
        self._state = state
        self._pending_count = pending
        if self._icon:
            try:
                self._icon.title = self._tooltip()
                self._icon.icon = self._make_icon(state)
            except Exception:
                pass

    def open_settings(self) -> None:
        """Open the settings window in its own thread (tkinter needs a thread)."""
        if self._settings_open:
            return
        self._settings_open = True
        def _run():
            try:
                from desktop_agent.setup_wizard import open_settings
                open_settings(self._conn._cfg, self._conn)
                # Reload config in-place so the running connection picks it up
                from desktop_agent.config import load_config
                new_cfg = load_config()
                self._conn._cfg = new_cfg
            except Exception as exc:
                log.warning("tray: settings window error: %s", exc)
            finally:
                self._settings_open = False
        threading.Thread(target=_run, daemon=True).start()

    def run(self) -> None:
        if sys.platform != "win32":
            return
        try:
            import pystray

            def _on_open_settings(icon, item):
                self.open_settings()

            def _on_quit(icon, item):
                icon.stop()

            menu = pystray.Menu(
                pystray.MenuItem(
                    "Open Settings",
                    _on_open_settings,
                    default=True,
                ),
                pystray.Menu.SEPARATOR,
                pystray.MenuItem("Quit", _on_quit),
            )
            self._icon = pystray.Icon(
                "NUVEX Desktop Agent",
                icon=self._make_icon("disconnected"),
                title=self._tooltip(),
                menu=menu,
            )
            self._icon.run()
        except Exception as exc:
            log.warning("tray: failed to start: %s", exc)

    def _tooltip(self) -> str:
        base = f"NUVEX Desktop Agent — {self._state}"
        if self._pending_count:
            base += f" ({self._pending_count} pending)"
        return base

    def _make_icon(self, state: str):
        try:
            from PIL import Image, ImageDraw
            color_map = {
                "grey": "#9E9E9E", "green": "#4CAF50",
                "orange": "#FF9800", "red": "#f44336",
            }
            color_name = _STATES.get(state, "grey")
            color = color_map.get(color_name, "#9E9E9E")
            img = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
            draw = ImageDraw.Draw(img)
            draw.ellipse([8, 8, 56, 56], fill=color)
            return img
        except Exception:
            return None
