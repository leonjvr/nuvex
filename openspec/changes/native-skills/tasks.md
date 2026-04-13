## 1. Infrastructure & Registry

- [ ] 1.1 Create `src/brain/skills/` and `src/brain/skills/native/` package directories with `__init__.py` files
- [ ] 1.2 Define `SkillRegistry` class: `load_all()`, `list()`, `get_tools_for_agent(agent_id)` methods
- [ ] 1.3 Create `skill.yaml` manifest schema (Pydantic model): `id`, `name`, `version`, `tools` fields
- [ ] 1.4 Create Alembic migration to add `agent_skill_config` table (`agent_id`, `skill_id`, `enabled`, `config_json`)
- [ ] 1.5 Implement default-row seeding: on brain startup, insert missing `agent_skill_config` rows from `divisions.yaml` `skills:` lists
- [ ] 1.6 Wire `SkillRegistry.load_all()` into brain startup sequence (before LangGraph graph is built)
- [ ] 1.7 Inject per-agent active tools from `SkillRegistry.get_tools_for_agent()` into each agent's LangGraph tool node

## 2. GET /api/skills Endpoint

- [ ] 2.1 Create `src/brain/routers/skills.py` with `GET /api/skills` returning list of registered skills
- [ ] 2.2 Include `providers` field in web-search skill response showing active/inactive status per provider
- [ ] 2.3 Register `skills` router in `src/brain/server.py`

## 3. Office Docs Skill

- [ ] 3.1 Create `src/brain/skills/native/office-docs/` package with `skill.yaml` manifest
- [ ] 3.2 Create `src/brain/skills/native/office-docs/client.py`: `OfficeWorkerClient(base_url: str)` using `httpx`; reads `OFFICE_WORKER_URL` from env (default `http://office-worker:9105`)
- [ ] 3.3 Implement `read_document(path: str, sheet: str | None = None) -> dict` tool: calls `POST /v1/read`; enforce 50 MB limit before call; return dict with `text`, `tables`, `comments`, `tracked_changes`
- [ ] 3.4 Implement `write_document(path: str, paragraphs: list, tables: list | None = None, rows: list | None = None) -> str` tool: calls `POST /v1/write`; supports `{text, style}` paragraph dicts for named Word styles
- [ ] 3.5 Implement `accept_changes(path: str) -> dict` tool: calls `POST /v1/accept-changes`
- [ ] 3.6 Implement `reject_changes(path: str) -> dict` tool: calls `POST /v1/reject-changes`
- [ ] 3.7 Implement `convert_document(input_path: str, output_path: str, target_format: str) -> str` tool: calls `POST /v1/convert`; return error string for unsupported format pairs
- [ ] 3.8 Implement `compile_latex(path: str, engine: str = "pdflatex") -> dict` tool: calls `POST /v1/latex/compile`; accepts `.tex` or `.zip`; return `{"status":"ok","output_path":"..."}` or `{"status":"error","log":"..."}`
- [ ] 3.9 Handle `httpx.ConnectError` in all tools: return `"office-worker unreachable: <detail>"` without raising
- [ ] 3.10 Remove `python-docx`, `openpyxl`, `python-pptx`, `pypdf` from `pyproject.toml` if present; ensure `httpx` is listed

## 4. Web Search Skill

- [ ] 4.1 Create `src/brain/skills/native/web-search/` package with `skill.yaml` manifest
- [ ] 4.2 Implement `BraveSearchProvider` using Brave Search API v1; skip if `BRAVE_SEARCH_API_KEY` absent
- [ ] 4.3 Implement `SerperSearchProvider` using Serper.dev API; skip if `SERPER_API_KEY` absent
- [ ] 4.4 Implement `TavilySearchProvider` using Tavily API; skip if `TAVILY_API_KEY` absent
- [ ] 4.5 Implement `DuckDuckGoSearchProvider` using HTML scrape fallback (no key required)
- [ ] 4.6 Implement cascade logic in `web_search(query, max_results=5)` tool: try providers in order, return on first non-empty result
- [ ] 4.7 Add `httpx` to `pyproject.toml` if not already present
- [ ] 4.8 Validate `max_results` capped at 20; enforce in tool input schema

## 5. Tests

- [ ] 5.1 Unit tests for `SkillRegistry`: load valid skill, skip invalid manifest, `get_tools_for_agent` returns correct subset
- [ ] 5.2 Unit tests for `agent_skill_config` seeding: correct defaults from `divisions.yaml`, runtime override persists
- [ ] 5.3 Unit tests for `OfficeWorkerClient`: mock `httpx` responses for read, write, accept-changes, reject-changes, convert, latex/compile
- [ ] 5.4 Unit tests for 50 MB file size enforcement: tool returns error before making any HTTP call
- [ ] 5.5 Unit tests for office-worker unreachable: `httpx.ConnectError` is caught and returns error string
- [ ] 5.6 Unit tests for web-search cascade: mock provider returns, fallback logic, max_results cap
- [ ] 5.7 Integration test for `GET /api/skills` endpoint: correct skill list, correct provider active flags
