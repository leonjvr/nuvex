## Why

NUVEX agents currently have no built-in tool library — users must install skills from an external registry (ClawHub), introducing supply-chain trust variance and deployment friction. The two highest-demand skill categories on ClawHub (office document editing at 132k downloads, multi-provider web search at 175k downloads combined) are universally needed for business agents and should ship with the platform, not require installation. API-based web search was previously bundled into the `browser-computer-control` change alongside Playwright automation, which inflates the brain image by ~400 MB for all deployments. Moving it here gives every NUVEX deployment lightweight, keyless web search with no browser dependency.

## What Changes

- Add a native-skills subsystem that ships built-in tools with every NUVEX brain deployment
- Tools live in `src/brain/skills/native/` and are loaded automatically at startup — no `pip install`, no ClawHub registry call
- Per-agent activation controlled via `divisions.yaml` skill lists and `agent_skill_config` table in PostgreSQL
- All native skill tool calls are governed by the standard 5-stage pipeline (no bypass)
- Initial skill set:
  - **office-docs**: full-fidelity document operations (read, write, convert, tracked changes, LaTeX→PDF) delegated to the `office-worker` container via HTTP; the brain skill is a thin client — `OFFICE_WORKER_URL` env var points to the worker
  - **web-search**: multi-provider cascade (Brave → Serper → Tavily → DuckDuckGo) with automatic fallback; returns structured results with title, URL, snippet
- Skills are discoverable via `/api/skills` endpoint on the brain server

## Capabilities

### New Capabilities

- `native-skill-registry`: Skill loader, registry, and `agent_skill_config` activation model
- `office-docs-skill`: Read/write Word, Excel, PowerPoint, PDF files
- `web-search-skill`: Multi-provider cascading web search with fallback (supersedes `web-search-cascade` capability in `browser-computer-control`; that change retains only Playwright browser automation)

### Modified Capabilities

- (none — no existing spec-level requirements change)

## Impact

- **New Python deps on brain**: `httpx` only (for search providers and office-worker client calls); `python-docx`, `openpyxl`, `python-pptx`, `pypdf` are removed from the brain image
- **Depends on**: `office-worker` change — brain's office-docs-skill requires the `office-worker` service to be running
- **`browser-computer-control` change**: the `web-search-cascade` capability listed in that change is superseded here; implementers of that change should skip `web-search-cascade` and reference `native-skills` instead
- **New env vars**: `BRAVE_SEARCH_API_KEY`, `SERPER_API_KEY`, `TAVILY_API_KEY` (all optional; cascade skips key-less providers)
- **DB**: new `agent_skill_config` table (agent_id, skill_id, enabled, config_json)
- **`divisions.yaml`**: new `skills:` key under each agent definition for opt-in/opt-out
- **Governance**: no changes to pipeline stages; skill tools are treated as regular agent tools
- **Dockerfile.brain**: adds all new Python deps to the brain image
