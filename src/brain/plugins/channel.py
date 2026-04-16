"""Channel plugin support — registry and routing (§15)."""
from __future__ import annotations

import logging
from typing import Any, Callable

logger = logging.getLogger(__name__)

# Global registry: channel_id → {send_fn, receive_fn, health_check_fn}
_channel_registry: dict[str, dict[str, Any]] = {}

# Per-agent channel binding: agent_id → set of channel_ids
_agent_channel_bindings: dict[str, set[str]] = {}


def register_channel(
    channel_id: str,
    send_fn: Callable,
    receive_fn: Callable,
    health_check_fn: Callable,
) -> None:
    """Register a plugin channel in the global registry."""
    if channel_id in _channel_registry:
        logger.warning("Channel '%s' already registered — overwriting", channel_id)
    _channel_registry[channel_id] = {
        "send": send_fn,
        "receive": receive_fn,
        "health_check": health_check_fn,
    }
    logger.info("Channel plugin '%s' registered", channel_id)


def bind_agent_channel(agent_id: str, channel_id: str) -> None:
    """Bind a channel to an agent for inbound routing."""
    _agent_channel_bindings.setdefault(agent_id, set()).add(channel_id)


def get_channel(channel_id: str) -> dict[str, Any] | None:
    return _channel_registry.get(channel_id)


def get_channels_for_agent(agent_id: str) -> set[str]:
    return _agent_channel_bindings.get(agent_id, set())


async def route_channel_action(channel_id: str, message: Any, config: dict[str, Any]) -> None:
    """Route an outbound message to a plugin channel's send() function."""
    entry = _channel_registry.get(channel_id)
    if not entry:
        logger.warning("No plugin channel registered for id='%s'", channel_id)
        return
    try:
        await entry["send"](message, config)
    except Exception as exc:
        logger.error("Channel '%s' send() raised: %s", channel_id, exc)


def get_channel_registry() -> dict[str, dict[str, Any]]:
    return dict(_channel_registry)
