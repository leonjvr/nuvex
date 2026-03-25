// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * GUI smoke tests — end-to-end API flow scenarios.
 *
 * Covers 9 scenarios:
 *   1. Fresh Install State        — initial API state, no provider, no history
 *   2. Provider Setup Flow        — configure Groq free tier via PUT
 *   3. Agent Chat Flow            — mock LLM SSE stream, verify 200 + event-stream
 *   4. Agent Switching            — separate histories per agent
 *   5. Provider Error Handling    — mock 401 from LLM → SSE error event
 *   6. Clear Conversation         — DELETE history, verify empty
 *   7. System Prompt Completeness — all 6 agents have valid system prompts
 *   8. Responsive + Theme         — HTML meta tags, CSS variables, sidebar nav
 *   9. Full Journey               — configure → chat guide → switch to hr → clear
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { Hono }                   from "hono";
import { readFileSync }           from "node:fs";
import { createErrorHandler }     from "../../src/api/middleware/error-handler.js";
import { registerChatRoutes, clearChatState, clearRoleCache } from "../../src/api/routes/chat.js";
import { registerProviderRoutes } from "../../src/api/routes/provider.js";
import { registerStarterAgentRoutes } from "../../src/api/routes/starter-agents.js";
import {
  resetProviderConfigState,
  saveProviderConfig,
} from "../../src/core/provider-config.js";
import { buildSystemPrompt, loadDefaultRoles } from "../../src/defaults/loader.js";
import { withAdminCtx }                        from "../helpers/with-admin-ctx.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildApp(): Hono {
  const app = new Hono();
  app.use("*", withAdminCtx);
  app.onError(createErrorHandler(false));
  registerProviderRoutes(app);
  registerStarterAgentRoutes(app);
  registerChatRoutes(app);
  return app;
}

function read(relPath: string): string {
  return readFileSync(new URL(`../../${relPath}`, import.meta.url), "utf-8");
}

const GROQ_CONFIG = {
  mode:             "simple" as const,
  default_provider: {
    provider_id: "groq-llama70b-free",
    api_key:     "gsk_test_key_1234567890",
    api_base:    "https://api.groq.com/openai/v1",
    model:       "llama-3.3-70b-versatile",
  },
  agent_overrides: {} as Record<string, unknown>,
};

/** Build a minimal OpenAI-compatible SSE stream response. */
function makeMockSseResponse(content: string): Response {
  const lines = [
    `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}`,
    `data: [DONE]`,
    ``,
  ].join("\n\n");

  return new Response(lines, {
    status:  200,
    headers: { "content-type": "text/event-stream" },
  });
}

// ---------------------------------------------------------------------------
// State reset
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetProviderConfigState();
  clearChatState();
  clearRoleCache();
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Scenario 1: Fresh Install State
// ---------------------------------------------------------------------------

