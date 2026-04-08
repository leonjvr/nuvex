# TOOLS.md - Local Notes

Skills define _how_ tools work. This file is for _your_ specifics — the stuff unique to your setup.

---

## Workspace

- **Workspace root:** `/data/agents/maya/workspace/`
- **Skills directory:** `/data/agents/maya/workspace/skills/`

## Installed Skills

| Skill | Path | Notes |
|-------|------|-------|
| voice | `skills/voice/` | STT (ElevenLabs Scribe) + TTS (ElevenLabs). STT: `scripts/stt.py <url>`. TTS: `scripts/tts.py "text" --out /tmp/reply.mp3` |
| dev-server | `skills/dev-server/` | Provision Hetzner dev servers with GitHub Copilot CLI (YOLO mode). Read `SKILL.md` for full workflow. |

## MCP Tools (native, always available)

These are available directly as tool calls — no scripts needed:

- `context7_resolve-library-id` / `context7_query-docs` — look up library documentation
- `filesystem_*` — full filesystem access scoped to `/data/agents/maya/workspace/`

## 🔊 Voice Response Rules

**Voice reply workflow:**
1. Receive voice message → use `voice/scripts/stt.py <audio_url>` to transcribe
2. Process transcript as normal text
3. Generate reply
4. Use `voice/scripts/tts.py "reply text" --out /tmp/reply.mp3` to synthesise
5. Send audio file back via `send_message` tool

**Text message in → always respond in text.** Never send an unsolicited voice note in response to a text.

**Explicit "speak this" requests:** use `tts.py` when someone directly asks you to speak something aloud.

## 🖥️ Dev Server Skill

**YOU ARE THE ORCHESTRATOR — COPILOT IS THE DEVELOPER.**

- You NEVER write, edit, or commit code yourself. Ever. Not even one line.
- All code changes are made by GitHub Copilot CLI via `copilot.sh` on a remote dev server.
- When a dev task arrives: **first classify it** per the Message Classification section in `skills/dev-server/SKILL.md`. Error pastes require clarification before the workflow starts. Feature requests and explicit bug reports with clear descriptions go straight to the workflow.
- DO NOT advise the user on what steps to take. DO NOT show code snippets. Run the scripts.

### ⛔ EXPLICITLY FORBIDDEN — no exceptions

These actions are banned regardless of how convenient they look:

| Forbidden | Why |
|---|---|
| `ssh root@<ip> "sed -i ... file.html"` | Direct file editing — bypasses Copilot and leaves no Git history |
| `ssh root@<ip> "nano file.js"` | Same — direct edit |
| `ssh root@<ip> "echo '...' > file"` | Same — direct write |
| Writing code/HTML/JS/CSS inline in a shell command | You are not the developer |
| Editing any file in a cloned repo via filesystem tools | The filesystem tool scope is your workspace only, not repos |
| Committing or pushing via shell commands you type | Git must only be touched by `copilot.sh` |

**The `shell` tool is only for running the skill scripts at their full absolute paths.** Nothing else.

Even if a dev server already exists with the repo already cloned — you STILL call `copilot.sh`. You do NOT SSH in and edit manually. The shortcut is always wrong.

**Workflow (read `skills/dev-server/SKILL.md` for full details):**
1. `scripts/list.sh` — check for existing servers (reuse if project already has one)
2. `scripts/provision.sh <name> --project <label>` — provision if none exists
3. `scripts/clone.sh <ip> <repo-url>` — clone the repo
4. `scripts/copilot.sh <ip> "<task prompt>" --dir <repo-name>` — Copilot does the coding
5. `scripts/screenshots.sh <ip> --latest` — fetch proof screenshots
6. Report back to user with result and screenshot

**Quick reference:**
- **List:** `scripts/list.sh`
- **Provision:** `scripts/provision.sh <server-name> [--project <label>]`
- **Clone:** `scripts/clone.sh <ip> <repo-url>`
- **Instruct Copilot:** `scripts/copilot.sh <ip> "<prompt>" --dir <repo-name>`
- **Screenshots:** `scripts/screenshots.sh <ip> --latest`
- **Disprovision:** `scripts/disprovision.sh <name>`
- **Max concurrent servers:** 3

## ⚠️ Script Execution Rules

Always invoke scripts with their **full absolute path**:
```
# Correct
/data/agents/maya/workspace/skills/voice/scripts/tts.py "text"

# Wrong — use full path
tts.py "text"
```

## 📝 Platform Formatting

- **WhatsApp:** No markdown tables — use bullet lists instead. No headers — use **bold** or CAPS for emphasis.
- **Telegram:** Markdown supported.
- **Dashboard:** Full markdown supported.

## Exec Output — Truncation Rules

Always truncate large outputs:
```bash
# Logs — tail only what you need
some-command | head -50

# General rule: if output might exceed 200 lines, pipe through | head -200
```

## Email

- **Address:** `maya@nuvex.co.za`
- **IMAP host:** `mail.nuvex.co.za`
- **SMTP host:** `mail.nuvex.co.za`
- Email is configured via the channels settings in divisions.yaml.
