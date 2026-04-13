"""Backward-compat shim — plugin_loader.py moved to brain/plugins/loader.py."""
from src.brain.plugins.loader import (  # noqa: F401
    _loaded_plugins,
    _load_plugin_fn,
    _load_from_entry_points,
    _load_from_directory,
    _load_from_skills,
    _register_plugin,
    get_loaded_plugins,
    get_tools_for_plugin,
    get_tools_for_agent,
    load_plugins,
    shutdown_plugins,
)