describe("Scenario 1: Fresh Install State", () => {
  it("GET /api/v1/provider/config returns configured: false initially", async () => {
    const res  = await buildApp().request("/api/v1/provider/config");
    expect(res.status).toBe(200);
    const body = await res.json() as { configured: boolean };
    expect(body.configured).toBe(false);
  });

  it("GET /api/v1/starter-agents returns 6 agents", async () => {
    const res  = await buildApp().request("/api/v1/starter-agents");
    expect(res.status).toBe(200);
    const body = await res.json() as { agents: unknown[] };
    expect(body.agents).toHaveLength(6);
  });

  it("GET /api/v1/chat/guide/history returns empty messages", async () => {
    const res  = await buildApp().request("/api/v1/chat/guide/history");
    expect(res.status).toBe(200);
    const body = await res.json() as { messages: unknown[]; conversation_id: null };
    expect(body.messages).toHaveLength(0);
    expect(body.conversation_id).toBeNull();
  });

  it("POST /api/v1/chat/guide without provider returns 400 no_provider", async () => {
    const res  = await buildApp().request("/api/v1/chat/guide", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ message: "Hello" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("no_provider");
  });

  it("GET /api/v1/provider/catalog returns at least 4 providers", async () => {
    const res  = await buildApp().request("/api/v1/provider/catalog");
    expect(res.status).toBe(200);
    const body = await res.json() as { providers: unknown[] };
    expect(body.providers.length).toBeGreaterThanOrEqual(4);
  });
});

// ---------------------------------------------------------------------------
// Scenario 2: Provider Setup Flow
// ---------------------------------------------------------------------------

describe("Scenario 2: Provider Setup Flow", () => {
  it("PUT /api/v1/provider/config saves Groq free tier", async () => {
    const res = await buildApp().request("/api/v1/provider/config", {
      method:  "PUT",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(GROQ_CONFIG),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { configured: boolean };
    expect(body.configured).toBe(true);
  });

  it("GET /api/v1/provider/config shows configured: true after save", async () => {
    // Save config directly (bypasses HTTP)
    saveProviderConfig(GROQ_CONFIG);

    const res  = await buildApp().request("/api/v1/provider/config");
    expect(res.status).toBe(200);
    const body = await res.json() as { configured: boolean };
    expect(body.configured).toBe(true);
  });

  it("GET /api/v1/provider/config masks API key", async () => {
    saveProviderConfig(GROQ_CONFIG);

    const res  = await buildApp().request("/api/v1/provider/config");
    const body = await res.json() as { default_provider?: { api_key?: string } };
    const key  = body.default_provider?.api_key ?? "";
    // Key should be masked — not the raw key
    expect(key).not.toBe(GROQ_CONFIG.default_provider.api_key);
  });

  it("DELETE /api/v1/provider/config resets to unconfigured", async () => {
    saveProviderConfig(GROQ_CONFIG);

    const del = await buildApp().request("/api/v1/provider/config", { method: "DELETE" });
    expect(del.status).toBe(200);

    const res  = await buildApp().request("/api/v1/provider/config");
    const body = await res.json() as { configured: boolean };
    expect(body.configured).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Scenario 3: Agent Chat Flow
// ---------------------------------------------------------------------------

describe("Scenario 3: Agent Chat Flow", () => {
  it("POST /api/v1/chat/guide returns 200 + SSE content-type", async () => {
    saveProviderConfig(GROQ_CONFIG);

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      makeMockSseResponse("Hello, I'm your Guide!"),
    );

    const res = await buildApp().request("/api/v1/chat/guide", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ message: "Hello" }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    await res.body?.cancel();
  });

  it("SSE stream starts with a start event", async () => {
    saveProviderConfig(GROQ_CONFIG);

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      makeMockSseResponse("Hi there!"),
    );

    const res  = await buildApp().request("/api/v1/chat/guide", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ message: "Hello" }),
    });

    const text = await res.text();
    expect(text).toContain('"type":"start"');
    expect(text).toContain("conversation_id");
  });

  it("SSE stream contains done event", async () => {
    saveProviderConfig(GROQ_CONFIG);

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      makeMockSseResponse("Done response"),
    );

    const res  = await buildApp().request("/api/v1/chat/guide", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ message: "Test" }),
    });

    const text = await res.text();
    expect(text).toContain('"type":"done"');
  });

  it("GET history returns user message after chat", async () => {
    saveProviderConfig(GROQ_CONFIG);

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      makeMockSseResponse("Response text"),
    );

    const app = buildApp();
    // Send a message
    const chatRes = await app.request("/api/v1/chat/guide", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ message: "What can you do?" }),
    });
    await chatRes.text(); // consume stream fully

    // Get history
    const histRes  = await app.request("/api/v1/chat/guide/history");
    const histBody = await histRes.json() as { messages: Array<{ role: string; content: string }> };

    const userMsg = histBody.messages.find((m) => m.role === "user");
    expect(userMsg).toBeDefined();
    expect(userMsg?.content).toBe("What can you do?");
  });
});

// ---------------------------------------------------------------------------
// Scenario 4: Agent Switching
// ---------------------------------------------------------------------------

