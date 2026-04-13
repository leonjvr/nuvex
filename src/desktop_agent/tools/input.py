"""Keyboard, mouse, and clipboard input tools."""
from __future__ import annotations

import sys


async def type_text(text: str, interval: float = 0.02) -> dict:
    try:
        from pynput.keyboard import Controller
        kb = Controller()
        for ch in text:
            kb.type(ch)
            if interval > 0:
                import asyncio
                await asyncio.sleep(interval)
        return {"typed": True, "length": len(text)}
    except ImportError:
        return {"typed": False, "error": "pynput not installed"}
    except Exception as exc:
        return {"typed": False, "error": str(exc)}


async def hotkey(keys: list[str]) -> dict:
    try:
        import pyautogui
        pyautogui.hotkey(*keys)
        return {"sent": True, "keys": keys}
    except ImportError:
        return {"sent": False, "error": "pyautogui not installed"}
    except Exception as exc:
        return {"sent": False, "error": str(exc)}


async def mouse_click(x: int, y: int, button: str = "left") -> dict:
    try:
        import pyautogui
        pyautogui.click(x, y, button=button)
        return {"clicked": True, "x": x, "y": y}
    except ImportError:
        return {"clicked": False, "error": "pyautogui not installed"}
    except Exception as exc:
        return {"clicked": False, "error": str(exc)}
