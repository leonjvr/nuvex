"""Unit tests for Section 2 — Fernet encryption helpers."""
from __future__ import annotations

import pytest
from cryptography.fernet import Fernet


class TestEncryptDecrypt:
    """2.1 — encrypt_env / decrypt_env round-trip and error cases."""

    def setup_method(self):
        self.key = Fernet.generate_key().decode()

    def test_round_trip(self):
        from src.shared.crypto import encrypt_env, decrypt_env
        data = {"API_KEY": "secret", "DB_PASS": "hunter2"}
        token = encrypt_env(data, key=self.key)
        result = decrypt_env(token, key=self.key)
        assert result == data

    def test_encrypts_to_bytes(self):
        from src.shared.crypto import encrypt_env
        data = {"FOO": "bar"}
        token = encrypt_env(data, key=self.key)
        assert isinstance(token, bytes)

    def test_missing_key_raises(self, monkeypatch):
        monkeypatch.delenv("NUVEX_SECRET_KEY", raising=False)
        from src.shared.crypto import encrypt_env
        with pytest.raises(ValueError, match="NUVEX_SECRET_KEY"):
            encrypt_env({"X": "1"})

    def test_missing_key_decrypt_raises(self, monkeypatch):
        monkeypatch.delenv("NUVEX_SECRET_KEY", raising=False)
        from src.shared.crypto import decrypt_env
        with pytest.raises(ValueError, match="NUVEX_SECRET_KEY"):
            decrypt_env(b"bogus")

    def test_uses_env_var_as_key(self, monkeypatch):
        monkeypatch.setenv("NUVEX_SECRET_KEY", self.key)
        from src.shared.crypto import encrypt_env, decrypt_env
        data = {"ENV_KEY": "via-env"}
        token = encrypt_env(data)
        result = decrypt_env(token)
        assert result == data

    def test_empty_dict_round_trip(self):
        from src.shared.crypto import encrypt_env, decrypt_env
        data: dict = {}
        token = encrypt_env(data, key=self.key)
        assert decrypt_env(token, key=self.key) == {}

    def test_wrong_key_raises(self):
        from src.shared.crypto import encrypt_env, decrypt_env
        from cryptography.fernet import InvalidToken
        other_key = Fernet.generate_key().decode()
        token = encrypt_env({"X": "1"}, key=self.key)
        with pytest.raises(InvalidToken):
            decrypt_env(token, key=other_key)
