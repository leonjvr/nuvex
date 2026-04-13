"""Desktop device orchestration package — exports DeviceRegistry and DesktopToolCallTool."""
from __future__ import annotations

from .registry import DeviceRegistry
from .tool import DesktopToolCallTool

__all__ = ["DeviceRegistry", "DesktopToolCallTool"]
