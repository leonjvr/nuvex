"""27.6 — End-to-end smoke test: Telegram message → approval flow → resume → reply."""
from __future__ import annotations

import sys
import types
from unittest.mock import AsyncMock, MagicMock, patch
import os

import pytest


# ── Stub heavy deps ──────────────────────────────────────────────────────────

def _stub(name: str, **attrs) -> types.ModuleType:
    mod = types.ModuleType(name)
    for k, v in attrs.items():
        setattr(mod, k, v)
    sys.modules.setdefault(name, mod)
    return mod


_stub("telegram",
      Update=MagicMock,
      BotCommand=MagicMock,
      InlineKeyboardButton=lambda text, callback_data: MagicMock(text=text, callback_data=callback_data),
      InlineKeyboardMarkup=lambda rows: MagicMock(inline_keyboard=rows))
_stub("telegram.ext",
      Application=MagicMock, CallbackQueryHandler=MagicMock,
      CommandHandler=MagicMock, ContextTypes=MagicMock,
      MessageHandler=MagicMock, filters=MagicMock)


# ── Helpers ──────────────────────────────────────────────────────────────────

def _make_message_update(text: str, chat_id: int = 1234, user_id: int = 99) -> MagicMock:
    update = MagicMock()
    update.effective_chat.id = chat_id
    update.effective_user.id = user_id
    msg = AsyncMock()
    msg.text = text
    msg.reply_text = AsyncMock()
    update.message = msg
    return update


def _make_callback_update(data: str) -> tuple[MagicMock, MagicMock]:
    query = AsyncMock()
    query.answer = AsyncMock()
    query.data = data
    query.edit_message_text = AsyncMock()
    update = MagicMock()
    update.callback_query = query
    return update, query


def _mock_http(json_body: dict, status: int = 200) -> AsyncMock:
    resp = MagicMock()
    resp.status_code = status
    resp.raise_for_status = MagicMock()
    resp.json.return_value = json_body
    client = AsyncMock()
    client.post = AsyncMock(return_value=resp)
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=False)
    return client


# ── 27.6 Smoke tests ─────────────────────────────────────────────────────────

