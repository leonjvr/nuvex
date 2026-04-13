"""Telegram gateway — receive messages, invoke brain, send replies."""
from __future__ import annotations

import asyncio
import logging
import os
from collections import defaultdict
from time import time

import httpx
from telegram import (
    BotCommand,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Update,
)
from telegram.ext import (
    Application,
    CallbackQueryHandler,
    CommandHandler,
    ContextTypes,
    MessageHandler,
    filters,
)

log = logging.getLogger(__name__)

BRAIN_URL = os.environ.get("BRAIN_URL", "http://brain:8100")
BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
if not BOT_TOKEN:
    log.warning("TELEGRAM_BOT_TOKEN not set — Telegram gateway will not start")
ALLOWED_USERS = set(
    int(x) for x in os.environ.get("TELEGRAM_ALLOWED_USERS", "").split(",") if x.strip()
)
AGENT_ID = os.environ.get("NUVEX_AGENT_ID", "maya")
ORG_ID = os.environ.get("NUVEX_ORG_ID", "")
if not ORG_ID:
    log.warning("NUVEX_ORG_ID not set in Telegram gateway — defaulting to 'default' (deprecated)")
    ORG_ID = "default"

# pending_approvals: invocation_id → {chat_id, thread_id}
_pending: dict[str, dict] = {}

# ── Per-contact session tracking ──────────────────────────────────────────────
# _contact_sessions[chat_id] = [thread_id, ...]
# _active_session[chat_id] = thread_id
_contact_sessions: dict[int, list[str]] = defaultdict(list)
_active_session: dict[int, str] = {}


def _default_thread(chat_id: int) -> str:
    return f"{ORG_ID}:{AGENT_ID}:telegram:{chat_id}"


def _get_active_thread(chat_id: int) -> str:
    if chat_id not in _active_session:
        tid = _default_thread(chat_id)
        _active_session[chat_id] = tid
        if tid not in _contact_sessions[chat_id]:
            _contact_sessions[chat_id].append(tid)
    return _active_session[chat_id]


def _new_session(chat_id: int, name: str = "") -> str:
    slug = name.lower().replace(r"[^a-z0-9]", "-")[:30] if name else f"s{int(time())}"
    thread_id = f"{AGENT_ID}:telegram:{chat_id}:{slug}"
    if not _contact_sessions[chat_id]:
        _contact_sessions[chat_id].append(_default_thread(chat_id))
    _contact_sessions[chat_id].append(thread_id)
    _active_session[chat_id] = thread_id
    return thread_id


HELP_TEXT = (
    "Available commands:\n\n"
    "/new [name]   — Start a new focused session\n"
    "/sessions     — List your sessions\n"
    "/switch <n>   — Switch to session N\n"
    "/clear        — Start fresh (same as /new)\n"
    "/status       — Show agent status\n"
    "/who          — Who is this agent\n"
    "/help         — Show this list\n\n"
    "Tip: use sessions to separate topics, e.g. /new skill-building"
)

# ── Brain invoke ──────────────────────────────────────────────────────────────

async def _invoke(
    agent_id: str, message: str, thread_id: str, sender: str, channel: str = "telegram",
    sender_name: str = "",
) -> dict:
    async with httpx.AsyncClient(timeout=120) as client:
        metadata: dict = {"channel": channel, "sender": sender}
        if sender_name:
            metadata["sender_name"] = sender_name
        r = await client.post(
            f"{BRAIN_URL}/invoke",
            json={
                "agent_id": agent_id,
                "org_id": ORG_ID,
                "message": message,
                "thread_id": thread_id,
                "channel": channel,
                "sender": sender,
                "metadata": metadata,
            },
        )
        r.raise_for_status()
        return r.json()

# ── Slash command handlers ────────────────────────────────────────────────────

