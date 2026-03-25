/**
 * Phase 13a: OpenAICompatibleAdapter unit tests
 *
 * Tests OpenAI format — same adapter also covers DeepSeek, Grok, Kimi.
 * Mocks global.fetch — no real HTTP calls.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { OpenAICompatibleAdapter } from "../../../src/providers/adapters/openai-compatible-adapter.js";
import { SidjuaError }             from "../../../src/core/error-codes.js";
import type { LLMRequest }         from "../../../src/providers/types.js";
import { AGENT_DECISION_TOOLS }    from "../../../src/providers/tool-response-parser.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAdapter(providerName = "openai"): OpenAICompatibleAdapter {
  return new OpenAICompatibleAdapter({
    apiKey:       "sk-test",
    baseUrl:      "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    providerName,
    timeout_ms:   5_000,
  });
}

function makeRequest(overrides: Partial<LLMRequest> = {}): LLMRequest {
  return {
    messages: [{ role: "user", content: "Hello!" }],
    ...overrides,
  };
}

function oaiSuccessResponse(content = "Hello!") {
  return {
    id:      "chatcmpl-001",
    model:   "gpt-4o-mini",
    choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }],
    usage:   { prompt_tokens: 8, completion_tokens: 5, total_tokens: 13 },
  };
}

function oaiToolResponse(funcName: string, args: Record<string, unknown>) {
  return {
    id:    "chatcmpl-002",
    model: "gpt-4o-mini",
    choices: [{
      index:        0,
      finish_reason: "tool_calls",
      message: {
        role:    "assistant",
        content: null,
        tool_calls: [{
          id:       "call-001",
          type:     "function",
          function: { name: funcName, arguments: JSON.stringify(args) },
        }],
      },
    }],
    usage: { prompt_tokens: 15, completion_tokens: 10, total_tokens: 25 },
  };
}

function mockFetch(body: unknown, status = 200, headers: Record<string, string> = {}): void {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok:     status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headers[k] ?? null },
    json:   () => Promise.resolve(body),
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("OpenAICompatibleAdapter.chat", () => {
  it("returns correct LLMResponse on success", async () => {
    mockFetch(oaiSuccessResponse("Hi!"));
    const res = await makeAdapter().chat(makeRequest());

    expect(res.provider).toBe("openai");
    expect(res.content).toBe("Hi!");
    expect(res.usage.inputTokens).toBe(8);
    expect(res.usage.outputTokens).toBe(5);
    expect(res.usage.totalTokens).toBe(13);
    expect(res.finishReason).toBe("stop");
  });

  it("sends Authorization: Bearer header", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      headers: { get: () => null },
      json: () => Promise.resolve(oaiSuccessResponse()),
    });
    vi.stubGlobal("fetch", fetchMock);

    await makeAdapter().chat(makeRequest());

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers  = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer sk-test");
  });

  it("throws PROV-005 on 401 error", async () => {
    mockFetch({ error: { message: "Incorrect API key" } }, 401);
    await expect(makeAdapter().chat(makeRequest())).rejects.toMatchObject({ code: "PROV-005" });
  });

  it("throws PROV-002 on 429 rate limit", async () => {
    mockFetch({ error: { message: "Too many requests" } }, 429);
    await expect(makeAdapter().chat(makeRequest())).rejects.toMatchObject({ code: "PROV-002" });
  });

  it("throws PROV-001 on 500 server error", async () => {
    mockFetch({ error: { message: "Server error" } }, 500);
    await expect(makeAdapter().chat(makeRequest())).rejects.toMatchObject({ code: "PROV-001" });
  });
});

describe("OpenAICompatibleAdapter.chatWithTools", () => {
  it("parses tool_calls response into ToolLLMResponse", async () => {
    mockFetch(oaiToolResponse("decompose_task", { reasoning: "complex", sub_tasks: [] }));
    const res = await makeAdapter().chatWithTools(makeRequest(), AGENT_DECISION_TOOLS);

    expect(res.toolCalls).toHaveLength(1);
    expect(res.toolCalls[0]?.name).toBe("decompose_task");
    expect(res.toolCalls[0]?.input).toMatchObject({ reasoning: "complex" });
    expect(res.usage.inputTokens).toBe(15);
  });

  it("sends tools array with type:function in request body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      headers: { get: () => null },
      json: () => Promise.resolve(oaiToolResponse("think_more", { thoughts: "..." })),
    });
    vi.stubGlobal("fetch", fetchMock);

    await makeAdapter().chatWithTools(makeRequest(), AGENT_DECISION_TOOLS);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body     = JSON.parse(init.body as string) as Record<string, unknown>;
    const tools    = body["tools"] as Array<{ type: string }>;
    expect(Array.isArray(tools)).toBe(true);
    expect(tools[0]?.type).toBe("function");
  });

  it("providerName appears in errors for DeepSeek variant", async () => {
    mockFetch({ error: { message: "auth failed" } }, 401);
    const deepseek = new OpenAICompatibleAdapter({
      apiKey: "ds-key", baseUrl: "https://api.deepseek.com/v1",
      defaultModel: "deepseek-chat", providerName: "deepseek", timeout_ms: 5_000,
    });
    await expect(deepseek.chat(makeRequest())).rejects.toMatchObject({
      code: "PROV-005",
    });
  });
});
