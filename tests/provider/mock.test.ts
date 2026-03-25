/**
 * Tests for src/provider/adapters/mock.ts
 *
 * Covers:
 * - Default response when queue empty
 * - Queued responses consumed FIFO
 * - Error throwing when spec.error is set
 * - Call log tracking
 * - clearCallLog / clearQueue helpers
 * - estimateTokens delegation
 * - isAvailable() and setAvailable()
 */

import { describe, it, expect, beforeEach } from "vitest";
import { MockProvider, makeMockRequest } from "../../src/provider/adapters/mock.js";
import { ProviderError } from "../../src/types/provider.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProvider(name: "anthropic" | "openai" = "anthropic"): MockProvider {
  return new MockProvider(name);
}

// ---------------------------------------------------------------------------
// Basic call behaviour
// ---------------------------------------------------------------------------

describe("MockProvider — default response", () => {
  it("returns a valid ProviderCallResponse with correct callId", async () => {
    const mock    = makeProvider();
    const request = makeMockRequest();
    const resp    = await mock.call(request);

    expect(resp.callId).toBe(request.callId);
    expect(resp.provider).toBe("anthropic");
    expect(resp.content.length).toBeGreaterThan(0);
    expect(resp.usage.totalTokens).toBeGreaterThan(0);
    expect(resp.costUsd).toBeGreaterThanOrEqual(0);
    expect(resp.latencyMs).toBeGreaterThanOrEqual(1);
  });

  it("uses the request model in the response", async () => {
    const mock    = makeProvider();
    const request = makeMockRequest({ model: "claude-sonnet-4-6" });
    const resp    = await mock.call(request);
    expect(resp.model).toBe("claude-sonnet-4-6");
  });

  it("reflects provider name from constructor", async () => {
    const openaiMock = makeProvider("openai");
    const resp       = await openaiMock.call(makeMockRequest({ provider: "openai" }));
    expect(resp.provider).toBe("openai");
  });
});

// ---------------------------------------------------------------------------
// Response queue (FIFO)
// ---------------------------------------------------------------------------

describe("MockProvider — response queue", () => {
  it("consumes queued responses in FIFO order", async () => {
    const mock = makeProvider();
    mock.queueResponse({ content: "first" });
    mock.queueResponse({ content: "second" });
    mock.queueResponse({ content: "third" });

    const r1 = await mock.call(makeMockRequest());
    const r2 = await mock.call(makeMockRequest());
    const r3 = await mock.call(makeMockRequest());

    expect(r1.content).toBe("first");
    expect(r2.content).toBe("second");
    expect(r3.content).toBe("third");
  });

  it("falls back to default response after queue is empty", async () => {
    const mock = makeProvider();
    mock.queueResponse({ content: "queued" });

    const r1 = await mock.call(makeMockRequest());
    const r2 = await mock.call(makeMockRequest()); // default
    expect(r1.content).toBe("queued");
    expect(r2.content).not.toBe("queued"); // default content
  });

  it("uses custom usage from queued spec", async () => {
    const mock = makeProvider();
    mock.queueResponse({ usage: { inputTokens: 500, outputTokens: 200, totalTokens: 700 } });
    const resp = await mock.call(makeMockRequest());
    expect(resp.usage.inputTokens).toBe(500);
    expect(resp.usage.outputTokens).toBe(200);
    expect(resp.usage.totalTokens).toBe(700);
  });

  it("uses custom finishReason from queued spec", async () => {
    const mock = makeProvider();
    mock.queueResponse({ finishReason: "length" });
    const resp = await mock.call(makeMockRequest());
    expect(resp.finishReason).toBe("length");
  });
});

// ---------------------------------------------------------------------------
// Error throwing
// ---------------------------------------------------------------------------

