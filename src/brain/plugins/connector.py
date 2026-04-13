"""Connector pool manager for plugin connectors (§13)."""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Callable

logger = logging.getLogger(__name__)

_HEALTH_CHECK_INTERVAL = 60  # seconds
_FAILURE_THRESHOLD = 3


class ConnectorPool:
    """Manages a per-plugin connector with lazy init, health monitoring, and graceful shutdown."""

    def __init__(
        self,
        plugin_id: str,
        name: str,
        connect_fn: Callable,
        health_check_fn: Callable,
        config: dict[str, Any],
    ) -> None:
        self.plugin_id = plugin_id
        self.name = name
        self._connect_fn = connect_fn
        self._health_fn = health_check_fn
        self._config = config
        self._connection: Any = None
        self._healthy = False
        self._failure_count = 0
        self._health_task: asyncio.Task | None = None

    async def connect(self) -> None:
        """Lazily initialise the connection."""
        try:
            self._connection = await self._connect_fn(self._config)
            self._healthy = True
            self._failure_count = 0
            logger.info("Connector '%s' (plugin=%s) connected", self.name, self.plugin_id)
        except Exception as exc:
            logger.warning("Connector '%s' connect failed: %s", self.name, exc)
            self._healthy = False

    async def _run_health_checks(self) -> None:
        while True:
            await asyncio.sleep(_HEALTH_CHECK_INTERVAL)
            try:
                ok = await self._health_fn(self._connection)
                if ok:
                    if not self._healthy:
                        logger.info("Connector '%s' recovered", self.name)
                    self._healthy = True
                    self._failure_count = 0
                else:
                    await self._handle_failure()
            except Exception as exc:
                logger.warning("Connector '%s' health check raised: %s", self.name, exc)
                await self._handle_failure()

    async def _handle_failure(self) -> None:
        self._failure_count += 1
        if self._failure_count >= _FAILURE_THRESHOLD:
            if self._healthy:
                logger.error(
                    "Connector '%s' unhealthy after %d consecutive failures",
                    self.name, self._failure_count
                )
            self._healthy = False

    def start_health_monitor(self) -> None:
        self._health_task = asyncio.create_task(self._run_health_checks())

    async def shutdown(self) -> None:
        if self._health_task:
            self._health_task.cancel()
        if self._connection and hasattr(self._connection, "close"):
            try:
                await self._connection.close()
            except Exception:
                pass

    @property
    def is_healthy(self) -> bool:
        return self._healthy


class RestConnectorBase:
    """Base class for REST-based connectors (§13.4)."""

    def __init__(
        self,
        base_url: str,
        auth_config: dict[str, Any] | None = None,
        retry_count: int = 3,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self._auth_config = auth_config or {}
        self._retry_count = retry_count

    def _auth_headers(self) -> dict[str, str]:
        headers: dict[str, str] = {}
        bearer = self._auth_config.get("bearer_token")
        if bearer:
            headers["Authorization"] = f"Bearer {bearer}"
        api_key = self._auth_config.get("api_key")
        api_key_header = self._auth_config.get("api_key_header", "X-API-Key")
        if api_key:
            headers[api_key_header] = api_key
        return headers

    async def _request(self, method: str, path: str, **kwargs: Any) -> Any:
        import httpx
        url = f"{self.base_url}/{path.lstrip('/')}"
        headers = {**self._auth_headers(), **kwargs.pop("headers", {})}
        last_exc: Exception | None = None
        for attempt in range(self._retry_count):
            try:
                async with httpx.AsyncClient() as client:
                    resp = await client.request(method, url, headers=headers, **kwargs)
                    resp.raise_for_status()
                    return resp.json()
            except Exception as exc:
                last_exc = exc
                if attempt < self._retry_count - 1:
                    await asyncio.sleep(2 ** attempt)
        raise last_exc  # type: ignore[misc]

    async def get(self, path: str, **kwargs: Any) -> Any:
        return await self._request("GET", path, **kwargs)

    async def post(self, path: str, **kwargs: Any) -> Any:
        return await self._request("POST", path, **kwargs)

    async def put(self, path: str, **kwargs: Any) -> Any:
        return await self._request("PUT", path, **kwargs)

    async def delete(self, path: str, **kwargs: Any) -> Any:
        return await self._request("DELETE", path, **kwargs)
