"""Backward-compat shim — plugin_connector.py moved to brain/plugins/connector.py."""
from src.brain.plugins.connector import ConnectorPool, _FAILURE_THRESHOLD  # noqa: F401
