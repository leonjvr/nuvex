## 1. Browser Pool & Lifecycle

> Spec: `specs/browser-pool/spec.md`
>
> Managed Playwright browser pool with per-agent context isolation.
>
> **Priority: HIGH** — Foundation for all browser tools.

- [ ] 1.1 Add `playwright` to `pyproject.toml` dependencies
- [ ] 1.2 Update `Dockerfile.brain` — install Playwright Chromium browser: `playwright install --with-deps chromium`
- [ ] 1.3 Create `src/brain/browser/__init__.py` — exports `BrowserPool`, browser tools
- [ ] 1.4 Create `src/brain/browser/pool.py` — `BrowserPool` class: single Playwright instance, per-agent `BrowserContext` dict, `create_context(agent_id)`, `get_context(agent_id)`, `close_context(agent_id)`, `close_all()`
- [ ] 1.5 Implement pool limits — `max_contexts` (default 5) from `nuvex.yaml` `browser_pool:` config; queue excess requests with 60s timeout
- [ ] 1.6 Implement context reuse — same agent within same thread gets existing context; different thread creates new context
- [ ] 1.7 Implement lifecycle integration — on agent `Finished` lifecycle event, close browser context; on Brain shutdown, `close_all()`
- [ ] 1.8 Wire `BrowserPool` into `server.py` lifespan — initialize in startup, close in shutdown; skip if browser tools disabled

## 2. Browser Automation Tools

> Spec: `specs/browser-automation/spec.md`
>
> Playwright-based headless browser tools: navigate, click, type, screenshot, extract, execute_js, download.
>
> **Priority: HIGH** — Core browser capability.

- [ ] 2.1 Create `src/brain/browser/tools.py` — register all browser tools using LangChain `BaseTool` pattern
- [ ] 2.2 Implement `browser_navigate` tool — `BrowserNavigateTool(url: str)`: get/create context, goto URL, wait for load, return `{title, url, content (innerText trimmed to 8000 chars), status}`
- [ ] 2.3 Implement `browser_click` tool — `BrowserClickTool(selector: str | None, text: str | None)`: click by CSS selector or text content, wait for navigation/idle, return updated page state
- [ ] 2.4 Implement `browser_type` tool — `BrowserTypeTool(selector: str, text: str, clear: bool = True)`: focus, optionally clear, type text, return field value
- [ ] 2.5 Implement `browser_extract` tool — `BrowserExtractTool(selector: str, fields: dict | None, mode: str = "text")`: extract structured data or text from current page
- [ ] 2.6 Implement `browser_execute_js` tool — `BrowserExecuteJsTool(script: str)`: evaluate JS in page context, return JSON-serialized result
- [ ] 2.7 Implement `browser_download` tool — `BrowserDownloadTool(url: str, filename: str | None)`: download file to scratch dir, enforce scratch quota, return `{path, size_kb, content_type}`
- [ ] 2.8 Create `src/brain/browser/screenshot.py` — `capture_screenshot(context, thread_id, full_page: bool)`: save PNG to scratch dir, return path and metadata
- [ ] 2.9 Implement `browser_screenshot` tool — `BrowserScreenshotTool(full_page: bool = False)`: capture screenshot, if model supports vision add to next LLM call as image content block
- [ ] 2.10 Register all browser tools in `src/brain/tools_registry.py` — only include for agents with `browser: true` in config or `browser-control` plugin enabled

## 3. Browser Governance Integration

> Spec: `specs/browser-automation/spec.md` (governance section)
>
> Browser tools classified by tier in the governance pipeline.
>
> **Priority: HIGH** — Must ship with §2.

