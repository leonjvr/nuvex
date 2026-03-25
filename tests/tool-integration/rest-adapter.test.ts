/**
 * Unit tests: RestAdapter
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { RestAdapter } from "../../src/tool-integration/adapters/rest-adapter.js";
import type { ToolAction } from "../../src/tool-integration/types.js";

describe("RestAdapter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("injects bearer auth header in GET request", async () => {
    let capturedRequest: Request | undefined;

    const fetchMock = vi.fn().mockImplementation((input: Request | string) => {
      capturedRequest = input instanceof Request ? input : new Request(input);
      return Promise.resolve(
        new Response(JSON.stringify({ data: "ok" }), {
          status: 200,
          statusText: "OK",
          headers: { "Content-Type": "application/json" },
        }),
      );
    });

    vi.stubGlobal("fetch", fetchMock);

    const adapter = new RestAdapter(
      "r1",
      {
        type: "rest",
        base_url: "http://api.test.com",
        auth: { type: "bearer", token: "tok123" },
      },
      [],
    );
    await adapter.connect();

    const action: ToolAction = {
      tool_id: "r1",
      capability: "get",
      params: { path: "/data" },
      agent_id: "a1",
    };

    await adapter.execute(action);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://api.test.com/data");

    const headers = init?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer tok123");
  });

  it("retries on 429 response and succeeds on third attempt", async () => {
    vi.useFakeTimers();

    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount <= 2) {
        return Promise.resolve(
          new Response(null, { status: 429, statusText: "Too Many Requests" }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          statusText: "OK",
          headers: { "Content-Type": "application/json" },
        }),
      );
    });

    vi.stubGlobal("fetch", fetchMock);

    const adapter = new RestAdapter(
      "r1",
      { type: "rest", base_url: "http://api.test.com" },
      [],
    );
    await adapter.connect();

    const action: ToolAction = {
      tool_id: "r1",
      capability: "get",
      params: { path: "/resource" },
      agent_id: "a1",
    };

    // Execute asynchronously while advancing fake timers to skip retry delays
    const executePromise = adapter.execute(action);

    // Advance past the first retry delay (1000ms) and second retry delay (2000ms)
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(2_000);

    const result = await executePromise;

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
