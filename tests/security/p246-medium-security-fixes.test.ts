// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * P246 — Medium Security Fixes regression tests
 *
 * MED-4: Rate limiter uses monotonic clock (performance.now) instead of Date.now
 * MED-5: Rate limiter O(1) LRU eviction via Map insertion order
 * MED-10: Discord Gateway WebSocket connection timeout (30 s)
 * GUI: tauri.conf.json CSP removes 'unsafe-inline' from style-src
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// MED-4: Rate limiter uses monotonic clock
// ---------------------------------------------------------------------------

describe("MED-4: rate-limiter uses monotonic clock (performance.now)", () => {
  it("rate-limiter source does not call Date.now() for timing logic", () => {
    const src = readFileSync(
      resolve("src/api/middleware/rate-limiter.ts"),
      "utf-8",
    );
    // All Date.now() calls should be gone from the timing-sensitive paths.
    // We check that performance.now() is present and Date.now() is absent.
    expect(src).toContain("performance.now()");
    expect(src).not.toMatch(/Date\.now\(\)/);
  });
});

// ---------------------------------------------------------------------------
// MED-5: O(1) LRU eviction — Map insertion order
// ---------------------------------------------------------------------------

import {
  rateLimiter,
  clearRateLimitState,
  DEFAULT_RATE_LIMIT,
  type RateLimitConfig,
} from "../../src/api/middleware/rate-limiter.js";
import { Hono } from "hono";

function makeRateLimitApp(config: Partial<RateLimitConfig> = {}): Hono {
  const app = new Hono();
  app.use("*", rateLimiter({ ...DEFAULT_RATE_LIMIT, ...config }));
  app.get("/test", (c) => c.json({ ok: true }));
  return app;
}

describe("MED-5: rate-limiter O(1) LRU eviction (Map insertion order)", () => {
  beforeEach(() => clearRateLimitState());
  afterEach(() => clearRateLimitState());

  it("rate-limiter source uses Map insertion order for LRU eviction", () => {
    const src = readFileSync(
      resolve("src/api/middleware/rate-limiter.ts"),
      "utf-8",
    );
    // Must evict from front of Map (insertion-ordered LRU) instead of full scan
    expect(src).toContain(".keys().next().value");
    // Must NOT contain a full O(n) scan for minimum lastAccess
    expect(src).not.toMatch(/lruTime\s*=\s*Infinity/);
    expect(src).not.toMatch(/b\.lastAccess < lruTime/);
  });

  it("allows requests within rate limit", async () => {
    const app = makeRateLimitApp({ max_requests: 5, burst_max: 0 });
    const res = await app.request("/test", {
      headers: { Authorization: "Bearer test-key" },
    });
    expect(res.status).toBe(200);
  });

  it("blocks requests exceeding rate limit", async () => {
    const app = makeRateLimitApp({ max_requests: 2, burst_max: 0, window_ms: 60_000 });
    for (let i = 0; i < 2; i++) {
      await app.request("/test", { headers: { Authorization: "Bearer over-key" } });
    }
    const res = await app.request("/test", {
      headers: { Authorization: "Bearer over-key" },
    });
    expect(res.status).toBe(429);
  });

  it("setBucket refreshes LRU position of existing keys (source inspection)", () => {
    const src = readFileSync(
      resolve("src/api/middleware/rate-limiter.ts"),
      "utf-8",
    );
    // The setBucket function must delete + re-insert existing keys
    expect(src).toContain("rateLimitState.buckets.has(key)");
    expect(src).toContain("rateLimitState.buckets.delete(key)");
  });
});

// ---------------------------------------------------------------------------
// MED-10: Discord Gateway connection timeout
// ---------------------------------------------------------------------------

import {
  DiscordGateway,
  type WsLike,
  type WsFactory,
} from "../../src/modules/discord/discord-gateway.js";
import { GatewayOpcode } from "../../src/modules/discord/discord-types.js";

class MockWebSocket extends EventEmitter implements WsLike {
  readonly sent: unknown[] = [];
  readyState = 1;
  terminated = false;

  send(data: string): void { this.sent.push(JSON.parse(data) as unknown); }
  close(code = 1000): void {
    this.readyState = 3;
    process.nextTick(() => this.emit("close", code, Buffer.from("")));
  }
  terminate(): void {
    this.terminated = true;
    this.readyState = 3;
    process.nextTick(() => this.emit("close", 1006, Buffer.from("")));
  }
  simulateOpen(): void { this.emit("open"); }
  simulateMessage(p: unknown): void { this.emit("message", JSON.stringify(p)); }
}

function makeFetchGateway(url = "wss://gateway.discord.gg"): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok:   true,
    json: async () => ({ url }),
  }) as unknown as typeof fetch;
}

describe("MED-10: Discord Gateway WebSocket connection timeout", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it("GATEWAY_CONNECT_TIMEOUT_MS constant is defined in source (30 000 ms)", () => {
    const src = readFileSync(
      resolve("src/modules/discord/discord-gateway.ts"),
      "utf-8",
    );
    expect(src).toContain("GATEWAY_CONNECT_TIMEOUT_MS");
    expect(src).toContain("30_000");
  });

  it("connect() clears the timeout when open event fires", async () => {
    vi.useFakeTimers();
    const mockWs = new MockWebSocket();
    const wsFactory: WsFactory = () => mockWs;

    const gateway = new DiscordGateway("tok", {
      WsFactory: wsFactory,
      fetchFn:   makeFetchGateway(),
      sleep:     async () => undefined,
    });

    // connect() is fully awaited so all listeners and the connectTimer are registered.
    await gateway.connect();
    // Simulate open — this calls clearTimeout(connectTimer).
    mockWs.simulateOpen();

    // Advance time past the 30 s threshold — the cleared timer must NOT fire.
    vi.advanceTimersByTime(31_000);
    await Promise.resolve();

    expect(mockWs.terminated).toBe(false);
  });

  it("connect() terminates ws when open does not fire within timeout", async () => {
    vi.useFakeTimers();
    const mockWs = new MockWebSocket();
    const wsFactory: WsFactory = () => mockWs;

    const gateway = new DiscordGateway("tok", {
      WsFactory: wsFactory,
      fetchFn:   makeFetchGateway(),
      sleep:     async () => undefined,
    });

    // connect() is fully awaited so the connectTimer is registered.
    await gateway.connect();
    // Do NOT simulate open.

    // Advance past the 30 s threshold — timer callback terminates the ws.
    vi.advanceTimersByTime(31_000);
    await Promise.resolve();

    expect(mockWs.terminated).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GUI CSP: tauri.conf.json must not contain 'unsafe-inline' in style-src
// ---------------------------------------------------------------------------

describe("GUI CSP: tauri.conf.json style-src must not include 'unsafe-inline'", () => {
  it("CSP style-src does not contain 'unsafe-inline'", () => {
    const raw = readFileSync(
      resolve("sidjua-gui/src-tauri/tauri.conf.json"),
      "utf-8",
    );
    const conf = JSON.parse(raw) as { app: { security: { csp: string } } };
    const csp = conf.app.security.csp;

    // style-src must exist but must not allow unsafe-inline
    expect(csp).toContain("style-src");
    expect(csp).not.toContain("'unsafe-inline'");
  });

  it("CSP retains 'self' for style-src", () => {
    const raw = readFileSync(
      resolve("sidjua-gui/src-tauri/tauri.conf.json"),
      "utf-8",
    );
    const conf = JSON.parse(raw) as { app: { security: { csp: string } } };
    const csp = conf.app.security.csp;
    expect(csp).toContain("style-src 'self'");
  });
});
