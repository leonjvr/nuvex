## Context

NUVEX agents interact with the external world through three channels (WhatsApp, Telegram, Email), a `web_fetch` tool that does HTTP GET and returns text content, file read/write within agent workspace, and skill scripts executed as subprocesses. There is no capability for visual/interactive web automation.

Existing infrastructure:
- `src/brain/tools/builtin.py` — WebFetchTool does `httpx.get()` and returns response text
- `src/brain/tools_registry.py` — agent-scoped tool collection
- `src/brain/nodes/execute_tools.py` — GovernedToolNode with pre/post hooks
- `src/brain/governance/` — 5-stage pipeline including forbidden, approval, budget, classification, policy
- `src/nuvex_plugin/` — Plugin SDK with `register_tool()`, permissions model
- `src/brain/hooks/pii_mask.py` — PostToolUse PII masking hook
- Thread scratch dir at `data/threads/<thread_id>/scratch/`

Constraints:
- Playwright runs in the Brain process (not sandboxed via nsjail — browser needs full network access)
- Browser contexts must be isolated per-agent (no cookie/session leakage between agents)
- Screenshots may contain PII — must pass through PII masking hook
- Chromium needs to run headless in Docker; no X server
- Search providers require API keys — configurable per-agent via plugin config

## Goals / Non-Goals

**Goals:**
- Playwright-based headless browser tools governed by the 5-stage pipeline
- Per-agent browser context isolation with resuse within a thread
- Screenshot capture to scratch dir with optional vision-model input
- Multi-provider web search cascade as a governed tool
- MCP server bridge for external Playwright MCP

**Non-Goals:**
- Desktop GUI automation (click desktop apps, move mouse on host screen)
- Full browser profile persistence (cookies/sessions destroyed on thread end)
- Real-time streaming browser content to the dashboard
- Browser automation for T3 agents (forbidden by default policy)

## Decisions

### 1. Playwright as Browser Engine

Playwright (Python) for headless browser automation. It supports Chromium, Firefox, and WebKit. We use Chromium only in production to minimise Docker image size.

**Why not Selenium?** Playwright has better async support, faster execution, built-in network interception, and better TypeScript/Python parity.
**Why not Puppeteer?** Python-native is preferred for the NUVEX stack; Playwright has feature parity.

### 2. Browser Tool Classification

| Tool | Tier | Default Policy |
|---|---|---|
| `browser_navigate` | T1 | Autonomous — agents can browse freely |
| `browser_click` | T1 | Autonomous — click elements on page |
| `browser_type` | T1 | Autonomous — type into input fields |
| `browser_screenshot` | T1 | Autonomous — capture page state |
| `browser_extract` | T1 | Autonomous — extract text/data from page |
| `browser_execute_js` | T2 | Requires approval — arbitrary JS execution |
| `browser_download` | T2 | Requires approval — file downloads |
| `web_search` | T1 | Autonomous — search the web |

T3 agents: all browser tools forbidden by default (configurable via policy engine).

### 3. Browser Pool Architecture

```
BrowserPool
├── _browsers: dict[str, BrowserContext]   # keyed by agent_id
├── _playwright: Playwright                 # single Playwright instance
├── create_context(agent_id) → BrowserContext
├── get_context(agent_id) → BrowserContext | None
├── close_context(agent_id) → None
├── close_all() → None
```

- One Playwright instance per Brain process
- One BrowserContext per agent (isolated cookies, localStorage, etc.)
- Context reused within a thread; closed on thread archive or agent lifecycle → Finished
- Max 5 concurrent contexts by default (`browser_pool.max_contexts` in nuvex.yaml)
- Excess requests queued; timeout after 60s

### 4. Screenshot Handling

Screenshots saved to `data/threads/<thread_id>/scratch/screenshot_<timestamp>.png`.
- If the model supports vision (e.g., Claude with vision, GPT-4V), the screenshot is included in the next LLM call as an image content block.
- Screenshots pass through `PiiMaskHook` — the hook checks for PII in OCR'd text (not in the image itself; V1 limitation).
- Screenshots older than the thread's lifetime are cleaned up with scratch dir.

### 5. Web Search Cascade

```
web_search(query) →
  1. Brave Search API (if BRAVE_API_KEY configured)
  2. Serper API (if SERPER_API_KEY configured)
  3. Tavily API (if TAVILY_API_KEY configured)
  4. DuckDuckGo HTML scrape (no API key required, rate-limited)
```

First provider that returns results wins. If all fail, return error to agent.
Each provider is a pluggable backend — new providers can be added as plugins.

### 6. MCP Bridge

For agents with MCP server configurations pointing to a Playwright MCP server (e.g., `@playwright/mcp`), the existing `mcp_loader.py` already loads MCP tools. The browser plugin provides a native alternative for agents that don't need MCP overhead.

Both can coexist — MCP browser tools and native browser tools are distinct tool names (no collision).

## Module Structure

```
src/brain/browser/
├── __init__.py
├── pool.py           # BrowserPool — context lifecycle management
├── tools.py          # Tool definitions: navigate, click, type, screenshot, extract, execute_js, download
├── search.py         # Web search cascade with provider backends
├── screenshot.py     # Screenshot capture, scratch dir integration, vision input formatting
└── providers/
    ├── __init__.py
    ├── brave.py      # Brave Search API client
    ├── serper.py     # Serper API client
    ├── tavily.py     # Tavily API client
    └── ddg.py        # DuckDuckGo HTML scrape client
```

## Testing Strategy

- **Unit tests**: mock Playwright API; test tool classification, pool lifecycle, search cascade fallback
- **Integration tests**: headless Chromium in Docker; navigate to httpbin.org, screenshot, extract, search
- **Governance tests**: verify browser_execute_js requires T2 approval; T3 agents get forbidden denial
