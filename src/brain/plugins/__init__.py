"""Brain plugins package — plugin loader, connector, provider, channel, and converter."""
from .loader import load_plugins, shutdown_plugins, get_loaded_plugins, get_tools_for_plugin
from .connector import ConnectorPool
from .provider import register_provider_model
from .channel import register_channel
from .converter import convert_typebox
from .cli import main_plugins, import_plugin

__all__ = [
    "load_plugins", "shutdown_plugins", "get_loaded_plugins", "get_tools_for_plugin",
    "ConnectorPool",
    "register_provider_model",
    "register_channel",
    "convert_typebox",
    "main_plugins",
    "import_plugin",
]
