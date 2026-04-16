"""API tests: download metadata endpoint — 16.12"""
from __future__ import annotations

import pytest
from unittest.mock import patch


class TestDownloadMetadata:
    """16.12 — GET /downloads/desktop-agent/latest returns correct platform status."""

    @pytest.mark.asyncio
    async def test_returns_windows_available(self):
        from src.dashboard.routers.downloads import get_latest_metadata
        result = await get_latest_metadata()
        assert "version" in result
        assert "platforms" in result
        platforms = result["platforms"]
        windows = next((p for p in platforms if p["id"] == "windows"), None)
        assert windows is not None
        assert windows["coming_soon"] is False

    @pytest.mark.asyncio
    async def test_macos_and_linux_coming_soon(self):
        from src.dashboard.routers.downloads import get_latest_metadata
        result = await get_latest_metadata()
        platforms = result["platforms"]
        macos = next((p for p in platforms if p["id"] == "macos"), None)
        linux = next((p for p in platforms if p["id"] == "linux"), None)
        assert macos is not None and macos["coming_soon"] is True
        assert linux is not None and linux["coming_soon"] is True

    @pytest.mark.asyncio
    async def test_file_endpoint_404_for_coming_soon(self):
        from src.dashboard.routers.downloads import download_file
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc_info:
            await download_file("macos")
        assert exc_info.value.status_code == 404

    @pytest.mark.asyncio
    async def test_file_endpoint_404_when_no_binary(self):
        from src.dashboard.routers.downloads import download_file
        from fastapi import HTTPException
        with patch("src.dashboard.routers.downloads.os.environ.get", return_value=""):
            with pytest.raises(HTTPException) as exc_info:
                await download_file("windows")
        assert exc_info.value.status_code == 404

    @pytest.mark.asyncio
    async def test_unknown_platform_raises_404(self):
        from src.dashboard.routers.downloads import download_file
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc_info:
            await download_file("haiku-os")
        assert exc_info.value.status_code == 404
