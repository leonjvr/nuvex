"""Desktop agent tool registry — maps tool names to async callables."""
from __future__ import annotations

from typing import Any, Callable, Awaitable

# Import tool implementations (conditional on platform availability)
try:
    from .screen import screenshot
except Exception:
    async def screenshot(**kwargs) -> dict: return {"error": "not available"}

try:
    from .uia import list_windows, find_control, click_control, get_control_text
except Exception:
    async def list_windows(**kwargs) -> dict: return {"error": "not available"}
    async def find_control(**kwargs) -> dict: return {"error": "not available"}
    async def click_control(**kwargs) -> dict: return {"error": "not available"}
    async def get_control_text(**kwargs) -> dict: return {"error": "not available"}

try:
    from .input import type_text, hotkey, mouse_click
except Exception:
    async def type_text(**kwargs) -> dict: return {"error": "not available"}
    async def hotkey(**kwargs) -> dict: return {"error": "not available"}
    async def mouse_click(**kwargs) -> dict: return {"error": "not available"}

try:
    from .clipboard import get_clipboard, set_clipboard
except Exception:
    async def get_clipboard(**kwargs) -> dict: return {"error": "not available"}
    async def set_clipboard(**kwargs) -> dict: return {"error": "not available"}

try:
    from .com_outlook import get_emails, send_email, reply_email, move_email
except Exception:
    async def get_emails(**kwargs) -> dict: return {"error": "not available"}
    async def send_email(**kwargs) -> dict: return {"error": "not available"}
    async def reply_email(**kwargs) -> dict: return {"error": "not available"}
    async def move_email(**kwargs) -> dict: return {"error": "not available"}

try:
    from .shell import run_app, shell_exec
except Exception:
    async def run_app(**kwargs) -> dict: return {"error": "not available"}
    async def shell_exec(**kwargs) -> dict: return {"error": "not available"}


TOOL_REGISTRY: dict[str, Callable] = {
    "desktop_screenshot": screenshot,
    "desktop_list_windows": list_windows,
    "desktop_find_control": find_control,
    "desktop_click_control": click_control,
    "desktop_get_control_text": get_control_text,
    "desktop_type_text": type_text,
    "desktop_hotkey": hotkey,
    "desktop_mouse_click": mouse_click,
    "desktop_get_clipboard": get_clipboard,
    "desktop_set_clipboard": set_clipboard,
    "desktop_outlook_get_emails": get_emails,
    "desktop_outlook_send_email": send_email,
    "desktop_outlook_reply": reply_email,
    "desktop_outlook_move": move_email,
    "desktop_run_app": run_app,
    "desktop_shell": shell_exec,
}
