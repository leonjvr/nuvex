## Why

NUVEX agents can read/write files, fetch web pages, send messages, delegate to other agents, and execute skill scripts. But they cannot interact with web applications, fill forms, click buttons, take screenshots, or perform any GUI-level automation. This is a critical I/O gap for an AI Operating System — an OS that can only talk to text APIs is like an OS with a serial port but no USB.

HiveClaw (the TypeScript predecessor) has Playwright browser automation. NUVEX needs equivalent capability, governance-gated, so agents can browse the web, interact with SaaS tools, and perform visual verification tasks — all under the same 5-stage governance pipeline.

**Priority: HIGH** — This is the biggest functional capability gap. Without browser control, agents cannot interact with the majority of the digital world.

## What Changes

- **New `browser-control` plugin** — A governed plugin that wraps Playwright for headless browser automation. Provides tools: `browser_navigate`, `browser_click`, `browser_type`, `browser_screenshot`, `browser_extract`, `browser_execute_js`.
- **Governance integration** — All browser tools pass through the full governance pipeline. `browser_navigate` is classified as a T1 tool (autonomous for T1 agents). `browser_execute_js` is classified as T2 (requires approval for destructive operations).
- **Browser pool** — A managed pool of Playwright browser contexts with per-agent session isolation. Contexts are reusable within a thread, destroyed on thread archive.
- **Screenshot capture** — Screenshots stored in thread scratch directory, optionally sent to the LLM as vision input (for models supporting multimodal).
- **MCP server bridge** — Ability to connect to external Playwright MCP servers for when agents want to use browser via MCP protocol rather than direct Playwright.

> **Note:** API-based multi-provider web search (`web_search` cascade) has been moved to the `native-skills` change. This intentionally keeps the ~400 MB Playwright/Chromium image cost separate from lightweight keyless web search. Implementers of this change should skip `web-search-cascade` and treat `native-skills` as the implementation of that capability.

### Amendment to Existing Specs

- **Section 8 (Tool Execution)** — New browser tools registered alongside built-in tools
- **Section 21 (Tool Hooks)** — Browser-specific PostToolUse hook for screenshot PII masking
- **Section 6 (Governance Pipeline)** — Browser tool tier classifications added to default forbidden/approval lists

## Capabilities

### New Capabilities
- `browser-automation`: Playwright-based headless browser control with governance-gated tools
- `browser-pool`: Per-agent browser context management with session isolation

### Modified Capabilities
- `tool-execution`: Browser tools registered as built-in tools available to configured agents
- `governance-pipeline`: Browser tool tier classifications in default policy
- `tool-hooks`: Screenshot PII masking hook

## Impact

- **Dependencies** — `playwright` Python package added to pyproject.toml; Playwright browsers installed in Docker image
- **Docker image size** — Chromium adds ~400MB to brain image. Consider separate `Dockerfile.brain-browser` or lazy browser install.
- **Memory** — Each browser context uses ~50-100MB. Pool size limited by agent count and memory.
- **Governance** — Browser navigation is a T1 tool (agents can browse autonomously). JS execution is T2 (requires approval). Browser is forbidden for T3 agents by default.
- **Network** — Browser tools make outbound HTTP requests; subject to network policy and `network` plugin permission.