describe("MockProvider — error specs", () => {
  it("throws when spec.error is set", async () => {
    const mock = makeProvider();
    mock.queueResponse({ error: new ProviderError("anthropic", "429", "Rate limited", true) });
    await expect(mock.call(makeMockRequest())).rejects.toThrow("Rate limited");
  });

  it("throws even generic errors", async () => {
    const mock = makeProvider();
    mock.queueResponse({ error: new Error("generic failure") });
    await expect(mock.call(makeMockRequest())).rejects.toThrow("generic failure");
  });

  it("next call after error uses next queued response", async () => {
    const mock = makeProvider();
    mock.queueResponse({ error: new Error("fail") });
    mock.queueResponse({ content: "recovered" });

    await expect(mock.call(makeMockRequest())).rejects.toThrow();
    const r2 = await mock.call(makeMockRequest());
    expect(r2.content).toBe("recovered");
  });
});

// ---------------------------------------------------------------------------
// Call log
// ---------------------------------------------------------------------------

describe("MockProvider — call log", () => {
  it("records each call in order", async () => {
    const mock = makeProvider();
    const req1 = makeMockRequest({ agentId: "agent-1" });
    const req2 = makeMockRequest({ agentId: "agent-2" });

    await mock.call(req1);
    await mock.call(req2);

    const log = mock.getCallLog();
    expect(log).toHaveLength(2);
    expect(log[0]?.agentId).toBe("agent-1");
    expect(log[1]?.agentId).toBe("agent-2");
  });

  it("records failed calls too (error spec)", async () => {
    const mock = makeProvider();
    mock.queueResponse({ error: new Error("boom") });
    await expect(mock.call(makeMockRequest())).rejects.toThrow();
    expect(mock.getCallLog()).toHaveLength(1);
  });

  it("clearCallLog resets the log", async () => {
    const mock = makeProvider();
    await mock.call(makeMockRequest());
    mock.clearCallLog();
    expect(mock.getCallLog()).toHaveLength(0);
  });

  it("getCallLog returns a copy — mutations do not affect the internal log", async () => {
    const mock = makeProvider();
    await mock.call(makeMockRequest());
    const log = mock.getCallLog();
    log.length = 0; // mutate copy
    expect(mock.getCallLog()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// clearQueue
// ---------------------------------------------------------------------------

describe("MockProvider — clearQueue", () => {
  it("discards remaining queued responses", async () => {
    const mock = makeProvider();
    mock.queueResponse({ content: "should be discarded" });
    mock.clearQueue();

    const resp = await mock.call(makeMockRequest());
    expect(resp.content).not.toBe("should be discarded");
  });
});

// ---------------------------------------------------------------------------
// isAvailable / setAvailable
// ---------------------------------------------------------------------------

describe("MockProvider — isAvailable", () => {
  it("returns true by default", async () => {
    const mock = makeProvider();
    expect(await mock.isAvailable()).toBe(true);
  });

  it("returns false after setAvailable(false)", async () => {
    const mock = makeProvider();
    mock.setAvailable(false);
    expect(await mock.isAvailable()).toBe(false);
  });

  it("can be toggled back to true", async () => {
    const mock = makeProvider();
    mock.setAvailable(false);
    mock.setAvailable(true);
    expect(await mock.isAvailable()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// estimateTokens
// ---------------------------------------------------------------------------

describe("MockProvider — estimateTokens", () => {
  it("returns a positive number for non-empty messages", () => {
    const mock = makeProvider();
    const result = mock.estimateTokens(
      [{ role: "user", content: "Hello, how are you?" }],
    );
    expect(result).toBeGreaterThan(0);
  });

  it("includes systemPrompt in estimate", () => {
    const mock     = makeProvider();
    const noSystem = mock.estimateTokens([{ role: "user", content: "Hi" }]);
    const withSys  = mock.estimateTokens([{ role: "user", content: "Hi" }], "You are helpful.");
    expect(withSys).toBeGreaterThan(noSystem);
  });
});

// ---------------------------------------------------------------------------
// makeMockRequest helper
// ---------------------------------------------------------------------------

describe("makeMockRequest", () => {
  it("generates unique callIds", () => {
    const r1 = makeMockRequest();
    const r2 = makeMockRequest();
    expect(r1.callId).not.toBe(r2.callId);
  });

  it("applies overrides", () => {
    const req = makeMockRequest({ agentId: "custom-agent", divisionCode: "sales" });
    expect(req.agentId).toBe("custom-agent");
    expect(req.divisionCode).toBe("sales");
  });
});
