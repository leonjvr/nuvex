"""Windows UIA automation tools using pywinauto."""
from __future__ import annotations

import sys


async def list_windows() -> dict:
    if sys.platform != "win32":
        return {"windows": [], "error": "Windows only"}
    try:
        from pywinauto import Desktop
        wins = Desktop(backend="uia").windows()
        return {"windows": [
            {
                "title": w.window_text(),
                "class_name": w.class_name(),
                "pid": w.process_id(),
                "rect": _rect(w),
            }
            for w in wins
        ]}
    except Exception as exc:
        return {"windows": [], "error": str(exc)}


async def find_control(
    window_title: str,
    control_type: str | None = None,
    name: str | None = None,
    automation_id: str | None = None,
) -> dict:
    if sys.platform != "win32":
        return {"found": False, "error": "Windows only"}
    try:
        from pywinauto import Desktop
        wins = Desktop(backend="uia").windows(title_re=f".*{window_title}.*")
        if not wins:
            return {"found": False, "error": f"Window '{window_title}' not found"}
        win = wins[0]
        kwargs: dict = {}
        if control_type:
            kwargs["control_type"] = control_type
        if name:
            kwargs["name"] = name
        if automation_id:
            kwargs["auto_id"] = automation_id
        ctrl = win.child_window(**kwargs).wrapper_object()
        return {
            "found": True,
            "handle": ctrl.handle,
            "name": ctrl.window_text(),
            "control_type": ctrl.element_info.control_type,
            "rect": _rect(ctrl),
        }
    except Exception as exc:
        return {"found": False, "error": str(exc)}


async def click_control(
    window_title: str,
    name: str | None = None,
    automation_id: str | None = None,
) -> dict:
    if sys.platform != "win32":
        return {"clicked": False, "error": "Windows only"}
    try:
        from pywinauto import Desktop
        wins = Desktop(backend="uia").windows(title_re=f".*{window_title}.*")
        if not wins:
            return {"clicked": False, "error": f"Window '{window_title}' not found"}
        win = wins[0]
        kwargs: dict = {}
        if name:
            kwargs["name"] = name
        if automation_id:
            kwargs["auto_id"] = automation_id
        ctrl = win.child_window(**kwargs).wrapper_object()
        ctrl.invoke()
        return {"clicked": True, "control": ctrl.window_text()}
    except Exception as exc:
        return {"clicked": False, "error": str(exc)}


async def get_control_text(
    window_title: str,
    name: str | None = None,
    automation_id: str | None = None,
) -> dict:
    if sys.platform != "win32":
        return {"text": "", "error": "Windows only"}
    try:
        from pywinauto import Desktop
        wins = Desktop(backend="uia").windows(title_re=f".*{window_title}.*")
        if not wins:
            return {"text": "", "error": f"Window '{window_title}' not found"}
        win = wins[0]
        kwargs: dict = {}
        if name:
            kwargs["name"] = name
        if automation_id:
            kwargs["auto_id"] = automation_id
        ctrl = win.child_window(**kwargs).wrapper_object()
        text = ctrl.get_value() if hasattr(ctrl, "get_value") else ctrl.window_text()
        return {"text": text}
    except Exception as exc:
        return {"text": "", "error": str(exc)}


def _rect(w) -> dict:
    try:
        r = w.rectangle()
        return {"left": r.left, "top": r.top, "right": r.right, "bottom": r.bottom}
    except Exception:
        return {}
