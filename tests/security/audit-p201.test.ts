// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * V1.1 Post-Launch Architecture — verification tests.
 *
 * Covers:
 *   Task 1: SSE backpressure (SSE_LIMITS constants, sweep behaviour)
 *   Task 7: NpmUpdateProvider.checkForUpdate()
 *   Task 8: Shared network-errors.ts (isNetworkError deduplication)
 */

import { describe, it, expect, vi, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Task 1 — SSE limits and source verification
// ---------------------------------------------------------------------------

import { SSE_LIMITS, EventStreamManager } from "../../src/api/sse/event-stream.js";
import type { SSEWritable } from "../../src/api/sse/event-stream.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function makeMockStream(opts: { alreadyClosed?: boolean } = {}): SSEWritable & { closedCalled: boolean } {
  let _closed = opts.alreadyClosed ?? false;
  return {
    closedCalled: false,
    async writeSSE() {},
    async write() {},
    get closed() { return _closed; },
    async close() { _closed = true; (this as { closedCalled: boolean }).closedCalled = true; },
    async sleep(ms) { await new Promise((r) => setTimeout(r, ms)); },
    abort() { _closed = true; },
  };
}

describe("Task 1: SSE backpressure — SSE_LIMITS", () => {
  it("CLEANUP_INTERVAL_MS is 10_000 (proactive sweep every 10s)", () => {
    expect(SSE_LIMITS.CLEANUP_INTERVAL_MS).toBe(10_000);
  });

  it("WRITE_TIMEOUT_MS is 30_000", () => {
    expect(SSE_LIMITS.WRITE_TIMEOUT_MS).toBe(30_000);
  });

  it("HIGH_WATER_MARK_BYTES is 64 KiB", () => {
    expect(SSE_LIMITS.HIGH_WATER_MARK_BYTES).toBe(64 * 1024);
  });
});

describe("Task 1: SSE backpressure — sweep disconnects slow clients", () => {
  let manager: EventStreamManager;

  afterEach(() => { manager.shutdown(); });

  it("sweep evicts client with pendingBytes > HIGH_WATER_MARK_BYTES", () => {
    manager = new EventStreamManager();
    const stream = makeMockStream();
    manager.addClient({
      id: "slow", stream, filters: {}, connectedAt: "",
      lastEventId: 0,
      pendingBytes: SSE_LIMITS.HIGH_WATER_MARK_BYTES + 1,
      lastBytesAddedAt: Date.now(),
    });

    (manager as unknown as { _sweepClosed(): void })._sweepClosed();

    expect(stream.closedCalled).toBe(true);
    expect(manager.getClientCount()).toBe(0);
  });

  it("sweep evicts client whose write has stalled beyond WRITE_TIMEOUT_MS", () => {
    manager = new EventStreamManager();
    const stream = makeMockStream();
    const staleSince = Date.now() - (SSE_LIMITS.WRITE_TIMEOUT_MS + 1);
    manager.addClient({
      id: "stalled", stream, filters: {}, connectedAt: "",
      lastEventId: 0, pendingBytes: 512, lastBytesAddedAt: staleSince,
    });

    (manager as unknown as { _sweepClosed(): void })._sweepClosed();

    expect(stream.closedCalled).toBe(true);
    expect(manager.getClientCount()).toBe(0);
  });

  it("sweep does NOT evict a healthy client (pendingBytes within limit, write fresh)", () => {
    manager = new EventStreamManager();
    const stream = makeMockStream();
    manager.addClient({
      id: "ok", stream, filters: {}, connectedAt: "",
      lastEventId: 0, pendingBytes: 100, lastBytesAddedAt: Date.now(),
    });

    (manager as unknown as { _sweepClosed(): void })._sweepClosed();

    expect(stream.closedCalled).toBe(false);
    expect(manager.getClientCount()).toBe(1);
  });

  it("sweep does NOT evict a client with no pending bytes (idle)", () => {
    manager = new EventStreamManager();
    const stream = makeMockStream();
    manager.addClient({
      id: "idle", stream, filters: {}, connectedAt: "",
      lastEventId: 0, pendingBytes: 0, lastBytesAddedAt: 0,
    });

    (manager as unknown as { _sweepClosed(): void })._sweepClosed();

    expect(stream.closedCalled).toBe(false);
    expect(manager.getClientCount()).toBe(1);
  });
});

describe("Task 1: SSE source contains lastBytesAddedAt tracking", () => {
  const src = readFileSync(resolve("src/api/sse/event-stream.ts"), "utf-8");

  it("SSEClient interface has lastBytesAddedAt field", () => {
    expect(src).toContain("lastBytesAddedAt");
  });

  it("broadcast sets lastBytesAddedAt on write", () => {
    expect(src).toContain("lastBytesAddedAt = Date.now()");
  });

  it("broadcast clears lastBytesAddedAt when pendingBytes reaches 0", () => {
    expect(src).toContain("lastBytesAddedAt = 0");
  });

  it("_sweepClosed checks write timeout using WRITE_TIMEOUT_MS", () => {
    expect(src).toContain("WRITE_TIMEOUT_MS");
    expect(src).toContain("lastBytesAddedAt > SSE_LIMITS.WRITE_TIMEOUT_MS");
  });
});

