## 1. Brain Device Channel

> Spec: `specs/device-channel/spec.md`
>
> WebSocket endpoint and in-memory registry for desktop device connections.
>
> **Priority: HIGH** — Foundation for all desktop capability.

- [x] 1.1 Create `src/brain/devices/__init__.py` — exports `DeviceRegistry`, `DesktopToolCallTool`
- [x] 1.2 Create `src/brain/devices/models.py` — SQLAlchemy models: `DesktopDevice` (id, name, platform, owner, last_seen_at, is_connected, created_at), `DesktopDeviceToken` (id, token_hash, device_id nullable, created_by, created_at, revoked_at), `DesktopAgentAssignment` (agent_id, device_id, enabled, created_at), `DesktopTaskQueue` (id, agent_id, device_id, graph_thread_id, tool_name, payload_json, status enum, created_at, updated_at, result_json, error, call_id uuid)
- [x] 1.3 Create Alembic migration for all four desktop tables
- [x] 1.4 Create `src/brain/devices/registry.py` — `DeviceRegistry` class: in-memory `dict[str, WebSocket]`, `register(device_id, ws)`, `unregister(device_id)`, `get(device_id) -> WebSocket | None`, `is_connected(device_id) -> bool`, `list_connected() -> list[str]`
- [x] 1.5 Create `src/brain/routers/devices.py` — `POST /devices/register` (validates token, creates/updates `DesktopDevice` record, returns `device_id` + session key), `WebSocket /devices/{device_id}/ws` (authenticates, registers in registry, heartbeat ping/pong loop, dispatches incoming tool results to queue resolver), `GET /devices` (list registered devices with connected status)
- [x] 1.6 Implement WebSocket message protocol — JSON frames: `tool_call` (brain→device), `tool_result` (device→brain), `tool_error` (device→brain), `heartbeat` (bidirectional), `queue_drain` (brain→device, batch of queued tasks on reconnect)
- [x] 1.7 Implement heartbeat and disconnect detection — ping every 30s, timeout after 90s, mark device disconnected in DB, clean up registry entry
- [x] 1.8 Wire devices router into `src/brain/server.py` — include router, initialize `DeviceRegistry` in app lifespan

## 2. Desktop Task Queue

> Spec: `specs/task-queue/spec.md`
>
> Persistent queue with graph interrupt/resume for offline and busy devices.
>
> **Priority: HIGH** — Required for reliable offline operation.

- [x] 2.1 Create `src/brain/devices/queue.py` — `TaskQueueManager` class: `enqueue(agent_id, device_id, graph_thread_id, tool_name, payload, call_id) -> queue_id`, `dequeue_for_device(device_id) -> list[QueuedTask]`, `update_status(queue_id, status, result_json?, error?)`, `get_pending_count(device_id) -> int`
- [x] 2.2 Implement status lifecycle transitions — `queued → dispatched → waiting_idle → waiting_permission → running → succeeded | failed | cancelled`; validate transitions (no backward movement except `dispatched → queued` on disconnect)
- [x] 2.3 Implement `GraphInterrupt` integration — when tool call is queued, raise `GraphInterrupt("desktop_unavailable", metadata={"queue_id": queue_id, "device_id": device_id})`; store graph thread_id for resume correlation
- [x] 2.4 Implement queue drain on reconnect — when device connects, query all `queued` tasks for that device, send as `queue_drain` message, update status to `dispatched`
- [x] 2.5 Implement result-to-resume correlation — when `tool_result` arrives with `call_id`, look up `DesktopTaskQueue` by `call_id`, update result, trigger `POST /invoke/resume` internally with the result payload
- [x] 2.6 Implement queue expiry — tasks older than 24h (configurable) auto-transition to `cancelled` with reason `expired`; no graph resume for expired tasks

## 3. Agent Capability Gating

> Spec: `specs/capability-gating/spec.md`
>
> Explicit per-agent device assignment enforced at tool-binding time.
>
> **Priority: HIGH** — Security boundary. Must ship with §1.

