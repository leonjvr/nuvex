## Context

NUVEX brain is a Python/LangGraph application. Currently all strings — system prompts, governance messages, tool error messages — are hardcoded in English. The `locales/` directory at the repo root contains JSON translation files for the WhatsApp/Telegram gateways, but only for user-facing gateway strings, not brain-internal messages. There is no mechanism to select a locale per conversation or per agent.

The design must work without requiring changes to the LangGraph graph structure and must not increase latency on the hot path.

## Goals / Non-Goals

**Goals:**
- Locale resolution per conversation thread (user pref > agent default > `en`)
- All brain-generated user-facing strings (governance rejections, agent error messages, tool call failures) are translatable
- Translation files use the same BCP-47 JSON format already established in `locales/`
- `GET /api/locales` lists available locales and completeness vs English baseline
- English is always 100% complete and is the fallback for any missing key

**Non-Goals:**
- Translating agent-generated content (the LLM handles its own language based on the system prompt instruction)
- Automatic language detection from user messages (user sets their locale explicitly or inherits agent default)
- Right-to-left (RTL) layout changes in the dashboard (dashboard i18n is deferred)
- Machine translation pipeline (all translations are human-authored JSON)

## Decisions

### D1 — Brain-internal translation files live in `src/brain/i18n/locales/`

**Decision:** A new `src/brain/i18n/locales/` directory holds brain-specific translation JSON files, separate from the root `locales/` gateway translations.

**Rationale:** Brain and gateway strings have different lifecycles. Mixing them in one file creates merge conflicts and unclear ownership. Two separate directories keeps each service self-contained.

**Alternative considered:** Single shared `locales/` at root. Rejected — brain deploys as a Docker image; the gateway YAML files should not be baked into the brain image.

### D2 — Locale stored on the `threads` table, not in Redis/session

**Decision:** The active locale for a thread is stored as `locale TEXT` on the `threads` table (nullable, falls back to agent default).

**Rationale:** NUVEX threads are long-lived and database-backed. Storing locale in the DB makes it durable across restarts and accessible to all brain nodes without additional coordination.

### D3 — Translation key format: flat dot-notation

**Decision:** Translation keys use dot-notation strings (e.g. `governance.budget_exceeded`, `tool.file_size_limit`). JSON files are flat (no nested objects).

**Rationale:** Flat files are easier to diff, easier to count missing keys, and avoid ambiguity about deep-merge behaviour when partial translations are loaded.

**Alternative considered:** Nested JSON objects. Rejected — creates "which level is the namespace?" ambiguity and makes completeness checks harder.

### D4 — Language instruction injected into agent system prompt

**Decision:** When the resolved locale is not `en`, the brain injects a short instruction at the top of the agent's system prompt: `"You MUST respond in <language name>."`. This is the simplest way to make the LLM respond in the correct language without modifying the SOUL.md authoring process.

**Rationale:** LLMs reliably obey language instructions in the system prompt. This approach requires zero per-language prompt authoring.

## Risks / Trade-offs

- **Incomplete translations** → Missing keys fall back to English silently. Mitigation: `GET /api/locales` reports completeness %; operators can see what's missing.
- **Conflicting agent locale vs user preference** → User preference always wins. If a user sets `ar` on an agent configured for `es`, they get Arabic. This is intentional UX but operators should be aware.
- **Prompt inflation** → Language instruction adds ~8 tokens per request. Negligible.

## Migration Plan

1. Alembic migration: add nullable `locale TEXT` column to `threads` table
2. Create `src/brain/i18n/` module with resolver and loader
3. Seed `src/brain/i18n/locales/en.json` with all brain string keys
4. Add language instruction injection into `src/brain/nodes/system_prompt.py` (or equivalent)
5. No changes to existing data; existing threads default to agent locale or `en`
6. Rollback: revert migration, remove i18n module — no functional regression; strings revert to English