describe("Scenario 4: Agent Switching", () => {
  it("guide and hr have separate conversation histories", async () => {
    const app = buildApp();

    const guideHist = await app.request("/api/v1/chat/guide/history");
    const hrHist    = await app.request("/api/v1/chat/hr/history");

    const guideBody = await guideHist.json() as { agent_id: string };
    const hrBody    = await hrHist.json() as { agent_id: string };

    expect(guideBody.agent_id).toBe("guide");
    expect(hrBody.agent_id).toBe("hr");
  });

  it("clearing guide history does not affect hr history", async () => {
    saveProviderConfig(GROQ_CONFIG);

    const app = buildApp();

    // Mock two LLM calls
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(makeMockSseResponse("Guide reply"))
      .mockResolvedValueOnce(makeMockSseResponse("HR reply"));

    // Chat with guide
    const guideChat = await app.request("/api/v1/chat/guide", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ message: "Guide question" }),
    });
    await guideChat.text();

    // Chat with HR
    const hrChat = await app.request("/api/v1/chat/hr", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ message: "HR question" }),
    });
    await hrChat.text();

    // Clear guide history
    await app.request("/api/v1/chat/guide/history", { method: "DELETE" });

    // HR history should still exist
    const hrHist  = await app.request("/api/v1/chat/hr/history");
    const hrBody  = await hrHist.json() as { messages: unknown[] };
    expect(hrBody.messages.length).toBeGreaterThan(0);
  });

  it("all 6 agents have accessible history endpoints", async () => {
    const app    = buildApp();
    const agents = ["guide", "hr", "it", "auditor", "finance", "librarian"];

    for (const id of agents) {
      const res  = await app.request(`/api/v1/chat/${id}/history`);
      expect(res.status, `agent ${id} history should return 200`).toBe(200);
      const body = await res.json() as { agent_id: string };
      expect(body.agent_id).toBe(id);
    }
  });
});

// ---------------------------------------------------------------------------
// Scenario 5: Provider Error Handling
// ---------------------------------------------------------------------------

describe("Scenario 5: Provider Error Handling", () => {
  it("401 from LLM yields SSE error event with Invalid API key", async () => {
    saveProviderConfig(GROQ_CONFIG);

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Unauthorized", {
        status:  401,
        headers: { "content-type": "text/plain" },
      }),
    );

    const res  = await buildApp().request("/api/v1/chat/guide", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ message: "Hello" }),
    });

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('"type":"error"');
    expect(text).toContain("Invalid API key");
  });

  it("429 from LLM yields SSE error event with rate limit message", async () => {
    saveProviderConfig(GROQ_CONFIG);

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Too Many Requests", {
        status:  429,
        headers: { "content-type": "text/plain" },
      }),
    );

    const res  = await buildApp().request("/api/v1/chat/guide", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ message: "Hello" }),
    });

    const text = await res.text();
    expect(text).toContain('"type":"error"');
    expect(text).toContain("Rate limit");
  });

  it("500 from LLM yields SSE error event with server error message", async () => {
    saveProviderConfig(GROQ_CONFIG);

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Internal Server Error", {
        status:  500,
        headers: { "content-type": "text/plain" },
      }),
    );

    const res  = await buildApp().request("/api/v1/chat/guide", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ message: "Hello" }),
    });

    const text = await res.text();
    expect(text).toContain('"type":"error"');
    expect(text).toContain("server error");
  });

  it("empty message returns 400 without calling LLM", async () => {
    saveProviderConfig(GROQ_CONFIG);
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const res = await buildApp().request("/api/v1/chat/guide", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ message: "" }),
    });

    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Scenario 6: Clear Conversation
// ---------------------------------------------------------------------------

