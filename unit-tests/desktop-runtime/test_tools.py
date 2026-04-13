"""Unit tests: Outlook COM tools with mock — 16.8"""
from __future__ import annotations

import sys
import pytest
from unittest.mock import AsyncMock, MagicMock, patch


class TestOutlookGetEmails:
    """16.8a — mock win32com, verify get_emails."""

    @pytest.mark.asyncio
    async def test_get_emails_returns_list(self):
        mock_mail = MagicMock()
        mock_mail.Subject = "Hello"
        mock_mail.SenderEmailAddress = "sender@example.com"
        mock_mail.ReceivedTime = "2026-01-01"
        mock_mail.Body = "Body text"
        mock_mail.EntryID = "entry-001"

        mock_items = [mock_mail]
        mock_items_obj = MagicMock()
        mock_items_obj.__iter__ = MagicMock(return_value=iter(mock_items))
        mock_items_obj.Sort = MagicMock()

        mock_folder = MagicMock()
        mock_folder.Items = mock_items_obj
        mock_folder.Parent = MagicMock()

        mock_ns = MagicMock()
        mock_ns.GetDefaultFolder.return_value = mock_folder

        mock_outlook = MagicMock()
        mock_outlook.GetNamespace.return_value = mock_ns

        with patch.dict(sys.modules, {
            "win32com": MagicMock(), "win32com.client": MagicMock(),
            "pywintypes": MagicMock(),
        }):
            with patch("src.desktop_agent.tools.com_outlook._get_outlook", return_value=mock_outlook), \
                 patch("src.desktop_agent.tools.com_outlook.sys") as mock_sys:
                mock_sys.platform = "win32"
                from src.desktop_agent.tools.com_outlook import get_emails
                result = await get_emails(folder="Inbox", count=5)

        assert "emails" in result
        assert len(result["emails"]) == 1
        assert result["emails"][0]["subject"] == "Hello"

    @pytest.mark.asyncio
    async def test_send_email_succeeds(self):
        mock_mail = MagicMock()
        mock_outlook = MagicMock()
        mock_outlook.CreateItem.return_value = mock_mail

        with patch.dict(sys.modules, {
            "win32com": MagicMock(), "win32com.client": MagicMock(),
            "pywintypes": MagicMock(),
        }):
            with patch("src.desktop_agent.tools.com_outlook._get_outlook", return_value=mock_outlook), \
                 patch("src.desktop_agent.tools.com_outlook.sys") as mock_sys:
                mock_sys.platform = "win32"
                from src.desktop_agent.tools.com_outlook import send_email
                result = await send_email(to="test@example.com", subject="Test", body="Hello")

        assert result["sent"] is True
        assert "test@example.com" in result["to"]
        mock_mail.Send.assert_called_once()

    @pytest.mark.asyncio
    async def test_reply_email(self):
        mock_reply = MagicMock()
        mock_reply.Body = ""
        mock_mail = MagicMock()
        mock_mail.Reply.return_value = mock_reply
        mock_mail.Subject = "Re: Test"

        mock_ns = MagicMock()
        mock_ns.GetItemFromID.return_value = mock_mail
        mock_outlook = MagicMock()
        mock_outlook.GetNamespace.return_value = mock_ns

        with patch.dict(sys.modules, {
            "win32com": MagicMock(), "win32com.client": MagicMock(),
            "pywintypes": MagicMock(),
        }):
            with patch("src.desktop_agent.tools.com_outlook._get_outlook", return_value=mock_outlook), \
                 patch("src.desktop_agent.tools.com_outlook.sys") as mock_sys:
                mock_sys.platform = "win32"
                from src.desktop_agent.tools.com_outlook import reply_email
                result = await reply_email(entry_id="entry-001", body="My reply")

        assert result["replied"] is True
        mock_reply.Send.assert_called_once()

    @pytest.mark.asyncio
    async def test_move_email(self):
        mock_target_folder = MagicMock()
        mock_target_folder.Name = "Archive"
        mock_folder_collection = MagicMock()
        mock_folder_collection.Count = 1
        mock_folder_collection.__getitem__ = MagicMock(return_value=mock_target_folder)
        mock_parent = MagicMock()
        mock_parent.Folders = mock_folder_collection
        mock_inbox = MagicMock()
        mock_inbox.Parent = mock_parent

        mock_mail = MagicMock()
        mock_ns = MagicMock()
        mock_ns.GetItemFromID.return_value = mock_mail
        mock_ns.GetDefaultFolder.return_value = mock_inbox

        mock_outlook = MagicMock()
        mock_outlook.GetNamespace.return_value = mock_ns

        with patch.dict(sys.modules, {
            "win32com": MagicMock(), "win32com.client": MagicMock(),
            "pywintypes": MagicMock(),
        }):
            with patch("src.desktop_agent.tools.com_outlook._get_outlook", return_value=mock_outlook), \
                 patch("src.desktop_agent.tools.com_outlook.sys") as mock_sys:
                mock_sys.platform = "win32"
                from src.desktop_agent.tools.com_outlook import move_email
                result = await move_email(entry_id="entry-001", target_folder="Archive")

        assert result["moved"] is True
        mock_mail.Move.assert_called_once()
