/**
 * Phase 13a: CloudflareAIAdapter unit tests
 *
 * CloudflareAIAdapter is a thin wrapper over OpenAICompatibleAdapter that
 * points at the Cloudflare Workers AI endpoint. Mocks global.fetch.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { CloudflareAIAdapter } from "../../../src/providers/adapters/cloudflare-ai-adapter.js";
import { AGENT_DECISION_TOOLS } from "../../../src/providers/tool-response-parser.js";
import type { LLMRequest }      from "../../../src/providers/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAdapter(): CloudflareAIAdapter {
  return new CloudflareAIAdapter({
    accountId:    "test-account-123",
    apiKey:       "cf-test-key",
    defaultModel: "@cf/zai-org/glm-4.7-flash",
    timeout_ms:   5_000,
  });
}

function makeRequest(overrides: Partial<LLMRequest> = {}): LLMRequest {
  return {
    messages: [{ role: "user", content: "Hello!" }],
    ...overrides,
  };
}

function oaiSuccessResponse(content = "Hello from Cloudflare!") {
  return {
    id:      "chatcmpl-cf-001",
    model:   "@cf/zai-org/glm-4.7-flash",
    choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }],
    usage:   { prompt_tokens: 8, completion_tokens: 5, total_tokens: 13 },
  };
}

function oaiToolResponse(funcName: string, args: Record<string, unknown>) {
  return {
    id:    "chatcmpl-cf-002",
    model: "@cf/zai-org/glm-4.7-flash",
    choices: [{
      index:         0,
      finish_reason: "tool_calls",
      message: {
        role:       "assistant",
        content:    null,
        tool_calls: [{
          id:       "call-cf-001",
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
    ok:      status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headers[k] ?? null },
    json:    () => Promise.resolve(body),
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CloudflareAIAdapter.chat", () => {
  it("returns correct LLMResponse routed to Cloudflare endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      headers: { get: () => null },
      json: () => Promise.resolve(oaiSuccessResponse("CF says hi!")),
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await makeAdapter().chat(makeRequest());

    expect(res.provider).toBe("cloudflare-ai");
    expect(res.content).toBe("CF says hi!");
    expect(res.usage.inputTokens).toBe(8);
    expect(res.usage.outputTokens).toBe(5);
    expect(res.usage.totalTokens).toBe(13);
    expect(res.finishReason).toBe("stop");

    // Verify URL contains account ID and Cloudflare domain
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("test-account-123");
    expect(url).toContain("api.cloudflare.com");
    expect(url).toContain("chat/completions");
  });

  it("throws PROV-005 on 401 and PROV-002 on 429", async () => {
    mockFetch({ error: { message: "Unauthorized" } }, 401);
    await expect(makeAdapter().chat(makeRequest())).rejects.toMatchObject({ code: "PROV-005" });

    mockFetch({ error: { message: "Rate limited" } }, 429);
    await expect(makeAdapter().chat(makeRequest())).rejects.toMatchObject({ code: "PROV-002" });
  });
});

describe("CloudflareAIAdapter.chatWithTools", () => {
  it("parses tool_calls response via OpenAI-compatible format", async () => {
    mockFetch(oaiToolResponse("think_more", { thoughts: "deep analysis needed", next_step: "check logs" }));
    const res = await makeAdapter().chatWithTools(makeRequest(), AGENT_DECISION_TOOLS);

    expect(res.provider).toBe("cloudflare-ai");
    expect(res.toolCalls).toHaveLength(1);
    expect(res.toolCalls[0]?.name).toBe("think_more");
    expect(res.toolCalls[0]?.input).toMatchObject({ thoughts: "deep analysis needed" });
    expect(res.usage.inputTokens).toBe(15);
  });
});
