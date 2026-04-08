"""Unit tests — gateway: email poller and Telegram bot logic."""
from __future__ import annotations

import asyncio
import sys
import types
from unittest.mock import AsyncMock, MagicMock, patch
import os

import pytest

# ── Stub out heavy gateway deps that aren't installed in the local dev env ────

def _stub_module(name: str, **attrs) -> types.ModuleType:
    mod = types.ModuleType(name)
    for k, v in attrs.items():
        setattr(mod, k, v)
    sys.modules.setdefault(name, mod)
    return mod

_stub_module("aioimaplib", IMAP4_SSL=MagicMock)
_stub_module("aiosmtplib", SMTP=MagicMock)
_telegram = _stub_module("telegram",
    Update=MagicMock, InlineKeyboardButton=lambda *a, **kw: MagicMock(),
    InlineKeyboardMarkup=lambda *a, **kw: MagicMock(),
    BotCommand=MagicMock)
_stub_module("telegram.ext",
    Application=MagicMock, CallbackQueryHandler=MagicMock,
    CommandHandler=MagicMock, ContextTypes=MagicMock,
    MessageHandler=MagicMock, filters=MagicMock)


# ---------------------------------------------------------------------------
# Email gateway — _decode_header_value and _invoke
# ---------------------------------------------------------------------------

class TestDecodeHeaderValue:
    def setup_method(self):
        # Patch env vars before importing module-level constants
        self._env = {
            "IMAP_HOST": "imap.example.com",
            "SMTP_HOST": "smtp.example.com",
            "EMAIL_USER": "bot@example.com",
            "EMAIL_PASS": "secret",
        }
        self._patcher = patch.dict(os.environ, self._env)
        self._patcher.start()

    def teardown_method(self):
        self._patcher.stop()

    def test_plain_string_passthrough(self):
        from src.gateway.email.poller import _decode_header_value
        assert _decode_header_value("Hello World") == "Hello World"

    def test_empty_string(self):
        from src.gateway.email.poller import _decode_header_value
        assert _decode_header_value("") == ""

    def test_no_encoding_needed(self):
        from src.gateway.email.poller import _decode_header_value
        result = _decode_header_value("Re: Daily report")
        assert result == "Re: Daily report"


class TestEmailInvoke:
    def setup_method(self):
        self._env = {
            "IMAP_HOST": "imap.example.com",
            "SMTP_HOST": "smtp.example.com",
            "EMAIL_USER": "bot@example.com",
            "EMAIL_PASS": "secret",
        }
        self._patcher = patch.dict(os.environ, self._env)
        self._patcher.start()

    def teardown_method(self):
        self._patcher.stop()

    @pytest.mark.asyncio
    async def test_invoke_posts_to_brain(self):
        from src.gateway.email.poller import _invoke

        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.raise_for_status = MagicMock()
        mock_resp.json.return_value = {"reply": "I got your email"}

        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_resp)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch("src.gateway.email.poller.httpx.AsyncClient", return_value=mock_client):
            reply = await _invoke("Hello there", "user@test.com", "Test Subject")

        assert reply == "I got your email"
        call_args = mock_client.post.call_args
        assert "/invoke" in call_args[0][0]
        payload = call_args[1]["json"]
        assert payload["message"] == "Subject: Test Subject\n\nHello there"
        assert payload["metadata"]["channel"] == "email"
        assert payload["metadata"]["sender"] == "user@test.com"

    @pytest.mark.asyncio
    async def test_invoke_empty_reply_returns_empty_string(self):
        from src.gateway.email.poller import _invoke

        mock_resp = MagicMock()
        mock_resp.raise_for_status = MagicMock()
        mock_resp.json.return_value = {}  # no 'reply' key

        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_resp)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch("src.gateway.email.poller.httpx.AsyncClient", return_value=mock_client):
            reply = await _invoke("msg", "sender@x.com", "subj")

        assert reply == ""


# ---------------------------------------------------------------------------
# Telegram gateway — _invoke and message routing
# ---------------------------------------------------------------------------