- [x] 3.1 Create `src/brain/devices/tool.py` — `DesktopToolCallTool(BaseTool)`: accepts `device_id` (auto-resolved from agent assignment), `tool` name, `args` dict; routes via `DeviceRegistry` if connected, enqueues via `TaskQueueManager` if not
- [x] 3.2 Extend `get_tools_for_agent()` in `src/brain/tools_registry.py` — query `DesktopAgentAssignment` for agent; if assignment exists AND `DeviceRegistry.is_connected(device_id)` → include `DesktopToolCallTool` with pre-bound `device_id`; otherwise exclude entirely
- [x] 3.3 Add `desktop_device: str | None = None` field to `AgentDefinition` in `src/shared/models/config.py`
- [x] 3.4 Create dashboard API: `POST /agents/{agent_id}/desktop-device` (assign device), `DELETE /agents/{agent_id}/desktop-device` (revoke), `GET /agents/{agent_id}/desktop-device` (current assignment)
- [x] 3.5 Create `src/dashboard/routers/device_assignments.py` — implements assignment CRUD with validation (device must exist, agent must exist, no duplicate assignments for same device)
- [x] 3.6 Add desktop tool tier classifications to default governance config — T2+ for UIA/screenshot/Outlook tools, T1-only for shell/run_app; all desktop tools forbidden for T3/T4 by default

## 4. Desktop Runtime — Connection & Core

> Spec: `specs/desktop-runtime/spec.md`
>
> Windows 11 system tray executable: connection, tray, state machine.
>
> **Priority: HIGH** — The deliverable the user downloads.

- [x] 4.1 Create `src/desktop_agent/__init__.py` and `src/desktop_agent/__main__.py` — asyncio event loop entry point, initialise config→connection→dispatcher→tray
- [x] 4.2 Create `src/desktop_agent/config.py` — load/save `%APPDATA%\Nuvex\desktop-agent.json` with Pydantic model: `brain_url: str`, `device_id: str`, `auth_token: str`, `desktop_mode: Literal["ask", "auto"]`, `idle_threshold_seconds: int = 60`
- [x] 4.3 Create `src/desktop_agent/connection.py` — async WebSocket client: `connect()`, `reconnect_loop()` (exponential backoff, max 60s), `send(msg)`, `recv()` generator, heartbeat sender task, `on_disconnect` callback
- [x] 4.4 Create `src/desktop_agent/dispatcher.py` — `Dispatcher` class: receives `tool_call` frames, looks up tool by name, calls implementation, returns `tool_result` or `tool_error` frame; handles unknown tool names gracefully
- [x] 4.5 Create `src/desktop_agent/tray.py` — `pystray` system tray icon with state machine: `disconnected`, `connected_idle`, `queued_user_active`, `awaiting_permission`, `executing`, `error`; right-click menu: Status, Settings, View Queue, Quit
- [x] 4.6 Implement tray icon state visuals — different `.ico` files per state (or dynamic icon generation via Pillow); tooltip shows connection status and pending task count

## 5. Desktop Runtime — Idle Detection & Scheduling

> Spec: `specs/desktop-runtime/spec.md` (idle and scheduling section)
>
> Cooperative scheduling that respects user activity.
>
> **Priority: HIGH** — Non-interruption guarantee.

- [x] 5.1 Create `src/desktop_agent/idle.py` — `IdleDetector` class: polls `ctypes.windll.user32.GetLastInputInfo()` every 5s, exposes `is_idle(threshold_seconds) -> bool`, `seconds_since_input() -> float`, emits `idle_start` / `idle_end` events
- [x] 5.2 Create `src/desktop_agent/scheduler.py` — `Scheduler` class: holds local task queue, listens to idle events, implements mode logic: `ask` mode → transition to `awaiting_permission` → show popup → on approve → execute; `auto` mode → transition to `executing` → run tasks
- [x] 5.3 Implement cooperative pause — during execution, if `IdleDetector` fires `idle_end` (user became active), `Scheduler` finishes current atomic tool step then pauses; does not abort mid-keystroke or mid-click
- [x] 5.4 Implement local queue persistence — `%APPDATA%\Nuvex\queue.json`: tasks received but not yet executed survive tray app restarts; merged with brain queue on reconnect
- [x] 5.5 Implement per-device rate limiter — max 5 tool calls per second to prevent tight screenshot loops