async def cmd_start(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    chat_id = update.effective_chat.id
    thread_id = _get_active_thread(chat_id)
    await update.message.reply_text(
        f"Hello! I'm {AGENT_ID}, your AI assistant.\n\nSend me a message to get started, or use /help to see available commands."
    )


async def cmd_help(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    await update.message.reply_text(HELP_TEXT)


async def cmd_new(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    chat_id = update.effective_chat.id
    name = " ".join(ctx.args) if ctx.args else ""
    thread_id = _new_session(chat_id, name)
    label = name or thread_id.split(":")[-1]
    await update.message.reply_text(f"New session started: {label}\n\nSend your first message to begin with a fresh context.")


async def cmd_clear(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    """Alias for /new."""
    await cmd_new(update, ctx)


async def cmd_sessions(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    chat_id = update.effective_chat.id
    current = _get_active_thread(chat_id)
    sessions = _contact_sessions[chat_id]
    if not sessions:
        sessions = [_default_thread(chat_id)]
    lines = []
    for i, s in enumerate(sessions, 1):
        label = ":".join(s.split(":")[2:]) or s
        marker = " ✅ (active)" if s == current else ""
        lines.append(f"{i}. {label}{marker}")
    await update.message.reply_text("Your sessions:\n\n" + "\n".join(lines) + "\n\nUse /switch <n> to change.")


async def cmd_switch(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    chat_id = update.effective_chat.id
    sessions = _contact_sessions[chat_id] or [_default_thread(chat_id)]
    if not ctx.args:
        await update.message.reply_text("Usage: /switch <number>  — see /sessions for list")
        return
    try:
        n = int(ctx.args[0])
    except ValueError:
        await update.message.reply_text("Please provide a number, e.g. /switch 2")
        return
    if n < 1 or n > len(sessions):
        await update.message.reply_text(f"Invalid — you have {len(sessions)} session(s). Use /sessions to list them.")
        return
    _active_session[chat_id] = sessions[n - 1]
    label = ":".join(sessions[n - 1].split(":")[2:]) or sessions[n - 1]
    await update.message.reply_text(f"Switched to session {n}: {label}")


async def cmd_status(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(f"{BRAIN_URL}/health")
            d = r.json()
        await update.message.reply_text(f"Agent status: {d.get('status')}\nDB: {d.get('db')}\nVersion: {d.get('version')}")
    except Exception as exc:
        await update.message.reply_text(f"Could not reach brain: {exc}")


async def cmd_who(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    chat_id = update.effective_chat.id
    user = update.effective_user
    thread_id = _get_active_thread(chat_id)
    sender = str(user.id) if user else "unknown"
    sender_name = " ".join(filter(None, [x for x in [getattr(user, "first_name", ""), getattr(user, "last_name", "")] if isinstance(x, str)])) if user else ""
    try:
        result = await _invoke(AGENT_ID, "Who are you? Briefly introduce yourself in one paragraph.", thread_id, sender, sender_name=sender_name)
        await update.message.reply_text(result.get("reply") or "I'm your AI assistant.")
    except Exception as exc:
        await update.message.reply_text(f"[Error] {exc}")

# ── Regular message handler ───────────────────────────────────────────────────

async def message_handler(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    chat = update.effective_chat
    user = update.effective_user
    msg = update.message

    if not msg or not msg.text:
        return

    if ALLOWED_USERS and user and user.id not in ALLOWED_USERS:
        await msg.reply_text("Sorry, you are not authorised to use this bot.")
        return

    thread_id = _get_active_thread(chat.id)
    sender = str(user.id) if user else "unknown"
    sender_name = " ".join(filter(None, [x for x in [getattr(user, "first_name", ""), getattr(user, "last_name", "")] if isinstance(x, str)])) if user else ""

    try:
        result = await _invoke(AGENT_ID, msg.text, thread_id, sender, sender_name=sender_name)
    except Exception as exc:
        log.error("invoke failed: %s", exc)
        await msg.reply_text(f"[Error] {exc}")
        return

    if result.get("approval_pending"):
        invocation_id = result.get("invocation_id", "")
        approval_tool = result.get("approval_tool") or "tool"
        _pending[invocation_id] = {"chat_id": chat.id, "thread_id": thread_id}
        keyboard = InlineKeyboardMarkup([[
            InlineKeyboardButton("✅ Approve", callback_data=f"approve:{invocation_id}"),
            InlineKeyboardButton("❌ Deny", callback_data=f"deny:{invocation_id}"),
        ]])
        await msg.reply_text(
            f"Approval required: the agent wants to use '{approval_tool}'. Allow?",
            reply_markup=keyboard,
        )
        return

    reply = result.get("reply", "")
    if reply:
        await msg.reply_text(reply[:4096])


async def approval_callback(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    await query.answer()
    data = query.data or ""
    parts = data.split(":", 1)
    if len(parts) != 2:
        return
    action, invocation_id = parts
    approved = action == "approve"

    pending = _pending.pop(invocation_id, None)
    if not pending:
        await query.edit_message_text("Approval request not found or already handled.")
        return

    thread_id = pending["thread_id"]
    chat_id = pending["chat_id"]
    response_data: dict = {}
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(
                f"{BRAIN_URL}/invoke/resume",
                json={"invocation_id": invocation_id, "thread_id": thread_id, "approved": approved},
            )
            if r.status_code == 200:
                response_data = r.json()
    except Exception as exc:
        log.error("resume failed: %s", exc)

    caption = "Approved ✅" if approved else "Denied ❌"
    await query.edit_message_text(f"Decision: {caption}")

    if response_data.get("reply"):
        await ctx.bot.send_message(chat_id=chat_id, text=response_data["reply"][:4096])

    if response_data.get("approval_pending"):
        new_invocation_id = response_data.get("invocation_id", invocation_id)
        approval_tool = response_data.get("approval_tool") or "tool"
        _pending[new_invocation_id] = {"chat_id": chat_id, "thread_id": thread_id}
        keyboard = InlineKeyboardMarkup([[
            InlineKeyboardButton("✅ Approve", callback_data=f"approve:{new_invocation_id}"),
            InlineKeyboardButton("❌ Deny", callback_data=f"deny:{new_invocation_id}"),
        ]])
        await ctx.bot.send_message(
            chat_id=chat_id,
            text=f"Another approval required: '{approval_tool}'. Allow?",
            reply_markup=keyboard,
        )


def build_app() -> Application:
    app = Application.builder().token(BOT_TOKEN).build()
    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CommandHandler("help", cmd_help))
    app.add_handler(CommandHandler("new", cmd_new))
    app.add_handler(CommandHandler("clear", cmd_clear))
    app.add_handler(CommandHandler("sessions", cmd_sessions))
    app.add_handler(CommandHandler("switch", cmd_switch))
    app.add_handler(CommandHandler("status", cmd_status))
    app.add_handler(CommandHandler("who", cmd_who))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, message_handler))
    app.add_handler(CallbackQueryHandler(approval_callback))
    return app


async def set_bot_commands(app: Application) -> None:
    """Register command list with Telegram so users see autocomplete."""
    commands = [
        BotCommand("new", "Start a new focused session"),
        BotCommand("sessions", "List your sessions"),
        BotCommand("switch", "Switch to session N"),
        BotCommand("clear", "Start fresh context"),
        BotCommand("status", "Show agent status"),
        BotCommand("who", "Who is this agent"),
        BotCommand("help", "Show all commands"),
    ]
    try:
        await app.bot.set_my_commands(commands)
        log.info("TG bot commands registered")
    except Exception as exc:
        log.warning("set_my_commands failed: %s", exc)


# ---------------------------------------------------------------------------
# Cross-channel action polling + extended action types
# ---------------------------------------------------------------------------

_POLL_INTERVAL = float(os.environ.get("TG_POLL_INTERVAL", "5"))
_CHANNEL_TAG = "telegram"


async def _poll_and_dispatch(tg_app: Application) -> None:
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(
                f"{BRAIN_URL}/actions/pending",
                params={"channel": _CHANNEL_TAG, "limit": 20},
            )
            if r.status_code != 200:
                return
            actions = r.json()
    except Exception as exc:
        log.debug("action poll error: %s", exc)
        return

    for action in actions:
        await _dispatch_action(tg_app, action)


async def _dispatch_action(tg_app: Application, action: dict) -> None:
    action_id = action["id"]
    payload = action.get("payload", {})
    action_type = payload.get("action_type", "send_message")

    try:
        if action_type == "send_message":
            chat_id = payload.get("chat_id") or payload.get("to")
            text = payload.get("text") or payload.get("message") or ""
            if not chat_id or not text:
                await _ack_action(action_id, "failed", "missing chat_id or text")
                return
            await tg_app.bot.send_message(chat_id=chat_id, text=str(text)[:4096])

        elif action_type == "send_photo":
            chat_id = payload.get("chat_id") or payload.get("to")
            photo = payload.get("url") or payload.get("photo")
            caption = payload.get("caption", "")
            if not chat_id or not photo:
                await _ack_action(action_id, "failed", "missing chat_id or photo")
                return
            await tg_app.bot.send_photo(chat_id=chat_id, photo=photo, caption=caption)

        elif action_type == "send_document":
            chat_id = payload.get("chat_id") or payload.get("to")
            document = payload.get("url") or payload.get("document")
            caption = payload.get("caption", "")
            filename = payload.get("filename", "")
            if not chat_id or not document:
                await _ack_action(action_id, "failed", "missing chat_id or document")
                return
            await tg_app.bot.send_document(chat_id=chat_id, document=document, caption=caption, filename=filename)

        elif action_type == "send_poll":
            chat_id = payload.get("chat_id") or payload.get("to")
            question = payload.get("question", "")
            options = payload.get("options", [])
            if not chat_id or not question or len(options) < 2:
                await _ack_action(action_id, "failed", "missing chat_id, question, or options (min 2)")
                return
            await tg_app.bot.send_poll(chat_id=chat_id, question=question, options=options)

        elif action_type == "pin_message":
            chat_id = payload.get("chat_id") or payload.get("to")
            message_id = payload.get("message_id")
            if not chat_id or not message_id:
                await _ack_action(action_id, "failed", "missing chat_id or message_id")
                return
            await tg_app.bot.pin_chat_message(chat_id=chat_id, message_id=message_id)

        elif action_type == "create_invite_link":
            chat_id = payload.get("chat_id") or payload.get("to")
            name = payload.get("name", "")
            if not chat_id:
                await _ack_action(action_id, "failed", "missing chat_id")
                return
            link = await tg_app.bot.create_chat_invite_link(chat_id=chat_id, name=name)
            await _ack_action(action_id, "sent", result={"invite_link": link.invite_link})
            return

        elif action_type == "get_chat_info":
            chat_id = payload.get("chat_id") or payload.get("to")
            if not chat_id:
                await _ack_action(action_id, "failed", "missing chat_id")
                return
            chat = await tg_app.bot.get_chat(chat_id=chat_id)
            await _ack_action(action_id, "sent", result={
                "id": chat.id,
                "title": chat.title,
                "type": chat.type,
                "username": chat.username,
                "member_count": chat.get_member_count() if hasattr(chat, "get_member_count") else None,
            })
            return

        else:
            await _ack_action(action_id, "failed", f"unknown action_type: {action_type}")
            return

        await _ack_action(action_id, "sent")
        log.info("TG action dispatched: id=%s type=%s", action_id, action_type)

    except Exception as exc:
        log.error("TG dispatch failed: id=%s error=%s", action_id, exc)
        await _ack_action(action_id, "failed", str(exc))


async def _ack_action(action_id: str, status: str, error: str | None = None, result: dict | None = None) -> None:
    try:
        params: dict = {"status": status}
        if error:
            params["error"] = error
        body = result
        async with httpx.AsyncClient(timeout=5) as client:
            await client.post(
                f"{BRAIN_URL}/actions/{action_id}/ack",
                params=params,
                json=body,
            )
    except Exception as exc:
        log.debug("ack failed: id=%s error=%s", action_id, exc)


async def start_action_poller(tg_app: Application) -> None:
    log.info("TG action poller started (interval=%.0fs)", _POLL_INTERVAL)
    await set_bot_commands(tg_app)
    while True:
        await asyncio.sleep(_POLL_INTERVAL)
        await _poll_and_dispatch(tg_app)