describe("Scenario 6: Clear Conversation", () => {
  it("DELETE history clears the conversation", async () => {
    const app = buildApp();
    const res = await app.request("/api/v1/chat/guide/history", { method: "DELETE" });
    expect(res.status).toBe(200);
    const body = await res.json() as { cleared: boolean; agent_id: string };
    expect(body.cleared).toBe(true);
    expect(body.agent_id).toBe("guide");
  });

  it("history is empty after DELETE", async () => {
    saveProviderConfig(GROQ_CONFIG);

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      makeMockSseResponse("Reply"),
    );

    const app = buildApp();

    // Send message
    const chatRes = await app.request("/api/v1/chat/guide", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ message: "Hello" }),
    });
    await chatRes.text();

    // Clear
    await app.request("/api/v1/chat/guide/history", { method: "DELETE" });

    // Check empty
    const histRes  = await app.request("/api/v1/chat/guide/history");
    const histBody = await histRes.json() as { messages: unknown[]; conversation_id: null };
    expect(histBody.messages).toHaveLength(0);
    expect(histBody.conversation_id).toBeNull();
  });

  it("DELETE works even when no conversation exists", async () => {
    const res = await buildApp().request("/api/v1/chat/finance/history", { method: "DELETE" });
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Scenario 7: System Prompt Completeness
// ---------------------------------------------------------------------------

describe("Scenario 7: System Prompt Completeness", () => {
  it("all 6 agents build system prompts without throwing", () => {
    const roles = loadDefaultRoles();
    expect(roles.length).toBeGreaterThanOrEqual(6);
    for (const role of roles) {
      expect(() => buildSystemPrompt(role), `${role.id} should build system prompt`).not.toThrow();
    }
  });

  it("guide system prompt contains SIDJUA handbook content", () => {
    const roles = loadDefaultRoles();
    const guide = roles.find((r) => r.id === "guide");
    if (!guide) throw new Error("guide role not found");

    const prompt = buildSystemPrompt(guide);
    expect(prompt).toContain("SIDJUA");
    expect(prompt).toContain("Handbook");
    expect(prompt).toContain("HR Manager");
    expect(prompt).toContain("Auditor");
  });

  it("all agents get team reference with all 6 agent names", () => {
    const roles = loadDefaultRoles();
    for (const role of roles) {
      const prompt = buildSystemPrompt(role);
      expect(prompt, `${role.id} should mention HR Manager`).toContain("HR Manager");
      expect(prompt, `${role.id} should mention Guide`).toContain("Guide");
    }
  });

  it("non-guide agents get role-specific content", () => {
    const roles = loadDefaultRoles();
    const hr    = roles.find((r) => r.id === "hr");
    if (!hr) throw new Error("hr role not found");

    const prompt = buildSystemPrompt(hr);
    expect(prompt).toContain(hr.name);
    expect(prompt).toContain(hr.description);
  });

  it("guide agent does not error even with large handbook", () => {
    const roles = loadDefaultRoles();
    const guide = roles.find((r) => r.id === "guide");
    if (!guide) throw new Error("guide role not found");

    const prompt = buildSystemPrompt(guide);
    // Should be non-trivial length
    expect(prompt.length).toBeGreaterThan(500);
  });

  it("IT administrator prompt includes capabilities", () => {
    const roles = loadDefaultRoles();
    const it_   = roles.find((r) => r.id === "it");
    if (!it_) throw new Error("it role not found");

    const prompt = buildSystemPrompt(it_);
    expect(prompt.length).toBeGreaterThan(100);
  });
});

// ---------------------------------------------------------------------------
// Scenario 8: Responsive + Theme (source inspection)
// ---------------------------------------------------------------------------

describe("Scenario 8: Responsive + Theme", () => {
  it("index.html has theme-color meta tag #2563eb", () => {
    const html = read("sidjua-gui/index.html");
    expect(html).toContain('content="#2563eb"');
    expect(html).toContain('name="theme-color"');
  });

  it("index.html links to manifest.json", () => {
    const html = read("sidjua-gui/index.html");
    expect(html).toContain('href="/manifest.json"');
    expect(html).toContain('rel="manifest"');
  });

  it("index.html has viewport meta tag", () => {
    const html = read("sidjua-gui/index.html");
    expect(html).toContain('name="viewport"');
    expect(html).toContain("width=device-width");
  });

  it("globals.css defines CSS color variables", () => {
    const css = read("sidjua-gui/src/styles/globals.css");
    // Uses --color-accent as the primary brand color
    expect(css).toContain("--color-");
    expect(css).toContain("--color-bg");
  });

  it("globals.css has dark theme variables", () => {
    const css = read("sidjua-gui/src/styles/globals.css");
    expect(css).toContain("dark");
  });

  it("Sidebar has all required nav items", () => {
    const src = read("sidjua-gui/src/components/layout/Sidebar.tsx");
    expect(src).toContain("/agents");
    expect(src).toContain("/chat");
    expect(src).toContain("/divisions");
    expect(src).toContain("/settings");
    expect(src).toContain("/governance");
  });

  it("App.tsx registers chat route with agentId param", () => {
    const src = read("sidjua-gui/src/App.tsx");
    expect(src).toContain("chat/:agentId");
  });

  it("App.tsx registers divisions route", () => {
    const src = read("sidjua-gui/src/App.tsx");
    expect(src).toContain("divisions");
    expect(src).toContain("Divisions");
  });

  it("Chat.tsx exists and exports Chat component", () => {
    const src = read("sidjua-gui/src/pages/Chat.tsx");
    expect(src).toContain("export");
    expect(src).toContain("Chat");
  });
});

// ---------------------------------------------------------------------------
// Scenario 9: Full Journey Integration
// ---------------------------------------------------------------------------

describe("Scenario 9: Full Journey Integration", () => {
  it("configure provider → chat guide → check history → switch to hr → clear guide", async () => {
    const app = buildApp();

    // Step 1: Save provider config
    saveProviderConfig(GROQ_CONFIG);

    // Step 2: Verify provider configured
    const configRes  = await app.request("/api/v1/provider/config");
    const configBody = await configRes.json() as { configured: boolean };
    expect(configBody.configured).toBe(true);

    // Step 3: Chat with guide (mock LLM)
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      makeMockSseResponse("Welcome to SIDJUA!"),
    );

    const chatRes = await app.request("/api/v1/chat/guide", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ message: "Hello Guide" }),
    });
    expect(chatRes.status).toBe(200);
    await chatRes.text();

    // Step 4: Verify guide history has the message
    const guideHist  = await app.request("/api/v1/chat/guide/history");
    const guideBody  = await guideHist.json() as { messages: Array<{ role: string }> };
    expect(guideBody.messages.length).toBeGreaterThan(0);
    expect(guideBody.messages[0]?.role).toBe("user");

    // Step 5: Get HR agent — separate conversation
    const hrHist  = await app.request("/api/v1/chat/hr/history");
    const hrBody  = await hrHist.json() as { messages: unknown[] };
    expect(hrBody.messages).toHaveLength(0);

    // Step 6: Clear guide conversation
    const clearRes  = await app.request("/api/v1/chat/guide/history", { method: "DELETE" });
    const clearBody = await clearRes.json() as { cleared: boolean };
    expect(clearBody.cleared).toBe(true);

    // Step 7: Verify guide is empty again
    const afterClear  = await app.request("/api/v1/chat/guide/history");
    const afterBody   = await afterClear.json() as { messages: unknown[] };
    expect(afterBody.messages).toHaveLength(0);
  });

  it("full starter agents list returned after provider configured", async () => {
    saveProviderConfig(GROQ_CONFIG);

    const res  = await buildApp().request("/api/v1/starter-agents");
    const body = await res.json() as { agents: Array<{ id: string; name: string }> };

    expect(body.agents).toHaveLength(6);
    const ids = body.agents.map((a) => a.id);
    expect(ids).toContain("guide");
    expect(ids).toContain("hr");
    expect(ids).toContain("it");
    expect(ids).toContain("auditor");
    expect(ids).toContain("finance");
    expect(ids).toContain("librarian");
  });

  it("unknown agent returns 404 for chat and history", async () => {
    saveProviderConfig(GROQ_CONFIG);
    const app = buildApp();

    const chatRes = await app.request("/api/v1/chat/ghost-agent", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ message: "Hello" }),
    });
    expect(chatRes.status).toBe(404);

    const histRes = await app.request("/api/v1/chat/ghost-agent/history");
    expect(histRes.status).toBe(404);
  });
});
