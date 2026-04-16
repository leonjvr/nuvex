"""Backward-compat shim — plugin_provider.py moved to brain/plugins/provider.py."""
from src.brain.plugins.provider import (  # noqa: F401
    _provider_registry,
    register_provider_model,
    get_provider_registry,
    has_plugin_provider,
    PluginChatModel,
)