## 6. Desktop Runtime — Notifications & UX

> Spec: `specs/desktop-runtime/spec.md` (notifications section)
>
> User-visible feedback for all desktop agent activity.
>
> **Priority: MEDIUM** — Important for user trust.

- [x] 6.1 Create `src/desktop_agent/notifications.py` — `NotificationManager` class: wraps `winotify` for Windows toast notifications; methods: `notify_pending(count)`, `notify_executing(task_name)`, `notify_complete(summary)`, `notify_error(message)`
- [x] 6.2 Implement approval popup — `tkinter.Toplevel` anchored near taskbar: shows task list, Approve All / Reject All / Review buttons; closes on action or timeout (configurable, default 5 min → auto-reject)
- [x] 6.3 Implement progress popup — `tkinter.Toplevel` near taskbar: shows current task name, progress indicator, Cancel button; updates in real-time; disappears when batch completes
- [x] 6.4 Implement toast for pending tasks — when tray transitions to `queued_user_active`, show non-intrusive Windows toast: "Nuvex has N tasks ready — waiting for your desktop to be free"
- [x] 6.5 Create `src/desktop_agent/setup_wizard.py` — first-run `tkinter` wizard: Brain URL input, device token paste field, mode selection (ask/auto), idle threshold slider, Test Connection button, Save & Start

## 7. Desktop Tools — Screen & UIA

> Spec: `specs/desktop-tools/spec.md`
>
> Screenshot capture and Windows UIA automation tools.
>
> **Priority: HIGH** — Core desktop interaction.

- [x] 7.1 Create `src/desktop_agent/tools/__init__.py` — tool registry dict mapping tool name → async callable
- [x] 7.2 Create `src/desktop_agent/tools/screen.py` — `screenshot(monitor: int | None = None) -> {"image_base64": str, "width": int, "height": int, "monitor": int}` using `mss`; resize to max 1920px wide before encoding
- [x] 7.3 Create `src/desktop_agent/tools/uia.py` — `list_windows() -> [{"title": str, "class_name": str, "pid": int, "rect": {...}}]` using `pywinauto.Desktop(backend="uia").windows()`
- [x] 7.4 Implement `find_control(window_title: str, control_type: str | None, name: str | None, automation_id: str | None) -> {"found": bool, "handle": int, "name": str, "control_type": str, "rect": {...}}` — walks UIA tree in the matching window
- [x] 7.5 Implement `click_control(window_title: str, name: str | None, automation_id: str | None) -> {"clicked": bool, "control": str}` — invokes the UIA click pattern on the control (by handle, not screen coordinates)
- [x] 7.6 Implement `get_control_text(window_title: str, name: str | None, automation_id: str | None) -> {"text": str}` — reads Value or Text pattern from the control

## 8. Desktop Tools — Input & Clipboard

> Spec: `specs/desktop-tools/spec.md` (input section)
>
> Keyboard, mouse, and clipboard tools.
>
> **Priority: HIGH** — Required for apps without structured UIA/COM.

- [x] 8.1 Create `src/desktop_agent/tools/input.py` — `type_text(text: str, interval: float = 0.02) -> {"typed": bool, "length": int}` using `pynput.keyboard.Controller`
- [x] 8.2 Implement `hotkey(keys: list[str]) -> {"sent": bool, "keys": [...]}` — e.g. `["ctrl", "c"]`; uses `pyautogui.hotkey()`
- [x] 8.3 Implement `mouse_click(x: int, y: int, button: str = "left") -> {"clicked": bool, "x": int, "y": int}` — fallback for apps without UIA; uses `pyautogui.click()`
- [x] 8.4 Create `src/desktop_agent/tools/clipboard.py` — `get_clipboard() -> {"content": str}`, `set_clipboard(text: str) -> {"set": bool}` using `pyperclip`

## 9. Desktop Tools — Outlook COM

> Spec: `specs/desktop-tools/spec.md` (Outlook section)
>
> Structured Outlook email automation via win32com — no screenshots needed.
>
> **Priority: HIGH** — Primary use case for desktop agent.

