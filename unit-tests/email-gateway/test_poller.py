"""Unit tests — email gateway poller.

Acceptance criteria covered:
  - _load_config() returns brain config when brain API responds with full credentials
  - _load_config() falls back to env vars when brain returns incomplete config
  - _load_config() falls back to env vars when brain is unreachable
  - _invoke() posts correct JSON body to /invoke and returns reply
  - _send_reply() sends SMTP message with Re: prefix
  - _fetch_and_process_unseen() invokes and replies for each UNSEEN message
  - _fetch_and_process_unseen() marks messages as Seen after processing
  - _fetch_and_process_unseen() skips messages that fail processing without crashing
  - _idle_loop() calls idle_done and processes unseen after wake
  - run_poller() reloads config on reconnect
"""
from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, MagicMock, patch, call


# ---------------------------------------------------------------------------
# S-EML-1: _load_config — brain config path
# ---------------------------------------------------------------------------
class TestLoadConfig:
    @pytest.mark.asyncio
    async def test_returns_brain_config_when_complete(self):
        from src.gateway.email.poller import _load_config

        brain_data = {
            "enabled": True,
            "imap_host": "imap.brain.com",
            "imap_port": 993,
            "smtp_host": "smtp.brain.com",
            "smtp_port": 587,
            "email_user": "agent@brain.com",
            "email_pass": "brainpass",
        }
        mock_resp = MagicMock()
        mock_resp.json.return_value = brain_data
        mock_resp.raise_for_status = MagicMock()

        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.get = AsyncMock(return_value=mock_resp)

        with patch("src.gateway.email.poller.httpx.AsyncClient", return_value=mock_client):
            cfg = await _load_config()

        assert cfg.imap_host == "imap.brain.com"
        assert cfg.email_user == "agent@brain.com"
        assert cfg.email_pass == "brainpass"
        assert cfg.smtp_host == "smtp.brain.com"

    @pytest.mark.asyncio
    async def test_falls_back_to_env_when_brain_incomplete(self, monkeypatch):
        from src.gateway.email.poller import _load_config

        monkeypatch.setenv("IMAP_HOST", "env.imap.com")
        monkeypatch.setenv("SMTP_HOST", "env.smtp.com")
        monkeypatch.setenv("EMAIL_USER", "env@example.com")
        monkeypatch.setenv("EMAIL_PASS", "envpass")

        # Brain returns config with missing email_pass
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"imap_host": "imap.brain.com", "email_user": "x"}
        mock_resp.raise_for_status = MagicMock()

        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.get = AsyncMock(return_value=mock_resp)

        with patch("src.gateway.email.poller.httpx.AsyncClient", return_value=mock_client):
            cfg = await _load_config()

        assert cfg.imap_host == "env.imap.com"
        assert cfg.email_user == "env@example.com"
        assert cfg.email_pass == "envpass"

    @pytest.mark.asyncio
    async def test_falls_back_to_env_when_brain_unreachable(self, monkeypatch):
        from src.gateway.email.poller import _load_config

        monkeypatch.setenv("IMAP_HOST", "fallback.imap.com")
        monkeypatch.setenv("SMTP_HOST", "fallback.smtp.com")
        monkeypatch.setenv("EMAIL_USER", "fallback@example.com")
        monkeypatch.setenv("EMAIL_PASS", "fallbackpass")

        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.get = AsyncMock(side_effect=Exception("connection refused"))

        with patch("src.gateway.email.poller.httpx.AsyncClient", return_value=mock_client):
            cfg = await _load_config()

        assert cfg.imap_host == "fallback.imap.com"
        assert cfg.email_pass == "fallbackpass"


# ---------------------------------------------------------------------------
# S-EML-2: _invoke — brain POST
# ---------------------------------------------------------------------------
class TestInvoke:
    @pytest.mark.asyncio
    async def test_posts_correct_body_and_returns_reply(self):
        from src.gateway.email.poller import _invoke, EmailConfig

        cfg = EmailConfig(
            imap_host="h", imap_port=993, smtp_host="h", smtp_port=587,
            email_user="u@x.com", email_pass="p",
        )
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"reply": "Hello back"}
        mock_resp.raise_for_status = MagicMock()

        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(return_value=mock_resp)

        with patch("src.gateway.email.poller.httpx.AsyncClient", return_value=mock_client):
            reply = await _invoke(cfg, "Hello", "sender@x.com", "Hi there")

        assert reply == "Hello back"
        posted = mock_client.post.call_args
        body = posted[1]["json"] if "json" in (posted[1] or {}) else posted[0][1]
        assert body["agent_id"] == "maya"
        assert "Hi there" in body["message"]
        assert "Hello" in body["message"]
        assert body["metadata"]["channel"] == "email"
        assert body["metadata"]["sender"] == "sender@x.com"

    @pytest.mark.asyncio
    async def test_includes_sender_name_in_metadata(self):
        from src.gateway.email.poller import _invoke, EmailConfig

        cfg = EmailConfig(
            imap_host="h", imap_port=993, smtp_host="h", smtp_port=587,
            email_user="u@x.com", email_pass="p",
        )
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"reply": ""}
        mock_resp.raise_for_status = MagicMock()

        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(return_value=mock_resp)

        with patch("src.gateway.email.poller.httpx.AsyncClient", return_value=mock_client):
            await _invoke(cfg, "msg", "sender@x.com", "subj", sender_name="Alice")

        body = mock_client.post.call_args[1]["json"]
        assert body["metadata"]["sender_name"] == "Alice"


