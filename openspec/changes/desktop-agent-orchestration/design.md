## Context

NUVEX agents interact with the external world through chat gateways (WhatsApp, Telegram, Email), a `web_fetch` tool, file read/write, skill scripts, and optionally headless browser automation. There is no mechanism for agents to interact with a user's local desktop environment.

Existing infrastructure:
- `src/brain/server.py` — FastAPI app, REST endpoints for gateway invocation
- `src/brain/routers/invoke.py` — `POST /invoke`, `POST /invoke/resume` for graph interrupt/resume
- `src/brain/tools_registry.py` — `get_tools_for_agent()` assembles agent-scoped tool collection
- `src/brain/nodes/execute_tools.py` — `GovernedToolNode` with 5-stage governance and pre/post hooks
- `src/brain/tools/mcp_loader.py` — MCP client (stdio/SSE) for external tool servers
- `src/shared/models/config.py` — `AgentDefinition`, `McpServerConfig`, divisions.yaml schema
- `src/gateway/telegram/bot.py` — reference gateway pattern: outbound connection + `POST /invoke`
- Thread scratch dir at `data/threads/<thread_id>/scratch/`

Constraints:
- Brain runs in Docker in the cloud; desktop is behind NAT on user's home/office network
- MCP stdio requires co-location; MCP SSE requires brain-initiates-connection — neither works for remote desktop
- Desktop and user share the same screen — agent must never interfere with active user work
- Windows-only in v1; pywinauto and win32com are Windows-specific
- Desktop runtime must survive network drops and brain restarts without losing queued work

## Goals / Non-Goals

**Goals:**
- Outbound WebSocket device channel from user PC to brain (no NAT/tunnel needed)
- Persistent task queue with graph interrupt/resume for offline/busy devices
- Explicit per-agent device assignment — never global, never default
- Idle-aware cooperative scheduling — never interrupt active user
- Configurable permission modes (`ask` with approval popup, `auto` with silent execution)
- User-visible notifications for pending and active work
- Dashboard download page with platform extensibility
- Device token onboarding with revocation support
- Outlook COM integration as first structured desktop tool

**Non-Goals:**
- macOS/Linux desktop automation (v2 scope — UI placeholder only)
- Remote desktop video streaming
- Browser automation on desktop (separate `browser-computer-control` change)
- Multi-user shared device at the same time
- Session recording/replay authoring
- Replacing MCP for brain-local tool integrations

## Decisions

### 1. Outbound WebSocket (Not MCP)

The desktop runtime initiates an outbound persistent WebSocket connection to the brain. This is the inverse of MCP's topology where the client (brain) connects to the server (tool provider).

**Why not MCP stdio?** Brain and desktop are on different machines — stdio requires co-location.
**Why not MCP SSE?** Brain must initiate the HTTP connection — doesn't work through NAT without tunnels.
**Why WebSocket?** Desktop initiates outbound (same as browser connecting to a website). Punches through NAT. Bidirectional. The same approach every chat gateway uses.

Protocol: JSON messages over WebSocket.
```
Brain → Desktop:  { "type": "tool_call",    "call_id": "uuid", "tool": "screenshot", "args": {...} }
Desktop → Brain:  { "type": "tool_result",  "call_id": "uuid", "result": {...} }
Desktop → Brain:  { "type": "tool_error",   "call_id": "uuid", "error": "...", "category": "..." }
Both:             { "type": "heartbeat" }
```

### 2. Task Queue with Graph Interrupt/Resume

When the device is offline or the user is active, tool calls are queued rather than failed.

- Brain persists to `desktop_task_queue` PostgreSQL table
- LangGraph graph suspends via `GraphInterrupt("desktop_unavailable", metadata={"queue_id": "..."})`
- Same mechanism as human-approval flow (already in `invoke/resume`)
- On device reconnect + result delivery → `POST /invoke/resume` with result → graph continues
- Desktop app also keeps local `queue.json` for resilience across tray app restarts

Queue status lifecycle:
```
queued → dispatched → waiting_idle → waiting_permission → running → succeeded | failed | cancelled
```

### 3. Explicit Agent-to-Device Gating

Desktop tools NEVER appear unless all three conditions are true:
1. Operator assigned this specific device to this specific agent (DB + dashboard)
2. `AgentDefinition.desktop_device` is set
3. Device has a live WebSocket connection right now

This is enforced in `get_tools_for_agent()`. Missing any condition → tool not in schema → LLM cannot call it.

### 4. Idle Detection and Non-Interruption

Windows API `GetLastInputInfo()` via `ctypes` returns ms since last keyboard/mouse input. Polled every 5 seconds.

Rules (applied regardless of permission mode):
- User active → NEVER execute. Queue tasks. Show non-intrusive toast.
- User becomes active during execution → cooperative pause at next step boundary.
- User idle exceeds threshold → proceed per permission mode.

### 5. Permission Modes

Config: `desktop_mode` in `%APPDATA%\Nuvex\desktop-agent.json`

| Mode | Behaviour when idle + tasks pending |
|---|---|
| `ask` | Show approval popup near taskbar. Execute only after user clicks Approve. |
| `auto` | Execute immediately. Show progress popup with Cancel button. |

### 6. Tray State Machine

```
disconnected → connected_idle → queued_user_active → {awaiting_permission | executing} → connected_idle
                                                    ↓
                                                  error
```

| State | Tray Icon | Toast/Popup |
|---|---|---|
| `disconnected` | Red | Toast on reconnect |
| `connected_idle` | Grey | None |
| `queued_user_active` | Orange | Toast: "N tasks pending" |
| `awaiting_permission` | Orange pulse | Approval popup |
| `executing` | Green spin | Progress popup + Cancel |
| `error` | Red | Toast with error summary |

