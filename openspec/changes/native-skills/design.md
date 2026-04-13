## Context

The NUVEX brain runs as a LangGraph StateGraph inside a FastAPI server. Tools are registered as LangGraph tool nodes and invoked via the normal agent loop. Today there is no built-in tool library — operators add tools by installing skills from external registries or writing custom Python files. This creates friction: business agents need working document and search tools on day one without any setup.

The design adds a `native-skills` subsystem that is loaded at brain startup and activates tools selectively per agent based on `divisions.yaml` config and a database toggle.

## Goals / Non-Goals

**Goals:**
- Ship two skill packages (office-docs, web-search) as part of the base brain image
- web-search supersedes the `web-search-cascade` capability previously planned in `browser-computer-control`; that change retains only Playwright browser automation
- Allow per-agent activation so agents that don't need a skill never see its tools
- Keep all tool invocations inside the 5-stage governance pipeline unchanged
- Support optional API keys — web-search degrades gracefully to free providers if paid keys are absent
- Expose a `/api/skills` endpoint listing loaded skill packages and per-agent activation state

**Non-Goals:**
- ClawHub integration or community skill packaging (separate future change)
- GUI skill management UI (toggles in dashboard deferred)
- Sandboxed execution / capability isolation per tool invocation (existing governance model is sufficient)
- Streaming binary content (e.g. large file uploads) — initial version handles files ≤ 20 MB passed as base64 or local path

## Decisions

### D1 — Skill as a Python package in `src/brain/skills/native/`

**Decision:** Each skill is a Python sub-package with a manifest (`skill.yaml`) and a `tools.py` exporting a list of LangChain-compatible tool objects. Brain startup iterates `skills/native/*/skill.yaml`, instantiates tools, and registers them in a global `SkillRegistry`.

**Exception — office-docs-skill:** This skill is an HTTP client wrapper, not a bundled Python library. Its `tools.py` calls the `office-worker` container via `httpx`. The brain image does **not** bundle `python-docx`, `openpyxl`, `python-pptx`, or `pypdf`. The `OFFICE_WORKER_URL` env var (default: `http://office-worker:9105`) must be set for this skill to function.

**Alternative considered:** Dynamic import from `/data/skills/` directory (runtime installs). Rejected — it introduces class loading complexity and makes image builds non-reproducible.

### D2 — Per-agent activation via `agent_skill_config` table

**Decision:** A new `agent_skill_config` table (`agent_id TEXT, skill_id TEXT, enabled BOOL, config_json JSONB`) controls which skills are visible to each agent. Defaults come from `divisions.yaml` `skills:` list. At startup, if an agent has no row, one is inserted with `enabled = skill_id in divisions.yaml skills list`.

**Rationale:** Database-stored state is the NUVEX pattern for runtime mutability (budget rows, thread rows). `divisions.yaml` provides the default; DB allows runtime overrides without redeployment.

**Alternative considered:** `divisions.yaml` only (no DB). Rejected — can't toggle per-agent without a restart.

### D3 — Web search cascade order

**Decision:** Brave → Serper → Tavily → DuckDuckGo (scrape). The cascade tries each provider in order, skipping those without a configured API key, and returns on first successful non-empty result set.

**Rationale:** Brave and Serper have generous free tiers and clean JSON APIs. DuckDuckGo HTML scraping is a no-key fallback that always works. This maximises availability without requiring configuration.

**Alternative considered:** Single configurable provider. Rejected — agents should always be able to search; a cascade gives resilience and budget flexibility.

### D4 — Office file I/O via shared volume path (no base64)

**Decision:** Office tools accept a file path relative to the shared `/data/files/` volume mount. The `office-worker` container also mounts the same volume, so no data is copied over HTTP for normal usage. The office-worker API supports HTTP multipart for edge cases where the volume is unavailable; the brain skill uses path-only mode.

**Rationale:** A shared volume is simpler, faster, and avoids base64 memory overhead. The `office-worker` design already specifies both modes; choosing path-only in the brain skill keeps the tool signatures clean.

## Risks / Trade-offs

- **office-worker unavailable** → If the container is down, office-docs tools return a clear error (`office-worker unreachable`); the rest of the agent loop continues unaffected.
- **Large files** → office-worker enforces a 50 MB limit. The brain skill validates against this before calling the API.
- **Search API key rotation** → Cascade silently falls through to DuckDuckGo if a key is revoked. Mitigation: `/api/skills` endpoint reports which providers are active so operators can spot missing keys.
- **DDG scraping reliability** → DuckDuckGo HTML structure can change. Mitigation: wrap in try/except; if DDG fails the search tool returns an empty result with a warning rather than crashing.

## Migration Plan

1. Add `httpx` to `pyproject.toml`; remove `python-docx`, `openpyxl`, `python-pptx`, `pypdf` if present
2. Add `OFFICE_WORKER_URL=http://office-worker:9105` to `docker-compose.local.yml` brain service env
3. Run Alembic migration to create `agent_skill_config` table
4. Brain startup populates default rows from `divisions.yaml` (idempotent)
5. No changes to existing threads, agents, or governance pipeline
6. `office-worker` change must be deployed before native-skills goes live; both are deployed together
7. Rollback: remove `skills/native/` directory and revert migration — no data loss

## Open Questions

- Should web-search results be cached per-thread to avoid repeated API spend? → **Deferred to v2**; add a TTL cache in the search tool if burn rate proves significant.
