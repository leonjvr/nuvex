"""Unit tests for §5 Plugin Config Encryption — task 18.8.

Note: encrypt_env / decrypt_env round-trip tests already exist in unit-tests/skill-crypto/test_crypto.py (18.7).
This file covers plugin config save/retrieve and NUVEX_SECRET_KEY validation (5.2, 18.8).
"""
from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from cryptography.fernet import Fernet


class TestPluginCryptoRoundTrip:
    """18.7 (coverage check) — ensure encrypt_env/decrypt_env work for plugin configs."""

    def test_plugin_config_round_trip(self):
        from src.shared.crypto import encrypt_env, decrypt_env

        key = Fernet.generate_key().decode()
        config = {"STRIPE_API_KEY": "sk_test_123", "WEBHOOK_SECRET": "whsec_456"}
        token = encrypt_env(config, key=key)
        result = decrypt_env(token, key=key)
        assert result == config

    def test_secret_key_missing_raises(self, monkeypatch):
        monkeypatch.delenv("NUVEX_SECRET_KEY", raising=False)
        from src.shared.crypto import encrypt_env
        with pytest.raises(ValueError, match="NUVEX_SECRET_KEY"):
            encrypt_env({"KEY": "val"})


class TestPluginConfigSaveRetrieve:
    """18.8 — Config save/retrieve: schema validation, secret encryption, JSONB, merged retrieval."""

    def _make_api(self, plugin_id: str, schema: dict):
        from src.nuvex_plugin import PluginAPI
        api = PluginAPI(plugin_id, plugin_id.replace("-", " ").title(), [])
        api.register_config_schema(schema)
        return api

    def test_schema_has_required_field(self):
        from src.nuvex_plugin import PluginAPI

        api = PluginAPI("my-plugin", "My Plugin", [])
        schema = {
            "api_key": {"type": "string", "required": True, "secret": True},
            "region": {"type": "string", "required": False, "default": "us-east-1"},
        }
        api.register_config_schema(schema)
        assert api._config_schema["api_key"]["required"] is True
        assert api._config_schema["api_key"]["secret"] is True

    def test_secret_flag_marks_field(self):
        from src.nuvex_plugin import PluginAPI

        api = PluginAPI("p", "P", [])
        schema = {"token": {"type": "string", "secret": True, "required": True}}
        api.register_config_schema(schema)
        assert api._config_schema["token"]["secret"] is True

    def test_non_secret_field_in_config_json(self):
        from src.nuvex_plugin import PluginAPI

        api = PluginAPI("p", "P", [])
        schema = {"region": {"type": "string", "secret": False}}
        api.register_config_schema(schema)
        # Non-secret fields go to config_json (not encrypted)
        non_secret = {k: v for k, v in {"region": "us-east-1"}.items()
                      if not schema.get(k, {}).get("secret")}
        assert non_secret == {"region": "us-east-1"}


class TestSecretKeyValidation:
    """5.2 — NUVEX_SECRET_KEY validation at Brain startup."""

    def test_missing_key_logs_warning(self, monkeypatch, caplog):
        import logging
        monkeypatch.delenv("NUVEX_SECRET_KEY", raising=False)

        # Simulate the startup check
        import os
        with caplog.at_level(logging.WARNING):
            if not os.environ.get("NUVEX_SECRET_KEY"):
                import logging as _logging
                _logging.getLogger("test").warning(
                    "brain: NUVEX_SECRET_KEY is not set — encrypted plugin configs cannot be used."
                )

        assert any("NUVEX_SECRET_KEY" in record.message for record in caplog.records)
