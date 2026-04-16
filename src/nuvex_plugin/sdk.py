"""Plugin SDK — define_plugin decorator, PluginAPI, ExecutionContext, HookResult.

Public surface for plugin authors.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Callable

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------

class PluginDefinitionError(Exception):
    """Raised when a plugin is configured incorrectly (e.g. missing id)."""


class PluginConflictError(Exception):
    """Raised when a duplicate tool/connector name is registered."""


class PluginPermissionError(Exception):
    """Raised when a plugin attempts a registration outside its allowed range."""


class PermissionDeniedError(Exception):
    """Raised at runtime when a plugin call exceeds its declared permissions."""


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class ExecutionContext:
    """Runtime context passed to a plugin tool's execute function."""
    agent_id: str
    thread_id: str
    org_id: str = "default"
    plugin_config: dict[str, Any] = field(default_factory=dict)


@dataclass
class HookResult:
    """Return value from a plugin hook function."""
    block: bool = False
    require_approval: bool = False
    reason: str | None = None


# ---------------------------------------------------------------------------
# PluginAPI
# ---------------------------------------------------------------------------

class PluginAPI:
    """Constructed by the loader; passed to the plugin's registration function."""

    def __init__(self, plugin_id: str, name: str, permissions: list[str]) -> None:
        self.plugin_id = plugin_id
        self.name = name
        self.permissions = list(permissions)

        self._tools: dict[str, dict[str, Any]] = {}
        self._connectors: dict[str, dict[str, Any]] = {}
        self._providers: dict[str, dict[str, Any]] = {}
        self._channels: dict[str, dict[str, Any]] = {}
        self._hooks: list[dict[str, Any]] = []
        self._config_schema: dict[str, Any] = {}
        self._http_routes: list[dict[str, Any]] = []
        self._shutdown_fn: Callable | None = None

    # ------------------------------------------------------------------
    # Registration methods
    # ------------------------------------------------------------------

    def register_tool(
        self,
        name: str,
        description: str,
        input_schema: Any,
        execute: Callable,
        optional: bool = False,
    ) -> None:
        """Register a tool. Raises PluginConflictError on duplicate name."""
        if name in self._tools:
            raise PluginConflictError(
                f"Plugin '{self.plugin_id}' already registered a tool named '{name}'"
            )
        # Validate that input_schema is a Pydantic BaseModel subclass
        try:
            from pydantic import BaseModel
            if not (isinstance(input_schema, type) and issubclass(input_schema, BaseModel)):
                raise PluginDefinitionError(
                    f"input_schema for tool '{name}' must be a Pydantic BaseModel subclass"
                )
        except ImportError:
            pass
        self._tools[name] = {
            "name": name,
            "description": description,
            "input_schema": input_schema,
            "execute": execute,
            "optional": optional,
        }

    def register_connector(
        self,
        name: str,
        config_schema: Any,
        connect: Callable,
        health_check: Callable,
    ) -> None:
        self._connectors[name] = {
            "name": name,
            "config_schema": config_schema,
            "connect": connect,
            "health_check": health_check,
        }

    def register_provider(
        self,
        id: str,
        name: str,
        models: list[str],
        invoke: Callable,
        config_schema: Any = None,
    ) -> None:
        self._providers[id] = {
            "id": id,
            "name": name,
            "models": models,
            "invoke": invoke,
            "config_schema": config_schema,
        }

    def register_channel(
        self,
        id: str,
        name: str,
        send: Callable,
        receive: Callable,
        health_check: Callable,
    ) -> None:
        self._channels[id] = {
            "id": id,
            "name": name,
            "send": send,
            "receive": receive,
            "health_check": health_check,
        }

    def register_hook(self, event: str, handler: Callable, priority: int = 100) -> None:
        """Register a hook. Priority must be >= 100 for plugins."""
        if priority < 100:
            raise PluginPermissionError(
                f"Plugin '{self.plugin_id}' attempted to register hook '{event}' "
                f"with priority {priority}. Plugin hooks must have priority >= 100."
            )
        self._hooks.append({"event": event, "handler": handler, "priority": priority})

    def register_config_schema(self, schema: dict[str, Any]) -> None:
        self._config_schema = schema

    def register_http_route(
        self,
        path: str,
        handler: Callable,
        methods: list[str],
    ) -> None:
        self._http_routes.append({"path": path, "handler": handler, "methods": methods})

    def on_shutdown(self, fn: Callable) -> None:
        """Register a shutdown callback."""
        self._shutdown_fn = fn


# ---------------------------------------------------------------------------
# define_plugin decorator
# ---------------------------------------------------------------------------

def define_plugin(
    id: str | None = None,
    name: str | None = None,
    version: str = "0.1.0",
    permissions: list[str] | None = None,
    requires: list[str] | None = None,
) -> Callable:
    """Decorator that marks a function as a plugin entry point.

    Usage::

        @define_plugin(id="my-plugin", name="My Plugin")
        def register(api: PluginAPI) -> None:
            api.register_tool(...)

    Raises PluginDefinitionError if *id* is missing.
    """
    if not id:
        raise PluginDefinitionError("define_plugin requires a non-empty 'id' argument.")
    if not name:
        raise PluginDefinitionError(
            f"define_plugin for id='{id}' requires a non-empty 'name' argument."
        )

    def decorator(fn: Callable) -> Callable:
        fn.__plugin_metadata__ = {
            "id": id,
            "name": name,
            "version": version,
            "permissions": permissions or [],
            "requires": requires or [],
        }
        return fn

    return decorator
