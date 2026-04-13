## Why

NUVEX agents can communicate through chat channels (WhatsApp, Telegram, Email), read/write files, fetch web pages, and execute skill scripts. But they have zero ability to interact with a user's local desktop environment — they cannot open applications, read content from windows, click UI controls, compose emails in Outlook, or perform any native desktop automation. This is the single largest isolation barrier between an AI agent and real daily productivity work.

The browser-computer-control change covers headless web automation on the brain server. Desktop agent orchestration covers a fundamentally different surface: the user's physical Windows desktop, running Outlook, Excel, SAP, or any other native application. The brain runs in the cloud; the desktop is behind a NAT, on a home or office network. Standard MCP (stdio/SSE) transports cannot reach it without tunnels.

HiveClaw's TypeScript predecessor has remote-node execution with a 5-tier security model. NUVEX needs the equivalent — governance-gated, queue-aware, user-respecting desktop automation that connects to the brain over the internet with zero tunnel configuration.

**Priority: HIGH** — This closes the largest remaining I/O gap between NUVEX agents and real-world productivity workflows.

## What Changes

- **Brain device channel** — New WebSocket endpoint (`/devices/{device_id}/ws`) that desktop runtimes connect to outbound. In-memory + DB-backed device registry tracks connected devices with heartbeat.
- **Desktop task queue** — When a device is offline or user is active, tool calls are queued in PostgreSQL. LangGraph graph suspends via `GraphInterrupt("desktop_unavailable")` and resumes when result arrives. Full lifecycle: `queued → waiting_idle → waiting_permission → running → succeeded | failed | cancelled`.
- **Explicit agent-to-device gating** — Desktop capability is never automatic. An operator must explicitly assign a device to a specific agent via the dashboard. `get_tools_for_agent()` includes desktop tools only when assignment exists AND device is connected.
- **Windows 11 tray runtime** — A Python executable (`nuvex-desktop.exe`) that runs in the system tray, maintains an outbound WebSocket to the brain, dispatches tool calls to local automation libraries (pywinauto UIA, win32com COM, mss screenshots, pynput keyboard/mouse), and respects user activity at all times.
- **Idle-aware non-interruption** — The tray runtime monitors `GetLastInputInfo()` to detect user activity. It never executes while the user is actively using keyboard/mouse. Two configurable modes: `ask` (show approval popup when idle) and `auto` (execute immediately when idle).
- **User-visible notifications** — Tray icon state changes, Windows toast notifications for pending tasks, progress popup with cancel button during execution.
- **Dashboard downloads page** — Platform-card UI with Windows 11 download available, macOS and Linux shown as "Coming soon". Device token generation and revocation for onboarding.
- **Outlook COM tools** — First-class `outlook_get_emails`, `outlook_send_email`, `outlook_reply` tools using win32com, bypassing vision/screenshot for structured email workflows.

### Amendment to Existing Specs

- **Tool Execution** — New `DesktopToolCallTool` registered alongside built-in tools, routed via device WebSocket registry
- **Governance Pipeline** — Desktop tool tier classifications added to default policy; audit events for desktop queue/execute lifecycle
- **Agent Configuration** — `AgentDefinition` gains optional `desktop_device: str | None` field

## Capabilities

### New Capabilities
- `desktop-device-channel`: Outbound WebSocket connectivity from user PC to cloud brain with heartbeat, reconnect, and queue semantics
- `desktop-agent-gating`: Explicit per-agent device assignment via dashboard, enforced at tool-binding time
- `desktop-task-queue`: Persistent queue with graph interrupt/resume correlation for offline/busy devices
- `desktop-runtime-win11`: System tray executable with idle detection, permission modes, and cooperative scheduling
- `desktop-tools-windows`: Screenshot, UIA window/control automation, keyboard/mouse, Outlook COM, clipboard
- `dashboard-downloads`: Platform-aware binary distribution page with device token onboarding

### Modified Capabilities
- `tool-execution`: Desktop tool call routed via WebSocket device registry
- `governance-pipeline`: Desktop tool classifications in default policy
- `agent-configuration`: `desktop_device` field on AgentDefinition

## Impact

- **Dependencies** — Brain: `websockets` for device channel (or FastAPI native WebSocket). Desktop runtime: `pywinauto`, `pywin32`, `mss`, `pynput`, `pystray`, `winotify`, `pyinstaller` (build only).
- **Database** — New tables: `desktop_devices`, `desktop_device_tokens`, `desktop_agent_assignments`, `desktop_task_queue`. Alembic migration required.
- **Docker** — No impact on brain Docker image; desktop runtime is a standalone Windows executable, not containerised.
- **Network** — Desktop initiates outbound WebSocket to brain (no NAT/firewall config needed). Brain must accept WebSocket upgrades on the device endpoint.
- **Governance** — Desktop tools classified by tier. `screenshot`, UIA, Outlook tools available at T2+. `shell` and `run_app` restricted to T1. All calls pass through 5-stage pipeline.
- **Security** — Device tokens hashed at rest. HMAC-signed WebSocket messages. TLS transport. Revocable tokens scoped per device.

## Non-Goals (v1)

- macOS desktop automation (AppScript/Accessibility)
- Linux desktop automation (AT-SPI/xdotool)
- Remote desktop streaming UI
- Browser automation on the desktop (handled by browser-computer-control change)
- Multi-user shared device (one user per device registration)
- Full session recording/replay