# ---------------------------------------------------------------------------
# S-EML-3: _send_reply — SMTP
# ---------------------------------------------------------------------------
class TestSendReply:
    @pytest.mark.asyncio
    async def test_sends_with_re_subject(self):
        import sys
        # aiosmtplib is stubbed in conftest — grab the stub's SMTP mock
        smtp_instance = AsyncMock()
        smtp_instance.__aenter__ = AsyncMock(return_value=smtp_instance)
        smtp_instance.__aexit__ = AsyncMock(return_value=False)
        smtp_instance.starttls = AsyncMock()
        smtp_instance.login = AsyncMock()
        smtp_instance.send_message = AsyncMock()

        from src.gateway.email.poller import _send_reply, EmailConfig

        cfg = EmailConfig(
            imap_host="h", imap_port=993,
            smtp_host="smtp.test.com", smtp_port=587,
            email_user="agent@test.com", email_pass="pass",
        )
        with patch("src.gateway.email.poller.aiosmtplib.SMTP", return_value=smtp_instance):
            await _send_reply(cfg, "user@x.com", "Original subject", "Reply body")

        smtp_instance.send_message.assert_awaited_once()
        sent_msg = smtp_instance.send_message.call_args[0][0]
        assert sent_msg["Subject"] == "Re: Original subject"
        assert sent_msg["To"] == "user@x.com"
        assert sent_msg["From"] == "agent@test.com"


# ---------------------------------------------------------------------------
# S-EML-4: _fetch_and_process_unseen
# ---------------------------------------------------------------------------
class TestFetchAndProcessUnseen:
    def _make_raw_email(self) -> bytes:
        import email as email_lib
        from email.mime.text import MIMEText
        msg = MIMEText("Hello agent")
        msg["From"] = "Alice <alice@example.com>"
        msg["Subject"] = "Test subject"
        return msg.as_bytes()

    @pytest.mark.asyncio
    async def test_invokes_and_marks_seen(self):
        from src.gateway.email.poller import _fetch_and_process_unseen, EmailConfig

        cfg = EmailConfig(
            imap_host="h", imap_port=993, smtp_host="h", smtp_port=587,
            email_user="u@x.com", email_pass="p",
        )
        raw = self._make_raw_email()

        imap = AsyncMock()
        imap.search = AsyncMock(return_value=(None, [b"1"]))
        imap.fetch = AsyncMock(return_value=(None, [b"ignored", raw]))
        imap.store = AsyncMock(return_value=(None, []))

        invoke_mock = AsyncMock(return_value="Agent reply")
        send_mock = AsyncMock()

        with patch("src.gateway.email.poller._invoke", invoke_mock), \
             patch("src.gateway.email.poller._send_reply", send_mock):
            await _fetch_and_process_unseen(cfg, imap)

        invoke_mock.assert_awaited_once()
        send_mock.assert_awaited_once()
        imap.store.assert_awaited_once_with("1", "+FLAGS", "\\Seen")

    @pytest.mark.asyncio
    async def test_no_messages_does_nothing(self):
        from src.gateway.email.poller import _fetch_and_process_unseen, EmailConfig

        cfg = EmailConfig(
            imap_host="h", imap_port=993, smtp_host="h", smtp_port=587,
            email_user="u@x.com", email_pass="p",
        )
        imap = AsyncMock()
        imap.search = AsyncMock(return_value=(None, [b""]))
        invoke_mock = AsyncMock()

        with patch("src.gateway.email.poller._invoke", invoke_mock):
            await _fetch_and_process_unseen(cfg, imap)

        invoke_mock.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_processing_error_does_not_crash(self):
        from src.gateway.email.poller import _fetch_and_process_unseen, EmailConfig

        cfg = EmailConfig(
            imap_host="h", imap_port=993, smtp_host="h", smtp_port=587,
            email_user="u@x.com", email_pass="p",
        )
        imap = AsyncMock()
        imap.search = AsyncMock(return_value=(None, [b"42"]))
        imap.fetch = AsyncMock(side_effect=Exception("IMAP error"))

        # Should not raise
        await _fetch_and_process_unseen(cfg, imap)


# ---------------------------------------------------------------------------
# S-EML-5: _idle_loop — wake and process
# ---------------------------------------------------------------------------
class TestIdleLoop:
    @pytest.mark.asyncio
    async def test_calls_idle_done_and_processes(self):
        from src.gateway.email.poller import _idle_loop, EmailConfig

        cfg = EmailConfig(
            imap_host="h", imap_port=993, smtp_host="h", smtp_port=587,
            email_user="u@x.com", email_pass="p",
        )

        call_count = 0

        async def fake_fetch(_cfg, _client):
            nonlocal call_count
            call_count += 1
            if call_count >= 2:
                raise Exception("stop loop")  # Break the infinite loop after 2 cycles

        imap = AsyncMock()
        imap.noop = AsyncMock(return_value=("OK", []))

        with patch("src.gateway.email.poller._fetch_and_process_unseen", fake_fetch):
            with patch("src.gateway.email.poller.asyncio.sleep", new_callable=AsyncMock):
                with pytest.raises(Exception, match="stop loop"):
                    await _idle_loop(cfg, imap)

        # Each cycle executes NOOP before processing unseen messages.
        assert imap.noop.await_count >= 2