- [x] 9.1 Create `src/desktop_agent/tools/com_outlook.py` — `get_emails(folder: str = "Inbox", count: int = 10, search: str | None = None) -> {"emails": [{"subject": str, "from": str, "date": str, "body_preview": str, "entry_id": str}]}`; uses `win32com.client.Dispatch("Outlook.Application").GetNamespace("MAPI")`
- [x] 9.2 Implement `send_email(to: str | list[str], subject: str, body: str, cc: str | list[str] | None = None, attachments: list[str] | None = None) -> {"sent": bool, "to": [...]}` — creates MailItem, sets fields, calls `.Send()`
- [x] 9.3 Implement `reply_email(entry_id: str, body: str, reply_all: bool = False) -> {"replied": bool, "subject": str}` — finds message by EntryID, calls `.Reply()` or `.ReplyAll()`, sets body, sends
- [x] 9.4 Implement `move_email(entry_id: str, target_folder: str) -> {"moved": bool}` — moves message to named folder
- [x] 9.5 Add COM error handling — catch `pywintypes.com_error`, return structured error with HRESULT code and message; handle Outlook not running (start it or return clear error)

## 10. Desktop Tools — Shell

> Spec: `specs/desktop-tools/spec.md` (shell section)
>
> Application launch and shell command execution — T1 only.
>
> **Priority: MEDIUM** — Useful but high-risk; governance-gated.

- [x] 10.1 Create `src/desktop_agent/tools/shell.py` — `run_app(executable: str, args: list[str] | None = None) -> {"pid": int, "started": bool}` — launches via `subprocess.Popen`, does not wait; returns PID
- [x] 10.2 Implement `shell_exec(command: str, timeout: int = 30) -> {"stdout": str, "stderr": str, "exit_code": int}` — runs via `subprocess.run()` with timeout; stderr/stdout capped at 10KB each

## 11. Dashboard — Downloads Page

> Spec: `specs/dashboard-downloads/spec.md`
>
> Multi-platform download page with device token onboarding.
>
> **Priority: MEDIUM** — Distribution mechanism.

- [x] 11.1 Create `src/dashboard/routers/downloads.py` — `GET /downloads/desktop-agent/latest` returns `{"version": str, "platforms": [Platform]}` with Windows available and macOS/Linux as coming_soon
- [x] 11.2 Implement `GET /downloads/desktop-agent/file/{platform}` — streams file from configured path (`DESKTOP_AGENT_DOWNLOAD_PATH` env var) or redirects to external URL (`DESKTOP_AGENT_DOWNLOAD_URL` env var)
- [x] 11.3 Create dashboard frontend Downloads page component — platform card grid, disabled state for coming_soon, collapsible per-platform setup instructions
- [x] 11.4 Add "Downloads" entry to dashboard sidebar navigation with monitor-arrow-down icon

## 12. Dashboard — Device Tokens

> Spec: `specs/device-tokens/spec.md`
>
> Token issuance and revocation for device onboarding.
>
> **Priority: HIGH** — Required for secure device registration.

- [x] 12.1 Create `src/dashboard/routers/device_tokens.py` — `POST /device-tokens` (create token, return plaintext once, store hash), `GET /device-tokens` (list active/revoked tokens with device names), `DELETE /device-tokens/{id}` (revoke token, disconnect device if connected)
- [x] 12.2 Implement token hash storage — `hashlib.sha256(token.encode()).hexdigest()` stored in `DesktopDeviceToken.token_hash`; plaintext never stored
- [x] 12.3 Add device tokens management UI to dashboard Settings page — table of tokens with name, device, created date, status, Revoke button; Create Token dialog
- [x] 12.4 Implement token validation in device registration endpoint — lookup by hash, verify not revoked, optionally bind to device_id on first use

## 13. Dashboard — Agent Device Assignment

> Spec: `specs/capability-gating/spec.md` (dashboard section)
>
> UI for assigning/revoking desktop devices on agents.
>
> **Priority: MEDIUM** — Operator workflow.

