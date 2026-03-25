/**
 * Tests for Phase 13d: ProviderAutoDetect
 *
 * All tests use vi.stubGlobal to mock fetch — no real network calls.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { ProviderAutoDetect } from "../../src/providers/auto-detect.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetch(responses: Array<{ ok: boolean; status: number; json?: unknown }>) {
  let call = 0;
  vi.stubGlobal("fetch", async () => {
    const resp = responses[call] ?? responses[responses.length - 1];
    call++;
    return {
      ok:     resp.ok,
      status: resp.status,
      json:   () => Promise.resolve(resp.json ?? {}),
      headers: { get: () => null },
    };
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ProviderAutoDetect", () => {
  it("should detect a fully capable endpoint (alive + chat + tool use)", async () => {
    mockFetch([
      // GET /models
      { ok: true, status: 200, json: { data: [{ id: "model-a" }, { id: "model-b" }] } },
      // POST /chat/completions (basic)
      { ok: true, status: 200, json: {} },
      // POST /chat/completions (tool use)
      {
        ok:     true,
        status: 200,
        json:   { choices: [{ message: { tool_calls: [{ id: "call1", type: "function", function: { name: "calculator", arguments: "{}" } }] } }] },
      },
    ]);

    const detector = new ProviderAutoDetect();
    const result   = await detector.probe({ base_url: "https://example.com/v1", model: "model-a" });

    expect(result.alive).toBe(true);
    expect(result.models_endpoint).toBe(true);
    expect(result.chat_completions).toBe(true);
    expect(result.tool_use).toBe(true);
    expect(result.available_models).toContain("model-a");
    expect(result.errors).toHaveLength(0);
  });

  it("should handle /models 404 gracefully (still tries chat)", async () => {
    mockFetch([
      // GET /models → 404 (not supported)
      { ok: false, status: 404, json: {} },
      // POST /chat/completions → success
      { ok: true, status: 200, json: {} },
      // tool use → no tool_calls in response
      { ok: true, status: 200, json: { choices: [{ message: { content: "4" } }] } },
    ]);

    const detector = new ProviderAutoDetect();
    const result   = await detector.probe({ base_url: "https://example.com/v1", model: "model-a" });

    expect(result.alive).toBe(true);
    expect(result.models_endpoint).toBe(false);
    expect(result.chat_completions).toBe(true);
    expect(result.tool_use).toBe(false);
    // Should have a warning about 404 models endpoint
    expect(result.errors.some((e) => e.includes("404"))).toBe(true);
  });

  it("should report alive=false when endpoint is unreachable", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:9999");
    });

    const detector = new ProviderAutoDetect();
    const result   = await detector.probe({ base_url: "http://localhost:9999/v1", model: "model-a" });

    expect(result.alive).toBe(false);
    expect(result.chat_completions).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("should handle 401 from /models and report authentication error", async () => {
    mockFetch([
      // GET /models → 401
      { ok: false, status: 401, json: {} },
      // POST /chat/completions (still tried)
      { ok: false, status: 401, json: {} },
    ]);

    const detector = new ProviderAutoDetect();
    const result   = await detector.probe({
      base_url: "https://example.com/v1",
      model:    "model-a",
      api_key:  "bad-key",
    });

    expect(result.errors.some((e) => e.includes("401"))).toBe(true);
  });
});
