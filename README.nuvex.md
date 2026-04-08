# NUVEX — Unified Autonomous Agent Platform

NUVEX is a Python-first, LangGraph-powered alternative to OpenClaw/Paperclip. It unifies multi-channel messaging (WhatsApp, Telegram, Email), a governance pipeline, cost tracking, and an ops dashboard into a single deployable stack.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    NUVEX Production Stack                │
│                                                         │
│  ┌──────────────┐   ┌──────────────┐   ┌────────────┐  │
│  │ gateway-wa   │   │ gateway-tg   │   │ gateway-mail│  │
│  │ (Baileys/WA) │   │ (Telegram)   │   │ (IMAP/SMTP)│  │
│  └──────┬───────┘   └──────┬───────┘   └─────┬──────┘  │
│         │                  │                  │         │
│         └──────────────────┼──────────────────┘         │
│                            ▼                            │
│                    ┌───────────────┐                    │
│                    │     brain     │  LangGraph + FastAPI│
│                    │  (port 8100)  │                    │
│                    └───────┬───────┘                    │
│                            │                            │
│                 ┌──────────┴──────────┐                 │
│                 ▼                     ▼                 │
│          ┌─────────────┐    ┌─────────────────┐        │
│          │  PostgreSQL  │    │    dashboard    │        │
│          │  + pgvector  │    │  React + FastAPI│        │
│          └─────────────┘    └─────────────────┘        │
└─────────────────────────────────────────────────────────┘
```

All services bind to the **Netbird VPN IP** — not exposed on `0.0.0.0`.

---

## Quick Start (local)

```bash
# 1. Start brain + database
docker compose -f docker-compose.local.yml up --build

# 2. Health check
curl http://localhost:9100/health
# → {"status":"ok","db":"connected","version":"0.1.0"}

# 3. Send a message
curl -X POST http://localhost:9100/invoke \
  -H 'Content-Type: application/json' \
  -d '{"agent_id":"maya","thread_id":"t1","channel":"api","message":"Hello!"}'
```

---

## Production Deploy

### Prerequisites

- VPS with Debian 12 / Ubuntu 22+ (2 vCPU / 4 GB RAM minimum)
- Netbird account and setup key

### Steps

```bash
# 1. Provision server (install Docker, Netbird, UFW)
bash scripts/provision-nuvex.sh

# 2. Copy config
cp .env.nuvex.example .env
# Edit .env — fill in DB_PASSWORD, API keys, bot tokens

# 3. Deploy
bash scripts/deploy-nuvex.sh
```

Services are then accessible from any **Netbird peer** at:

| Service | URL |
|---------|-----|
| Brain API | `http://<NETBIRD_IP>:9100` |
| Dashboard | `http://<NETBIRD_IP>:9200` |
| WA gateway health | `http://<NETBIRD_IP>:9101/health` |
| TG gateway health | `http://<NETBIRD_IP>:9102/health` |
| Mail gateway health | `http://<NETBIRD_IP>:9103/health` |

---

## Migrating from OpenClaw

```bash
python -m src.shared.migration.import_openclaw \
  --openclaw-config /root/.openclaw/openclaw.json \
  --workspace-src   /root/.openclaw/workspace \
  --workspace-dst   workspace/ \
  --output          config/nuvex.yaml \
  --agent-name      maya
```

Review the generated `config/nuvex.yaml`, then `bash scripts/deploy-nuvex.sh`.

---

## Project Structure

```
src/
├── brain/              # LangGraph agent + FastAPI (port 8100)
│   ├── governance/     # forbidden, approval, audit, budget, policy_engine
│   ├── models/         # SQLAlchemy 2.0 models
│   ├── nodes/          # LangGraph nodes: route_model, call_llm, execute_tools
│   ├── routing/        # Task classifier + model router
│   ├── tools/          # Shell, file, HTTP tools
│   └── routers/        # FastAPI: /invoke, /agents, /health
├── dashboard/          # Ops dashboard FastAPI + React/Vite (port 8200)
│   ├── routers/        # agents, audit, cron, costs, events, threads, tasks, workspace
│   └── frontend/       # React + Tailwind + TanStack Query
├── gateway/
│   ├── whatsapp/       # Node.js / Baileys WA gateway (port 8101)
│   ├── telegram/       # python-telegram-bot v21 (port 8102)
│   └── email/          # aioimaplib + aiosmtplib (port 8103)
└── shared/
    ├── config.py       # load_config() / get_cached_config()
    ├── models/         # Pydantic request/response + config
    └── migration/      # import_openclaw.py OpenClaw migrator
config/
    nuvex.yaml          # Agent definitions
scripts/
    provision-nuvex.sh  # VPS bootstrap
    deploy-nuvex.sh     # Docker build + deploy
```

---

## Configuration (`config/nuvex.yaml`)

```yaml
agents:
  maya:
    name: maya
    workspace_path: workspace/
    model:
      primary: openai/gpt-4o-mini
      fallback: openai/gpt-4o
    routing:
      simple_reply:     { model: openai/gpt-4o-mini, tier: fast }
      conversation:     { model: openai/gpt-4o-mini, tier: standard }
      code_generation:  { model: openai/gpt-4o,      tier: smart }
      voice_response:   { model: openai/gpt-4o-mini, tier: fast }
    budget:
      daily_usd: 5.0
      warn_at_fraction: 0.8
      hard_stop: true
    tools: [shell, read_file, write_file, http_get]
```

---

## Key Design Decisions

| Concern | OpenClaw | NUVEX |
|---------|----------|-------|
| Runtime | TypeScript / Node.js | Python 3.12 + LangGraph |
| State | JSONL session files | PostgreSQL + SQLAlchemy |
| Channels | Plugins | Separate gateway services |
| Governance | Prompt-only | Code-enforced pipeline |
| Dashboard | None | React + FastAPI |
| Cost tracking | None | Per-invocation w/ budget caps |
| Migration | — | `import_openclaw` CLI |