- [x] 13.1 Add "Desktop" tab to agent detail page in dashboard — shows current assignment, device status (connected/disconnected), Assign/Remove buttons
- [x] 13.2 Implement device picker dropdown — queries `GET /devices` for registered devices, shows name + platform + connection status
- [x] 13.3 Wire assignment actions to `POST/DELETE /agents/{id}/desktop-device` endpoints

## 14. Governance & Audit

> Spec: `specs/capability-gating/spec.md` (governance section)
>
> Audit trail for all desktop agent activity.
>
> **Priority: HIGH** — Must ship with §1.

- [x] 14.1 Emit audit events for desktop task lifecycle — `desktop.task.queued`, `desktop.task.dispatched`, `desktop.task.waiting_idle`, `desktop.task.waiting_permission`, `desktop.task.approved`, `desktop.task.rejected`, `desktop.task.running`, `desktop.task.succeeded`, `desktop.task.failed`, `desktop.task.cancelled`, `desktop.task.expired`
- [x] 14.2 Include correlation fields in all audit events — `agent_id`, `device_id`, `call_id`, `tool_name`, `queue_id`
- [x] 14.3 Emit audit events for device lifecycle — `desktop.device.registered`, `desktop.device.connected`, `desktop.device.disconnected`, `desktop.device.token_revoked`
- [x] 14.4 Wire desktop audit events into existing audit infrastructure (same sink as governance audit)

## 15. Packaging & Distribution

> Packaging the desktop runtime as a Windows executable.
>
> **Priority: MEDIUM** — Required for end-user delivery.

- [x] 15.1 Create `src/desktop_agent/pyproject.toml` — separate package with dependencies: `pywinauto`, `pywin32`, `mss`, `pynput`, `pyautogui`, `pystray`, `winotify`, `pyperclip`, `websockets`, `pillow`, `pydantic`
- [x] 15.2 Create PyInstaller spec file `src/desktop_agent/nuvex-desktop.spec` — `--onefile --windowed --icon=assets/nuvex-tray.ico`, hidden imports for win32com, pywintypes
- [x] 15.3 Create build script `scripts/build-desktop-agent.ps1` — installs deps in venv, runs PyInstaller, outputs to `dist/nuvex-desktop.exe`
- [x] 15.4 Create GitHub Actions workflow `.github/workflows/build-desktop-agent.yml` — builds on Windows runner, uploads artifact, optionally publishes to GitHub Releases
- [x] 15.5 Create tray icon assets — `assets/nuvex-tray-grey.ico`, `nuvex-tray-green.ico`, `nuvex-tray-orange.ico`, `nuvex-tray-red.ico`

## 16. Testing

> **Priority: HIGH** — Must validate all safety and gating guarantees.

- [x] 16.1 Write unit tests: `DeviceRegistry` — register/unregister/get/is_connected/list_connected lifecycle
- [x] 16.2 Write unit tests: `TaskQueueManager` — enqueue, dequeue, status transitions, expiry, invalid transitions rejected
- [x] 16.3 Write unit tests: agent capability gating — assigned+connected→tool present, unassigned→tool absent, assigned+disconnected→tool present but queues
- [x] 16.4 Write unit tests: `GraphInterrupt` raised on queue, resume on result delivery
- [x] 16.5 Write unit tests: `IdleDetector` — mock `GetLastInputInfo`, verify `is_idle()` at various thresholds
- [x] 16.6 Write unit tests: `Scheduler` — ask mode shows popup, auto mode executes, user-active defers execution, cooperative pause on activity during execution
- [x] 16.7 Write unit tests: `Dispatcher` — routes known tools, returns error for unknown tools
- [x] 16.8 Write unit tests: Outlook COM tools — mock `win32com.client.Dispatch`, verify get/send/reply/move
- [x] 16.9 Write API tests: `POST /devices/register` with valid/invalid/revoked tokens
- [x] 16.10 Write API tests: `WS /devices/{id}/ws` handshake, heartbeat, tool_call dispatch, tool_result receipt
- [x] 16.11 Write API tests: device token CRUD — create returns plaintext, list shows hash only, revoke disconnects device
- [x] 16.12 Write API tests: download metadata endpoint returns correct platform status
- [x] 16.13 Write integration test: full offline→reconnect→idle→approve→execute→result→resume pipeline
