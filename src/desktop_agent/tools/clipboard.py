"""Clipboard tools using pyperclip."""
from __future__ import annotations


async def get_clipboard() -> dict:
    try:
        import pyperclip
        return {"content": pyperclip.paste()}
    except ImportError:
        return {"content": "", "error": "pyperclip not installed"}
    except Exception as exc:
        return {"content": "", "error": str(exc)}


async def set_clipboard(text: str) -> dict:
    try:
        import pyperclip
        pyperclip.copy(text)
        return {"set": True}
    except ImportError:
        return {"set": False, "error": "pyperclip not installed"}
    except Exception as exc:
        return {"set": False, "error": str(exc)}