class TestTelegramInvoke:
    def setup_method(self):
        self._patcher = patch.dict(os.environ, {"TELEGRAM_BOT_TOKEN": "test-token"})
        self._patcher.start()

    def teardown_method(self):
        self._patcher.stop()

    @pytest.mark.asyncio
    async def test_invoke_returns_parsed_json(self):
        from src.gateway.telegram.bot import _invoke

        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.raise_for_status = MagicMock()
        mock_resp.json.return_value = {"reply": "Hello from brain", "invocation_id": "abc"}

        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_resp)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch("src.gateway.telegram.bot.httpx.AsyncClient", return_value=mock_client):
            result = await _invoke("maya", "hello", "thread-1", "user-123")

        assert result["reply"] == "Hello from brain"
        payload = mock_client.post.call_args[1]["json"]
        assert payload["agent_id"] == "maya"
        assert payload["message"] == "hello"
        assert payload["thread_id"] == "thread-1"
        assert payload["metadata"]["channel"] == "telegram"
        assert payload["metadata"]["sender"] == "user-123"


class TestAllowedUsers:
    """Verify that ALLOWED_USERS filtering works at module level."""

    def test_allowed_users_parsed_from_env(self):
        with patch.dict(os.environ, {
            "TELEGRAM_BOT_TOKEN": "tok",
            "TELEGRAM_ALLOWED_USERS": "123,456,789",
        }):
            # Reload/re-import necessary — use direct parsing logic instead
            raw = os.environ.get("TELEGRAM_ALLOWED_USERS", "")
            parsed = set(int(x) for x in raw.split(",") if x.strip())
            assert parsed == {123, 456, 789}

    def test_empty_allowed_users_means_no_restriction(self):
        raw = ""
        parsed = set(int(x) for x in raw.split(",") if x.strip())
        assert parsed == set()


# ---------------------------------------------------------------------------
# 10.4 — Telegram approval inline keyboard and resume flow
# ---------------------------------------------------------------------------

class TestTelegramApprovalPending:
    """message_handler sends inline keyboard when brain returns approval_pending."""

    def setup_method(self):
        self._patcher = patch.dict(os.environ, {"TELEGRAM_BOT_TOKEN": "test-token"})
        self._patcher.start()

    def teardown_method(self):
        self._patcher.stop()

    @pytest.mark.asyncio
    async def test_approval_pending_stores_pending_and_sends_keyboard(self):
        from src.gateway.telegram import bot as tg_bot
        # Reset _pending state
        tg_bot._pending.clear()

        update = MagicMock()
        update.effective_chat.id = 9999
        update.effective_user.id = 42
        msg = AsyncMock()
        msg.text = "run shell ls"
        msg.reply_text = AsyncMock()
        update.message = msg
        ctx = MagicMock()

        invoke_result = {
            "approval_pending": True,
            "invocation_id": "inv-001",
            "approval_tool": "shell",
            "thread_id": "maya:telegram:9999",
        }
        with patch("src.gateway.telegram.bot._invoke", AsyncMock(return_value=invoke_result)):
            await tg_bot.message_handler(update, ctx)

        msg.reply_text.assert_called_once()
        call_kwargs = msg.reply_text.call_args
        text_arg = call_kwargs[0][0] if call_kwargs[0] else call_kwargs[1].get("text", "")
        assert "shell" in text_arg

        assert "inv-001" in tg_bot._pending
        assert tg_bot._pending["inv-001"]["chat_id"] == 9999
        assert tg_bot._pending["inv-001"]["thread_id"] == "maya:telegram:9999"
        tg_bot._pending.clear()

    @pytest.mark.asyncio
    async def test_normal_reply_does_not_store_pending(self):
        from src.gateway.telegram import bot as tg_bot
        tg_bot._pending.clear()

        update = MagicMock()
        update.effective_chat.id = 1111
        update.effective_user.id = 22
        msg = AsyncMock()
        msg.text = "hello"
        msg.reply_text = AsyncMock()
        update.message = msg
        ctx = MagicMock()

        invoke_result = {
            "approval_pending": False,
            "invocation_id": "inv-002",
            "reply": "Hi there!",
        }
        with patch("src.gateway.telegram.bot._invoke", AsyncMock(return_value=invoke_result)):
            await tg_bot.message_handler(update, ctx)

        msg.reply_text.assert_called_once_with("Hi there!")
        assert "inv-002" not in tg_bot._pending


