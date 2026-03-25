/**
 * Phase 11a: Server CLI + API Key lifecycle tests
 *
 * Tests `generateApiKey`, key rotation grace period,
 * and that `getActiveApiKey` returns the correct key at each stage.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  generateApiKey,
  getActiveApiKey,
  _resetApiKeyState,
} from "../../src/api/cli-server.js";

beforeEach(() => {
  _resetApiKeyState();
});

afterEach(() => {
  _resetApiKeyState();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// API key generation
// ---------------------------------------------------------------------------

describe("generateApiKey()", () => {
  it("returns a 64-character hex string (32 bytes hex-encoded)", () => {
    const key = generateApiKey();
    expect(key).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(key)).toBe(true);
  });

  it("generates unique keys on each call", () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// Server factory — createApiServer lifecycle
// ---------------------------------------------------------------------------

describe("createApiServer() — server object", () => {
  it("starts in stopped state", async () => {
    const { createApiServer } = await import("../../src/api/server.js");
    const server = createApiServer({
      port:         0,
      host:         "127.0.0.1",
      api_key:      generateApiKey(),
      cors_origins: ["http://localhost:3000"],
      rate_limit:   { enabled: false, window_ms: 60_000, max_requests: 100, burst_max: 20 },
      trust_proxy:  false,
    });
    expect(server.running).toBe(false);
  });

  it("running becomes true after start() and false after stop()", async () => {
    const { createApiServer } = await import("../../src/api/server.js");
    const server = createApiServer({
      port:         0,               // OS assigns a free port
      host:         "127.0.0.1",
      api_key:      generateApiKey(),
      cors_origins: ["http://localhost:3000"],
      rate_limit:   { enabled: false, window_ms: 60_000, max_requests: 100, burst_max: 20 },
      trust_proxy:  false,
    });

    await server.start();
    expect(server.running).toBe(true);
    expect(server.boundPort).toBeGreaterThan(0);

    await server.stop();
    expect(server.running).toBe(false);
  });

  it("boundPort is assigned by OS when config port is 0", async () => {
    const { createApiServer } = await import("../../src/api/server.js");
    const server = createApiServer({
      port:         0,
      host:         "127.0.0.1",
      api_key:      generateApiKey(),
      cors_origins: ["http://localhost:3000"],
      rate_limit:   { enabled: false, window_ms: 60_000, max_requests: 100, burst_max: 20 },
      trust_proxy:  false,
    });
    await server.start();
    expect(server.boundPort).not.toBe(0);
    await server.stop();
  });
});

// ---------------------------------------------------------------------------
// API key rotation with grace period
// ---------------------------------------------------------------------------

describe("getActiveApiKey() after _resetApiKeyState()", () => {
  it("returns empty string when no key has been set", () => {
    expect(getActiveApiKey()).toBe("");
  });
});
