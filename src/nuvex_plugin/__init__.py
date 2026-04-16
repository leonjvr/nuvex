"""nuvex_plugin — Plugin SDK for NUVEX.

Public exports for plugin authors.
"""
from __future__ import annotations

from .sdk import (
    PluginAPI,
    ExecutionContext,
    HookResult,
    define_plugin,
    PluginDefinitionError,
    PluginConflictError,
    PluginPermissionError,
    PermissionDeniedError,
)
from .permissions import (
    PluginHttpClient,
    PluginEnvAccessor,
    PluginFileAccessor,
    PluginDbSession,
)

__all__ = [
    "define_plugin",
    "PluginAPI",
    "HookResult",
    "ExecutionContext",
    "PluginDefinitionError",
    "PluginConflictError",
    "PluginPermissionError",
    "PermissionDeniedError",
    "PluginHttpClient",
    "PluginEnvAccessor",
    "PluginFileAccessor",
    "PluginDbSession",
]
