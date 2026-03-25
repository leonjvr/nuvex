# SIDJUA Desktop GUI

Native desktop application for the [SIDJUA](../README.md) AI agent governance platform, built with **Tauri 2.0**, **React 18**, **TypeScript**, and **Vite 6**.

---

## Overview

The SIDJUA Desktop GUI provides a real-time monitoring and governance dashboard that connects to a running SIDJUA server over its REST API. It is a **pure API client** — all data and governance logic lives in the SIDJUA server process; the GUI only displays and controls it.

### Features

| Page | Description |
|---|---|
| **Dashboard** | Summary metrics, division overview, real-time activity feed, system health |
| **Agents** | Live agent list with status updates, filterable by division/status, detail panel |
| **Governance** | Pipeline overview, snapshot history, CLI reference |
| **Audit Log** | Filterable, paginated audit trail with JSON/CSV export |
| **Cost Tracking** | Spend by period, division breakdown, sortable agent cost table |
| **Configuration** | Division config viewer (syntax-highlighted JSON), system info, log levels |
| **Settings** | Server URL + API key, light/dark theme toggle |

---

## Requirements

| Dependency | Version |
|---|---|
| Node.js | 22+ |
| npm | 10+ |
| Rust + Cargo | stable (install from [rustup.rs](https://rustup.rs)) |

---

## Development

```bash
# Install dependencies
npm install

# Start Vite dev server only (no Tauri window)
npm run dev

# Start with native Tauri window (requires Rust)
npm run tauri:dev
```

Open `http://localhost:1420` in a browser for the Vite-only dev experience (no native features).

---

## Build

```bash
# Using the build script (recommended)
./scripts/build.sh

# Specific platform cross-check
./scripts/build.sh --target linux
./scripts/build.sh --target macos
./scripts/build.sh --target windows

# Debug build (faster, larger binary)
./scripts/build.sh --debug

# Direct Tauri CLI
npm run tauri:build
```

Artifacts are produced in `src-tauri/target/release/bundle/`:

| Platform | Format |
|---|---|
| Linux | `.deb`, `.rpm`, `.AppImage` |
| macOS | `.dmg`, `.app` |
| Windows | `.msi`, `.exe` (NSIS) |

---

## Configuration

Connection settings (server URL + API key) are saved to browser `localStorage` by the Settings page. No config files are written to disk beyond Tauri's own state.

### Environment variables (Vite build time)

| Variable | Default | Description |
|---|---|---|
| `VITE_DEFAULT_SERVER_URL` | `http://localhost:3000` | Pre-filled server URL |

---

## Project Structure

```
sidjua-gui/
├── src/
│   ├── api/
│   │   ├── client.ts       # SidjuaApiClient — typed REST wrappers
│   │   ├── sse.ts          # SidjuaSSEClient — SSE with ticket auth + reconnect
│   │   └── types.ts        # All API response types
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Shell.tsx       # Root layout (sidebar + header + main)
│   │   │   ├── Sidebar.tsx     # Navigation (collapses to icons < 1000px)
│   │   │   └── Header.tsx      # Breadcrumbs + connection indicator
│   │   └── shared/
│   │       ├── ActivityFeed.tsx  # Real-time event stream
│   │       ├── ConfirmDialog.tsx # Modal confirmation with danger variant
│   │       ├── ErrorBoundary.tsx
│   │       ├── LoadingSpinner.tsx
│   │       ├── MetricCard.tsx
│   │       ├── ProgressBar.tsx
│   │       ├── StatusBadge.tsx
│   │       ├── Toast.tsx         # Toast stack + ToastProvider + useToast hook
│   │       └── ThemeToggle.tsx
│   ├── hooks/
│   │   ├── useAgents.ts    # Agent list with filter deps
│   │   ├── useAgent.ts     # Single agent detail
│   │   ├── useApi.ts       # Generic fetch hook with cancellation
│   │   ├── useDivisions.ts # Division list
│   │   ├── useHealth.ts    # Polling health check (30s interval)
│   │   ├── useSse.ts       # SSE connection + last event
│   │   ├── useTheme.ts     # theme context consumer
│   │   └── useUndo.ts      # Undo stack + Ctrl/Cmd+Z global handler
│   ├── lib/
│   │   ├── config.ts       # AppConfigProvider + useAppConfig
│   │   ├── download.ts     # Browser Blob export helpers
│   │   ├── format.ts       # formatCurrency, formatUptime, formatRelative, …
│   │   ├── highlight.ts    # JSON syntax highlighter (no library)
│   │   └── theme.ts        # ThemeProvider
│   ├── pages/
│   │   ├── Agents.tsx
│   │   ├── AuditLog.tsx
│   │   ├── Configuration.tsx
│   │   ├── CostTracking.tsx
│   │   ├── Dashboard.tsx
│   │   ├── Governance.tsx
│   │   └── Settings.tsx
│   ├── styles/
│   │   └── globals.css     # CSS custom properties, dark/light themes
│   ├── App.tsx
│   └── main.tsx
├── src-tauri/
│   ├── tauri.conf.json     # Tauri configuration, CSP, bundle metadata
│   ├── Cargo.toml
│   └── src/
│       └── main.rs
├── scripts/
│   └── build.sh            # Cross-platform build helper
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## Real-Time Updates

The GUI connects to the SIDJUA SSE endpoint for live updates:

1. **Ticket auth**: `POST /api/v1/sse/ticket` (Bearer token) → UUID ticket
2. **EventSource**: `GET /api/v1/events?ticket=<uuid>`
3. **Reconnect**: exponential backoff (1s → 30s max)
4. **Event types**: `agent:started`, `agent:stopped`, `task:created`, `task:completed`, `governance:blocked`, `cost:budget_warning`, etc.

The Dashboard seeds its activity feed from the REST audit log on first load, then prepends live SSE events. The Agents page maintains a `Map<id, Agent>` that's updated on every agent SSE event with a 1.5s flash animation.

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Escape` | Close detail panel (Agents, Audit Log) |
| `Ctrl+Z` / `Cmd+Z` | Undo last undoable action |

---

## License

AGPL-3.0-only — same as the SIDJUA server. See [../LICENSE](../LICENSE).