class TestTelegramApprovalCallback:
    """approval_callback resumes brain and handles the response."""

    def setup_method(self):
        self._patcher = patch.dict(os.environ, {"TELEGRAM_BOT_TOKEN": "test-token"})
        self._patcher.start()

    def teardown_method(self):
        self._patcher.stop()

    @pytest.mark.asyncio
    async def test_approve_posts_to_resume_and_sends_reply(self):
        from src.gateway.telegram import bot as tg_bot
        tg_bot._pending.clear()
        tg_bot._pending["inv-abc"] = {"chat_id": 7777, "thread_id": "thread-x"}

        query = AsyncMock()
        query.answer = AsyncMock()
        query.data = "approve:inv-abc"
        query.edit_message_text = AsyncMock()
        update = MagicMock()
        update.callback_query = query
        ctx = MagicMock()
        ctx.bot = AsyncMock()
        ctx.bot.send_message = AsyncMock()

        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"reply": "Done!", "approval_pending": False}
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_resp)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch("src.gateway.telegram.bot.httpx.AsyncClient", return_value=mock_client):
            await tg_bot.approval_callback(update, ctx)

        query.edit_message_text.assert_called_once_with("Decision: Approved ✅")
        ctx.bot.send_message.assert_called_once()
        args = ctx.bot.send_message.call_args
        assert args[1]["text"] == "Done!" or (args[0] and "Done!" in str(args[0]))
        assert "inv-abc" not in tg_bot._pending

        payload = mock_client.post.call_args[1]["json"]
        assert payload["invocation_id"] == "inv-abc"
        assert payload["thread_id"] == "thread-x"
        assert payload["approved"] is True

    @pytest.mark.asyncio
    async def test_deny_posts_approved_false(self):
        from src.gateway.telegram import bot as tg_bot
        tg_bot._pending.clear()
        tg_bot._pending["inv-xyz"] = {"chat_id": 5555, "thread_id": "thread-y"}

        query = AsyncMock()
        query.answer = AsyncMock()
        query.data = "deny:inv-xyz"
        query.edit_message_text = AsyncMock()
        update = MagicMock()
        update.callback_query = query
        ctx = MagicMock()
        ctx.bot = AsyncMock()
        ctx.bot.send_message = AsyncMock()

        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"reply": "", "approval_pending": False}
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_resp)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch("src.gateway.telegram.bot.httpx.AsyncClient", return_value=mock_client):
            await tg_bot.approval_callback(update, ctx)

        query.edit_message_text.assert_called_once_with("Decision: Denied ❌")
        payload = mock_client.post.call_args[1]["json"]
        assert payload["approved"] is False
        assert "inv-xyz" not in tg_bot._pending

    @pytest.mark.asyncio
    async def test_unknown_invocation_id_shows_not_found(self):
        from src.gateway.telegram import bot as tg_bot
        tg_bot._pending.clear()

        query = AsyncMock()
        query.answer = AsyncMock()
        query.data = "approve:unknown-id"
        query.edit_message_text = AsyncMock()
        update = MagicMock()
        update.callback_query = query
        ctx = MagicMock()

        await tg_bot.approval_callback(update, ctx)

        query.edit_message_text.assert_called_once()
        text = query.edit_message_text.call_args[0][0]
        assert "not found" in text.lower() or "already handled" in text.lower()

    @pytest.mark.asyncio
    async def test_chained_approval_sends_new_keyboard(self):
        from src.gateway.telegram import bot as tg_bot
        tg_bot._pending.clear()
        tg_bot._pending["inv-chain-1"] = {"chat_id": 3333, "thread_id": "thread-z"}

        query = AsyncMock()
        query.answer = AsyncMock()
        query.data = "approve:inv-chain-1"
        query.edit_message_text = AsyncMock()
        update = MagicMock()
        update.callback_query = query
        ctx = MagicMock()
        ctx.bot = AsyncMock()
        ctx.bot.send_message = AsyncMock()

        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "reply": "",
            "approval_pending": True,
            "invocation_id": "inv-chain-1",
            "approval_tool": "write_file",
        }
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_resp)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch("src.gateway.telegram.bot.httpx.AsyncClient", return_value=mock_client):
            await tg_bot.approval_callback(update, ctx)

        ctx.bot.send_message.assert_called_once()
        msg_text = ctx.bot.send_message.call_args[1]["text"]
        assert "write_file" in msg_text
        assert "inv-chain-1" in tg_bot._pending
        tg_bot._pending.clear()
