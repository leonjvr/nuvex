/**
 * Phase 13a: AnthropicAdapter unit tests
 *
 * Mocks global.fetch — no real HTTP calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AnthropicAdapter } from "../../../src/providers/adapters/anthropic-adapter.js";
import { SidjuaError }      from "../../../src/core/error-codes.js";
import type { LLMRequest }  from "../../../src/providers/types.js";
import { AGENT_DECISION_TOOLS } from "../../../src/providers/tool-response-parser.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAdapter(): AnthropicAdapter {
  return new AnthropicAdapter({
    apiKey:       "sk-test-key",
    defaultModel: "claude-haiku-4-5-20251001",
    timeout_ms:   5_000,
  });
}

function makeRequest(overrides: Partial<LLMRequest> = {}): LLMRequest {
  return {
    messages: [{ role: "user", content: "Hello!" }],
    ...overrides,
  };
}

function mockFetch(body: unknown, status = 200, headers: Record<string, string> = {}): void {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok:     status >= 200 && status < 300,
    status,
    headers: { get: (key: string) => headers[key] ?? null },
    json:   () => Promise.resolve(body),
  }));
}

function anthropicSuccessResponse(content = "Hello there!") {
  return {
    id:          "msg-001",
    model:       "claude-haiku-4-5-20251001",
    stop_reason: "end_turn",
    content:     [{ type: "text", text: content }],
    usage:       { input_tokens: 10, output_tokens: 5 },
  };
}

function anthropicToolResponse(toolName: string, toolInput: Record<string, unknown>) {
  return {
    id:          "msg-002",
    model:       "claude-haiku-4-5-20251001",
    stop_reason: "tool_use",
    content:     [
      { type: "text", text: "Let me think..." },
      { type: "tool_use", id: "tu-001", name: toolName, input: toolInput },
    ],
    usage: { input_tokens: 20, output_tokens: 15 },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AnthropicAdapter.chat", () => {
  it("returns correct LLMResponse on success", async () => {
    mockFetch(anthropicSuccessResponse("Hi!"));
    const adapter = makeAdapter();
    const res     = await adapter.chat(makeRequest());

    expect(res.provider).toBe("anthropic");
    expect(res.content).toBe("Hi!");
    expect(res.usage.inputTokens).toBe(10);
    expect(res.usage.outputTokens).toBe(5);
    expect(res.usage.totalTokens).toBe(15);
    expect(res.finishReason).toBe("end_turn");
    expect(res.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("sends correct headers in request", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      headers: { get: () => null },
      json: () => Promise.resolve(anthropicSuccessResponse()),
    });
    vi.stubGlobal("fetch", fetchMock);

    await makeAdapter().chat(makeRequest());

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers  = init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-test-key");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
  });

  it("throws PROV-005 on 401 error", async () => {
    mockFetch({ error: { message: "invalid api key" } }, 401);
    const adapter = makeAdapter();
    await expect(adapter.chat(makeRequest())).rejects.toThrow(SidjuaError);
    await expect(adapter.chat(makeRequest())).rejects.toMatchObject({ code: "PROV-005" });
  });

  it("throws PROV-002 on 429 rate limit", async () => {
    mockFetch({ error: { message: "rate limited" } }, 429, { "Retry-After": "10" });
    const adapter = makeAdapter();
    await expect(adapter.chat(makeRequest())).rejects.toMatchObject({ code: "PROV-002" });
  });

  it("throws PROV-001 on 500 server error", async () => {
    mockFetch({ error: { message: "internal error" } }, 500);
    const adapter = makeAdapter();
    await expect(adapter.chat(makeRequest())).rejects.toMatchObject({ code: "PROV-001" });
  });
});

describe("AnthropicAdapter.chatWithTools", () => {
  it("parses tool_use response into ToolLLMResponse", async () => {
    mockFetch(anthropicToolResponse("execute_result", { result: "done", summary: "All done", confidence: 0.9 }));
    const adapter = makeAdapter();
    const res     = await adapter.chatWithTools(makeRequest(), AGENT_DECISION_TOOLS);

    expect(res.toolCalls).toHaveLength(1);
    expect(res.toolCalls[0]?.name).toBe("execute_result");
    expect(res.toolCalls[0]?.input).toMatchObject({ result: "done", confidence: 0.9 });
    expect(res.textContent).toBe("Let me think...");
    expect(res.usage.inputTokens).toBe(20);
  });

  it("sends tools array in request body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      headers: { get: () => null },
      json: () => Promise.resolve(anthropicToolResponse("think_more", { thoughts: "..." })),
    });
    vi.stubGlobal("fetch", fetchMock);

    await makeAdapter().chatWithTools(makeRequest(), AGENT_DECISION_TOOLS);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body     = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(Array.isArray(body["tools"])).toBe(true);
    expect((body["tools"] as unknown[]).length).toBeGreaterThan(0);
    expect(body["tool_choice"]).toMatchObject({ type: "auto" });
  });
});
