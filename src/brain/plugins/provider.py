"""Provider plugin support — registry and LangChain ChatModel adapter (§14)."""
from __future__ import annotations

import logging
from typing import Any, Callable

from langchain_core.language_models import BaseChatModel

logger = logging.getLogger(__name__)

# Global registry: model_id → {invoke_fn, config}
_provider_registry: dict[str, dict[str, Any]] = {}


def register_provider_model(model_id: str, invoke_fn: Callable, config: dict[str, Any]) -> None:
    """Register a plugin provider's model in the global registry."""
    if model_id in _provider_registry:
        logger.warning("Provider model '%s' already registered — overwriting", model_id)
    _provider_registry[model_id] = {"invoke": invoke_fn, "config": config}


def get_provider_registry() -> dict[str, dict[str, Any]]:
    return dict(_provider_registry)


def has_plugin_provider(model_id: str) -> bool:
    return model_id in _provider_registry


class PluginChatModel(BaseChatModel):
    """LangChain BaseChatModel wrapper for plugin providers (§14.2)."""

    model_name: str = ""
    plugin_id: str = ""
    _invoke_fn: Any = None  # Callable
    _plugin_config: dict[str, Any] = {}

    class Config:
        arbitrary_types_allowed = True

    @property
    def _llm_type(self) -> str:
        return f"plugin:{self.plugin_id}"

    def _generate(self, messages: Any, stop: Any = None, run_manager: Any = None, **kwargs: Any) -> Any:
        raise NotImplementedError("Use _agenerate for async support")

    async def _agenerate(self, messages: Any, stop: Any = None, run_manager: Any = None, **kwargs: Any) -> Any:
        from langchain_core.outputs import ChatGeneration, ChatResult
        result = await self._invoke_fn(
            messages=messages,
            model=self.model_name,
            config=self._plugin_config,
            tools=kwargs.get("tools", []),
        )
        if isinstance(result, str):
            from langchain_core.messages import AIMessage
            return ChatResult(generations=[ChatGeneration(message=AIMessage(content=result))])
        return result


def make_plugin_chat_model(
    model_id: str, plugin_id: str, invoke_fn: Callable, plugin_config: dict[str, Any]
) -> PluginChatModel:
    """Factory for PluginChatModel instances."""
    model = PluginChatModel(model_name=model_id, plugin_id=plugin_id)
    model._invoke_fn = invoke_fn
    model._plugin_config = plugin_config
    return model