### 7. Desktop Tool Classification

| Tool | Min Tier | Notes |
|---|---|---|
| `desktop_screenshot` | T2 | Captures screen content |
| `desktop_list_windows` | T2 | Enumerate open windows |
| `desktop_find_control` | T2 | Find UI element by UIA |
| `desktop_click_control` | T2 | Click UI element by handle |
| `desktop_type_text` | T2 | Type into focused element |
| `desktop_hotkey` | T2 | Send key combinations |
| `desktop_outlook_get_emails` | T2 | Read emails via COM |
| `desktop_outlook_send_email` | T2 | Send email via COM (approval for T2) |
| `desktop_outlook_reply` | T2 | Reply to email via COM |
| `desktop_get_clipboard` | T2 | Read clipboard |
| `desktop_set_clipboard` | T2 | Write clipboard |
| `desktop_run_app` | T1 | Launch application (T1 only) |
| `desktop_shell` | T1 | Run shell command (T1 only) |

T3 agents: all desktop tools forbidden by default. T4: no desktop capability possible.

### 8. Module Structure

#### Brain side
```
src/brain/devices/
├── __init__.py
├── registry.py           # In-memory device WebSocket registry + DB sync
├── models.py             # SQLAlchemy: desktop_devices, desktop_device_tokens, desktop_agent_assignments, desktop_task_queue
├── queue.py              # Queue persistence, dequeue on reconnect, status transitions
└── tool.py               # DesktopToolCallTool — routes call via registry, queues if unavailable

src/brain/routers/
├── devices.py            # POST /devices/register, WS /devices/{id}/ws, GET /devices

src/dashboard/routers/
├── downloads.py          # GET /downloads/desktop-agent/latest, GET /downloads/desktop-agent/file/{platform}
├── device_tokens.py      # POST /device-tokens, DELETE /device-tokens/{id}, GET /device-tokens
├── device_assignments.py # POST /agents/{id}/desktop-device, DELETE /agents/{id}/desktop-device
```

#### Desktop runtime (separate Python package)
```
src/desktop_agent/
├── __init__.py
├── __main__.py           # Entry point, asyncio event loop
├── config.py             # Load %APPDATA%\Nuvex\desktop-agent.json
├── connection.py         # WebSocket client, reconnect loop, heartbeat
├── dispatcher.py         # Routes tool_call_request → tool implementation
├── idle.py               # GetLastInputInfo polling, idle state machine
├── scheduler.py          # Permission mode logic, queue drain orchestration
├── tray.py               # pystray icon, state machine, context menu
├── notifications.py      # winotify toasts, tkinter approval/progress popups
├── setup_wizard.py       # First-run tkinter wizard (brain URL + token + mode)
└── tools/
    ├── __init__.py
    ├── screen.py         # mss screenshot → base64 PNG
    ├── uia.py            # pywinauto: list_windows, find_control, click_control, get_text
    ├── input.py          # pynput: type_text, hotkey, mouse_click
    ├── com_outlook.py    # win32com: get_emails, send_email, reply_email
    ├── clipboard.py      # pyperclip: get/set clipboard
    └── shell.py          # subprocess.run (T1 only)
```

### 9. Connection Security

- Device registers with a one-time token generated in the dashboard
- Token stored hashed in `desktop_device_tokens` (same pattern as API keys)
- All WebSocket frames are delivered over TLS (wss://)
- Additional HMAC-SHA256 signature on each JSON frame using a session key derived during registration
- Token revocation immediately closes the WebSocket and prevents reconnect
- Brain-side governance still enforced — `GovernedToolNode` checks tier before dispatching to device

### 10. Packaging Strategy

- Python 3.12, `uv` for dependency management
- PyInstaller: `--onefile --windowed --icon=assets/nuvex-tray.ico`
- Config: `%APPDATA%\Nuvex\desktop-agent.json`
- Optional auto-start: registry key `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`
- Local task queue: `%APPDATA%\Nuvex\queue.json`
- Logs: `%APPDATA%\Nuvex\logs\desktop-agent.log` (rotating, 10MB max, 3 files)

### 11. Dashboard Download Page

Platform card layout designed for extensibility:

```
┌──────────────────────────────────────────────────┐
│  NUVEX Desktop Companion  v0.1.0                 │
│  Let your agents work on your desktop             │
├────────────────┬────────────────┬────────────────┤
│ Windows 11     │ macOS          │ Linux          │
│ x86_64         │                │                │
│ [Download]     │ Coming soon    │ Coming soon    │
│ 42 MB          │                │                │
└────────────────┴────────────────┴────────────────┘
```

Platform data model:
```typescript
type Platform = {
  id: "windows" | "macos" | "linux"
  label: string
  arch: string          // "x86_64" | "arm64" | "universal"
  status: "available" | "coming_soon" | "beta"
  version?: string
  fileUrl?: string
  fileSizeLabel?: string
}
```

`status: "coming_soon"` renders a greyed card with disabled download.

Below the cards: collapsible setup instructions (tailored per platform).

## Testing Strategy

- **Unit tests**: device registry lifecycle, queue state transitions, agent-device gating logic, idle detection state machine, permission mode scheduler decisions
- **API tests**: device register/WS handshake, token CRUD, download metadata endpoint
- **Integration tests**: mock device connects via WS, brain dispatches tool call, receives result, graph resumes
- **Desktop runtime tests**: tool dispatcher routing, screenshot capture (mocked mss), UIA control finding (mocked pywinauto)
- **End-to-end test**: queued offline → device reconnects → idle detected → approved → executed → result returned → graph resumed