class TestTelegramApprovalFlowE2E:
    """Full chain: user message → approval keyboard → approve → reply received."""

    def setup_method(self):
        self._env = patch.dict(os.environ, {"TELEGRAM_BOT_TOKEN": "tok"})
        self._env.start()

    def teardown_method(self):
        self._env.stop()

    @pytest.mark.asyncio
    async def test_full_approve_flow(self):
        """
        Step 1: message_handler called — brain returns approval_pending.
        Step 2: bot stores pending and sends inline keyboard.
        Step 3: user clicks Approve (approval_callback called).
        Step 4: bot POSTs to /invoke/resume with approved=True.
        Step 5: brain replies with final text; bot sends it to user.
        """
        from src.gateway.telegram import bot as tg

        tg._pending.clear()
        ctx = MagicMock()

        # ── Step 1-2: incoming message ────────────────────────────────────────
        update1 = _make_message_update("run cleanup script", chat_id=5000, user_id=11)
        brain_first = {
            "approval_pending": True,
            "invocation_id": "e2e-001",
            "approval_tool": "shell",
            "thread_id": "maya:telegram:5000",
        }
        with patch("src.gateway.telegram.bot._invoke", AsyncMock(return_value=brain_first)):
            await tg.message_handler(update1, ctx)

        # keyboard was sent, pending stored
        update1.message.reply_text.assert_called_once()
        assert "e2e-001" in tg._pending
        assert tg._pending["e2e-001"]["chat_id"] == 5000

        # ── Step 3-5: user approves ───────────────────────────────────────────
        update2, query = _make_callback_update("approve:e2e-001")
        ctx2 = MagicMock()
        ctx2.bot = AsyncMock()
        ctx2.bot.send_message = AsyncMock()

        brain_resume = {"reply": "Cleanup done!", "approval_pending": False}
        http_mock = _mock_http(brain_resume)

        with patch("src.gateway.telegram.bot.httpx.AsyncClient", return_value=http_mock):
            await tg.approval_callback(update2, ctx2)

        # confirmation caption shown
        query.edit_message_text.assert_called_once_with("Decision: Approved ✅")
        # final reply sent to user
        ctx2.bot.send_message.assert_called_once()
        send_args = ctx2.bot.send_message.call_args
        assert send_args[1].get("text") == "Cleanup done!"
        assert send_args[1].get("chat_id") == 5000

        # resume payload was correct
        payload = http_mock.post.call_args[1]["json"]
        assert payload["invocation_id"] == "e2e-001"
        assert payload["approved"] is True

        # pending cleared
        assert "e2e-001" not in tg._pending

    @pytest.mark.asyncio
    async def test_full_deny_flow(self):
        """User denies: resume called with approved=False, no final reply expected."""
        from src.gateway.telegram import bot as tg

        tg._pending.clear()
        update1 = _make_message_update("delete everything", chat_id=6000, user_id=22)
        brain_first = {
            "approval_pending": True,
            "invocation_id": "e2e-002",
            "approval_tool": "delete_files",
        }
        with patch("src.gateway.telegram.bot._invoke", AsyncMock(return_value=brain_first)):
            await tg.message_handler(update1, MagicMock())

        update2, query = _make_callback_update("deny:e2e-002")
        ctx2 = MagicMock()
        ctx2.bot = AsyncMock()
        ctx2.bot.send_message = AsyncMock()

        brain_resume = {"reply": "", "approval_pending": False}
        http_mock = _mock_http(brain_resume)

        with patch("src.gateway.telegram.bot.httpx.AsyncClient", return_value=http_mock):
            await tg.approval_callback(update2, ctx2)

        query.edit_message_text.assert_called_once_with("Decision: Denied ❌")
        # no reply to user (empty string)
        ctx2.bot.send_message.assert_not_called()

        payload = http_mock.post.call_args[1]["json"]
        assert payload["approved"] is False
        assert "e2e-002" not in tg._pending

    @pytest.mark.asyncio
    async def test_message_without_approval_goes_straight_to_reply(self):
        """Normal message (no approval needed) → reply sent directly, no pending stored."""
        from src.gateway.telegram import bot as tg

        tg._pending.clear()
        update = _make_message_update("what's the weather?", chat_id=7000, user_id=33)
        brain_resp = {"reply": "It's sunny!", "approval_pending": False}

        with patch("src.gateway.telegram.bot._invoke", AsyncMock(return_value=brain_resp)):
            await tg.message_handler(update, MagicMock())

        update.message.reply_text.assert_called_once_with("It's sunny!")
        assert len(tg._pending) == 0

    @pytest.mark.asyncio
    async def test_chained_approval_e2e(self):
        """
        Brain returns a second approval_pending after first approve.
        Bot should store the new pending and send a new keyboard.
        """
        from src.gateway.telegram import bot as tg

        tg._pending.clear()
        update1 = _make_message_update("deploy and migrate", chat_id=8000, user_id=44)
        brain_first = {
            "approval_pending": True,
            "invocation_id": "e2e-003",
            "approval_tool": "deploy",
        }
        with patch("src.gateway.telegram.bot._invoke", AsyncMock(return_value=brain_first)):
            await tg.message_handler(update1, MagicMock())

        # approve first step → brain asks for a second approval
        update2, query = _make_callback_update("approve:e2e-003")
        ctx2 = MagicMock()
        ctx2.bot = AsyncMock()
        ctx2.bot.send_message = AsyncMock()

        brain_resume = {
            "reply": "",
            "approval_pending": True,
            "invocation_id": "e2e-003",
            "approval_tool": "migrate_db",
        }
        http_mock = _mock_http(brain_resume)

        with patch("src.gateway.telegram.bot.httpx.AsyncClient", return_value=http_mock):
            await tg.approval_callback(update2, ctx2)

        # a new keyboard message was sent (send_message called with keyboard text)
        ctx2.bot.send_message.assert_called_once()
        msg_kwargs = ctx2.bot.send_message.call_args[1]
        assert "migrate_db" in msg_kwargs.get("text", "")

        # pending still tracked for the second step
        assert "e2e-003" in tg._pending
        tg._pending.clear()
