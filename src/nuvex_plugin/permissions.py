"""Permission enforcement for plugin API calls."""
from __future__ import annotations

import fnmatch
import logging
import os
from pathlib import Path
from typing import Any

from .sdk import PermissionDeniedError

logger = logging.getLogger(__name__)


def _check_permission(plugin_id: str, permissions: list[str], required: str) -> bool:
    """Return True if *required* matches any declared permission (glob)."""
    return any(fnmatch.fnmatch(required, p) for p in permissions)


def _deny(plugin_id: str, operation: str, required_permission: str) -> None:
    """Log a security warning and raise PermissionDeniedError."""
    logger.warning(
        "PLUGIN PERMISSION DENIED | plugin=%s | operation=%s | required=%s",
        plugin_id,
        operation,
        required_permission,
    )
    raise PermissionDeniedError(
        f"Plugin '{plugin_id}' lacks permission '{required_permission}' "
        f"for operation '{operation}'"
    )


class PluginHttpClient:
    """Async HTTP client gated on the 'network' permission."""

    def __init__(self, plugin_id: str, permissions: list[str]) -> None:
        if not _check_permission(plugin_id, permissions, "network"):
            _deny(plugin_id, "create_http_client", "network")
        self._plugin_id = plugin_id

    async def request(self, method: str, url: str, **kwargs: Any) -> Any:
        import httpx
        async with httpx.AsyncClient() as client:
            response = await client.request(method, url, **kwargs)
            logger.info(
                "PLUGIN HTTP | plugin=%s | method=%s | url=%s | status=%s",
                self._plugin_id,
                method,
                url,
                response.status_code,
            )
            return response


class PluginEnvAccessor:
    """Env-var accessor gated on env:PATTERN permissions."""

    def __init__(self, plugin_id: str, permissions: list[str], plugin_config: dict[str, Any]) -> None:
        self._plugin_id = plugin_id
        self._permissions = permissions
        self._plugin_config = plugin_config

    def get_env(self, key: str) -> str | None:
        """Return value for *key* if plugin has matching env:PATTERN permission."""
        env_perms = [p[4:] for p in self._permissions if p.startswith("env:")]
        for pattern in env_perms:
            if fnmatch.fnmatch(key, pattern):
                # Check plugin_config first, then os.environ
                if key in self._plugin_config:
                    return self._plugin_config[key]
                return os.environ.get(key)
        _deny(self._plugin_id, f"get_env({key})", f"env:{key}")
        return None  # unreachable


class PluginFileAccessor:
    """File accessor gated on filesystem:PATH permissions."""

    def __init__(self, plugin_id: str, permissions: list[str]) -> None:
        self._plugin_id = plugin_id
        self._permissions = permissions

    def _check_path(self, path: str, operation: str) -> None:
        fs_perms = [p[11:] for p in self._permissions if p.startswith("filesystem:")]
        resolved = str(Path(path).resolve())
        for prefix in fs_perms:
            if resolved.startswith(str(Path(prefix).resolve())):
                return
        _deny(self._plugin_id, operation, f"filesystem:{path}")

    def read_file(self, path: str) -> bytes:
        self._check_path(path, f"read_file({path})")
        return Path(path).read_bytes()

    def write_file(self, path: str, data: bytes) -> None:
        self._check_path(path, f"write_file({path})")
        Path(path).write_bytes(data)


class PluginDbSession:
    """DB session wrapper gated on db:read / db:write permissions."""

    def __init__(self, plugin_id: str, permissions: list[str], session: Any) -> None:
        self._plugin_id = plugin_id
        self._permissions = permissions
        self._session = session
        self._has_read = _check_permission(plugin_id, permissions, "db:read")
        self._has_write = _check_permission(plugin_id, permissions, "db:write")

        if not self._has_read and not self._has_write:
            _deny(plugin_id, "create_db_session", "db:read")

    def execute(self, statement: Any, *args: Any, **kwargs: Any) -> Any:
        return self._session.execute(statement, *args, **kwargs)

    def add(self, obj: Any) -> None:
        if not self._has_write:
            _deny(self._plugin_id, "db.add()", "db:write")
        self._session.add(obj)

    def delete(self, obj: Any) -> None:
        if not self._has_write:
            _deny(self._plugin_id, "db.delete()", "db:write")
        self._session.delete(obj)

    def commit(self) -> None:
        if not self._has_write:
            _deny(self._plugin_id, "db.commit()", "db:write")
        self._session.commit()