- [ ] 3.1 Add browser tool tier classifications to default governance config — `browser_navigate`, `browser_click`, `browser_type`, `browser_screenshot`, `browser_extract` as T1; `browser_execute_js`, `browser_download` as T2
- [ ] 3.2 Add all browser tools to T3 forbidden list by default (overridable via policy engine)
- [ ] 3.3 Add `PostToolUse` hook for browser screenshots — run PII mask patterns against OCR'd text (or skip OCR in V1 and rely on governance-level URL filtering)
- [ ] 3.4 Add policy engine default rule: `browser_rate_limit` — max 30 browser tool calls per 5-minute window per agent

## 4. Web Search Cascade

> Spec: `specs/web-search-cascade/spec.md`
>
> Multi-provider search with automatic fallback chain.
>
> **Priority: HIGH** — Low-effort, high-impact. Agents need web search.

- [ ] 4.1 Create `src/brain/browser/search.py` — `WebSearchTool(query: str, max_results: int = 10)` with cascade logic
- [ ] 4.2 Create `src/brain/browser/providers/__init__.py` — `SearchProvider` protocol: `async search(query, max_results) -> SearchResult | None`
- [ ] 4.3 Create `src/brain/browser/providers/brave.py` — Brave Search API client using `httpx`; requires `BRAVE_API_KEY` from plugin config
- [ ] 4.4 Create `src/brain/browser/providers/serper.py` — Serper API client; requires `SERPER_API_KEY`
- [ ] 4.5 Create `src/brain/browser/providers/tavily.py` — Tavily API client; requires `TAVILY_API_KEY`
- [ ] 4.6 Create `src/brain/browser/providers/ddg.py` — DuckDuckGo HTML scrape client; no API key; rate-limited to 1 req/s
- [ ] 4.7 Implement cascade logic in `search.py` — try providers in order, skip unconfigured providers, first success returns; all fail → error with attempted providers list
- [ ] 4.8 Implement unified result format — normalise all provider responses to `{provider, query, results: [{title, url, snippet, published_date}], total_results}`
- [ ] 4.9 Register `web_search` tool in `tools_registry.py` — available to all agents (T1 classification, governed)
- [ ] 4.10 Add search API key configuration to plugin config schema — keys stored encrypted in `agent_plugin_config`

## 5. Docker & Dependencies

> Infrastructure for browser support in Docker.
>
> **Priority: HIGH** — Must ship with §1.

- [ ] 5.1 Update `Dockerfile.brain` — install Playwright deps and Chromium; consider multi-stage build to minimise final image size
- [ ] 5.2 Add `browser_pool:` config block to `config/nuvex.yaml` schema — `enabled: bool = false`, `max_contexts: int = 5`, `default_viewport: {width: 1280, height: 720}`
- [ ] 5.3 Add `browser: bool = false` field to `AgentDefinition` in `src/shared/config.py` — agents must opt-in to browser tools

## 6. Testing

> **Priority: HIGH** — Must validate governance integration and isolation.

- [ ] 6.1 Write unit test: `BrowserPool` creates and returns isolated contexts per agent; closes on request
- [ ] 6.2 Write unit test: pool at max capacity queues requests; timeout returns error
- [ ] 6.3 Write unit test: `browser_navigate` returns correct structure with title, url, content, status
- [ ] 6.4 Write unit test: `browser_click` with non-existent selector returns element_not_found error
- [ ] 6.5 Write unit test: `browser_screenshot` saves file to scratch dir and returns path
- [ ] 6.6 Write unit test: `browser_execute_js` governance classification is T2; T2 agent triggers approval gate
- [ ] 6.7 Write unit test: T3 agent denied all browser tools by default forbidden list
- [ ] 6.8 Write unit test: web search cascade — first provider fails, second succeeds, returns second provider's results
- [ ] 6.9 Write unit test: web search — all providers fail, returns error with attempted list
- [ ] 6.10 Write unit test: search result normalisation produces unified format from each provider's raw response
- [ ] 6.11 Write integration test: navigate to httpbin.org, extract page title, take screenshot — all tools work end-to-end
- [ ] 6.12 Write integration test: web search actually queries DuckDuckGo fallback and returns results