// ---------------------------------------------------------------------------
// Task 7 — NpmUpdateProvider.checkForUpdate()
// ---------------------------------------------------------------------------

describe("Task 7: NpmUpdateProvider — checkForUpdate", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env["SIDJUA_NO_UPDATE_CHECK"];
  });

  it("returns null when SIDJUA_NO_UPDATE_CHECK=1", async () => {
    process.env["SIDJUA_NO_UPDATE_CHECK"] = "1";
    const { NpmUpdateProvider } = await import("../../src/core/update/npm-update-provider.js");
    const provider = new NpmUpdateProvider();
    const result = await provider.checkForUpdate("0.11.0");
    expect(result).toBeNull();
  });

  it("returns null when fetch fails (network error)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ENOTFOUND")));
    const { NpmUpdateProvider } = await import("../../src/core/update/npm-update-provider.js");
    const provider = new NpmUpdateProvider();
    const result = await provider.checkForUpdate("0.11.0");
    expect(result).toBeNull();
  });

  it("returns null when npm responds non-200", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    const { NpmUpdateProvider } = await import("../../src/core/update/npm-update-provider.js");
    const provider = new NpmUpdateProvider();
    const result = await provider.checkForUpdate("0.11.0");
    expect(result).toBeNull();
  });

  it("returns null when already on latest version", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: "0.11.0" }),
    }));
    const { NpmUpdateProvider } = await import("../../src/core/update/npm-update-provider.js");
    const provider = new NpmUpdateProvider();
    const result = await provider.checkForUpdate("0.11.0");
    expect(result).toBeNull();
  });

  it("returns null when npm has an older version than current", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: "0.10.0" }),
    }));
    const { NpmUpdateProvider } = await import("../../src/core/update/npm-update-provider.js");
    const provider = new NpmUpdateProvider();
    const result = await provider.checkForUpdate("0.11.0");
    expect(result).toBeNull();
  });

  it("returns UpdateInfo when a newer version is available", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: "0.12.0" }),
    }));
    const { NpmUpdateProvider } = await import("../../src/core/update/npm-update-provider.js");
    const provider = new NpmUpdateProvider();
    const result = await provider.checkForUpdate("0.11.0");
    expect(result).not.toBeNull();
    expect(result!.version).toBe("0.12.0");
    expect(result!.downloadUrl).toContain("0.12.0");
  });

  it("returned UpdateInfo includes required fields", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: "1.0.0" }),
    }));
    const { NpmUpdateProvider } = await import("../../src/core/update/npm-update-provider.js");
    const provider = new NpmUpdateProvider();
    const result = await provider.checkForUpdate("0.11.0");
    expect(result).not.toBeNull();
    expect(typeof result!.releaseDate).toBe("string");
    expect(typeof result!.breakingChanges).toBe("boolean");
    expect(Array.isArray(result!.newSystemRules)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Task 8 — shared isNetworkError deduplication
// ---------------------------------------------------------------------------

import { isNetworkError } from "../../src/provider/utils/network-errors.js";

describe("Task 8: isNetworkError — shared utility", () => {
  it("returns true for timeout errors", () => {
    expect(isNetworkError(new Error("request timeout"))).toBe(true);
  });

  it("returns true for ECONNRESET", () => {
    expect(isNetworkError(new Error("read ECONNRESET"))).toBe(true);
  });

  it("returns true for ECONNREFUSED", () => {
    expect(isNetworkError(new Error("connect ECONNREFUSED"))).toBe(true);
  });

  it("returns true for ENOTFOUND (DNS failure)", () => {
    expect(isNetworkError(new Error("getaddrinfo ENOTFOUND api.example.com"))).toBe(true);
  });

  it("returns true for ETIMEDOUT", () => {
    expect(isNetworkError(new Error("connect ETIMEDOUT"))).toBe(true);
  });

  it("returns true for generic network errors", () => {
    expect(isNetworkError(new Error("network unreachable"))).toBe(true);
  });

  it("returns false for non-network errors", () => {
    expect(isNetworkError(new Error("invalid_api_key"))).toBe(false);
    expect(isNetworkError(new Error("model not found"))).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isNetworkError(new Error("Connection TIMEOUT"))).toBe(true);
  });
});

describe("Task 8: adapters import from shared network-errors (source inspection)", () => {
  const anthropicSrc = readFileSync(resolve("src/provider/adapters/anthropic.ts"), "utf-8");
  const openaiSrc    = readFileSync(resolve("src/provider/adapters/openai.ts"),    "utf-8");

  it("anthropic adapter imports isNetworkError from ../utils/network-errors", () => {
    expect(anthropicSrc).toContain("from \"../utils/network-errors.js\"");
    expect(anthropicSrc).not.toMatch(/^function isNetworkError/m);
  });

  it("openai adapter imports isNetworkError from ../utils/network-errors", () => {
    expect(openaiSrc).toContain("from \"../utils/network-errors.js\"");
    expect(openaiSrc).not.toMatch(/^function isNetworkError/m);
  });

  it("network-errors.ts adds ENOTFOUND and ETIMEDOUT beyond the old patterns", () => {
    const sharedSrc = readFileSync(resolve("src/provider/utils/network-errors.ts"), "utf-8");
    expect(sharedSrc).toContain("enotfound");
    expect(sharedSrc).toContain("etimedout");
  });
});
