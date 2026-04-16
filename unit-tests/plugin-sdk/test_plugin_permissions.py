"""Unit tests for §2 Plugin Permissions Enforcement."""
from __future__ import annotations

import os
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


class TestPluginHttpClient:
    """18.3 — PluginHttpClient permission gate."""

    def test_created_with_network_permission(self):
        from src.nuvex_plugin.permissions import PluginHttpClient

        client = PluginHttpClient("my-plugin", ["network"])
        assert client._plugin_id == "my-plugin"

    def test_denied_without_network_permission(self):
        from src.nuvex_plugin import PermissionDeniedError
        from src.nuvex_plugin.permissions import PluginHttpClient

        with pytest.raises(PermissionDeniedError):
            PluginHttpClient("my-plugin", ["env:API_KEY"])

    def test_denial_logged(self, caplog):
        import logging
        from src.nuvex_plugin import PermissionDeniedError
        from src.nuvex_plugin.permissions import PluginHttpClient

        with caplog.at_level(logging.WARNING, logger="src.nuvex_plugin.permissions"):
            with pytest.raises(PermissionDeniedError):
                PluginHttpClient("bad-plugin", [])

        assert "PLUGIN PERMISSION DENIED" in caplog.text
        assert "bad-plugin" in caplog.text


class TestPluginEnvAccessor:
    """18.3 — get_env() pattern matching."""

    def test_exact_match_allowed(self, monkeypatch):
        from src.nuvex_plugin.permissions import PluginEnvAccessor

        monkeypatch.setenv("MY_API_KEY", "secret")
        acc = PluginEnvAccessor("p", ["env:MY_API_KEY"], {})
        assert acc.get_env("MY_API_KEY") == "secret"

    def test_glob_match_allowed(self, monkeypatch):
        from src.nuvex_plugin.permissions import PluginEnvAccessor

        monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test")
        acc = PluginEnvAccessor("p", ["env:STRIPE_*"], {})
        assert acc.get_env("STRIPE_SECRET_KEY") == "sk_test"

    def test_no_match_raises(self, monkeypatch):
        from src.nuvex_plugin import PermissionDeniedError
        from src.nuvex_plugin.permissions import PluginEnvAccessor

        acc = PluginEnvAccessor("p", ["env:MY_KEY"], {})
        with pytest.raises(PermissionDeniedError):
            acc.get_env("OTHER_KEY")

    def test_plugin_config_takes_precedence(self, monkeypatch):
        from src.nuvex_plugin.permissions import PluginEnvAccessor

        monkeypatch.setenv("API_KEY", "from-env")
        acc = PluginEnvAccessor("p", ["env:API_KEY"], {"API_KEY": "from-config"})
        assert acc.get_env("API_KEY") == "from-config"

    def test_denial_logged(self, caplog):
        import logging
        from src.nuvex_plugin import PermissionDeniedError
        from src.nuvex_plugin.permissions import PluginEnvAccessor

        acc = PluginEnvAccessor("p", [], {})
        with caplog.at_level(logging.WARNING, logger="src.nuvex_plugin.permissions"):
            with pytest.raises(PermissionDeniedError):
                acc.get_env("SECRET")

        assert "PLUGIN PERMISSION DENIED" in caplog.text


class TestPluginFileAccessor:
    """18.3 — read_file/write_file path checking."""

    def test_read_within_allowed_path(self, tmp_path):
        from src.nuvex_plugin.permissions import PluginFileAccessor

        f = tmp_path / "test.txt"
        f.write_bytes(b"hello")
        acc = PluginFileAccessor("p", [f"filesystem:{tmp_path}"])
        result = acc.read_file(str(f))
        assert result == b"hello"

    def test_read_outside_allowed_path_raises(self, tmp_path):
        from src.nuvex_plugin import PermissionDeniedError
        from src.nuvex_plugin.permissions import PluginFileAccessor

        other = tmp_path / "other"
        other.mkdir()
        allowed = tmp_path / "allowed"
        allowed.mkdir()
        f = other / "test.txt"
        f.write_bytes(b"secret")

        acc = PluginFileAccessor("p", [f"filesystem:{allowed}"])
        with pytest.raises(PermissionDeniedError):
            acc.read_file(str(f))

    def test_write_within_allowed_path(self, tmp_path):
        from src.nuvex_plugin.permissions import PluginFileAccessor

        acc = PluginFileAccessor("p", [f"filesystem:{tmp_path}"])
        f = tmp_path / "out.txt"
        acc.write_file(str(f), b"data")
        assert f.read_bytes() == b"data"

    def test_write_outside_allowed_path_raises(self, tmp_path):
        from src.nuvex_plugin import PermissionDeniedError
        from src.nuvex_plugin.permissions import PluginFileAccessor

        sub = tmp_path / "sub"
        sub.mkdir()
        f = tmp_path / "out.txt"

        acc = PluginFileAccessor("p", [f"filesystem:{sub}"])
        with pytest.raises(PermissionDeniedError):
            acc.write_file(str(f), b"data")


class TestPluginDbSession:
    """18.3 — PluginDbSession permission gate."""

    def _mock_session(self):
        session = MagicMock()
        session.execute = MagicMock(return_value=MagicMock())
        return session

    def test_created_with_db_read(self):
        from src.nuvex_plugin.permissions import PluginDbSession

        sess = self._mock_session()
        db = PluginDbSession("p", ["db:read"], sess)
        assert db._has_read is True
        assert db._has_write is False

    def test_created_with_db_write(self):
        from src.nuvex_plugin.permissions import PluginDbSession

        sess = self._mock_session()
        db = PluginDbSession("p", ["db:write"], sess)
        assert db._has_write is True

    def test_no_permission_raises(self):
        from src.nuvex_plugin import PermissionDeniedError
        from src.nuvex_plugin.permissions import PluginDbSession

        sess = self._mock_session()
        with pytest.raises(PermissionDeniedError):
            PluginDbSession("p", [], sess)

    def test_add_raises_without_write(self):
        from src.nuvex_plugin import PermissionDeniedError
        from src.nuvex_plugin.permissions import PluginDbSession

        sess = self._mock_session()
        db = PluginDbSession("p", ["db:read"], sess)
        with pytest.raises(PermissionDeniedError):
            db.add(object())

    def test_commit_raises_without_write(self):
        from src.nuvex_plugin import PermissionDeniedError
        from src.nuvex_plugin.permissions import PluginDbSession

        sess = self._mock_session()
        db = PluginDbSession("p", ["db:read"], sess)
        with pytest.raises(PermissionDeniedError):
            db.commit()

    def test_execute_allowed_with_read(self):
        from src.nuvex_plugin.permissions import PluginDbSession

        sess = self._mock_session()
        db = PluginDbSession("p", ["db:read"], sess)
        db.execute("SELECT 1")
        sess.execute.assert_called_once_with("SELECT 1")
