// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Tests for src/core/retry.ts — withRetry utility (FIX L7)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { withRetry, computeDelay, DEFAULT_RETRY_OPTIONS } from "../../src/core/retry.js";

// ---------------------------------------------------------------------------
// computeDelay — deterministic tests (no randomness)
// ---------------------------------------------------------------------------

describe("computeDelay()", () => {
  it("returns baseDelayMs for attempt=0 with seed=1.0", () => {
    const delay = computeDelay(0, { baseDelayMs: 1000, jitter: false }, 1.0);
    expect(delay).toBe(1000);
  });

  it("doubles delay each attempt (exponential backoff)", () => {
    const d0 = computeDelay(0, { baseDelayMs: 1000 }, 1.0);
    const d1 = computeDelay(1, { baseDelayMs: 1000 }, 1.0);
    const d2 = computeDelay(2, { baseDelayMs: 1000 }, 1.0);
    expect(d1).toBe(d0 * 2);
    expect(d2).toBe(d0 * 4);
  });

  it("caps at maxDelayMs", () => {
    const delay = computeDelay(10, { baseDelayMs: 1000, maxDelayMs: 5000 }, 1.0);
    expect(delay).toBe(5000);
  });

  it("minimum delay with seed=0.5 is half the computed base", () => {
    const delay = computeDelay(0, { baseDelayMs: 1000 }, 0.5);
    expect(delay).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// withRetry — using fake timers
// ---------------------------------------------------------------------------

describe("withRetry()", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns immediately on first success", async () => {
    const fn = vi.fn().mockResolvedValue("result");
    const p = withRetry(fn, { maxRetries: 3, baseDelayMs: 100, maxDelayMs: 1000, jitter: false });
    await vi.runAllTimersAsync();
    expect(await p).toBe("result");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on transient failure and returns on success", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValue("ok");
    const p = withRetry(fn, { maxRetries: 3, baseDelayMs: 100, maxDelayMs: 1000, jitter: false });
    const [, result] = await Promise.all([vi.runAllTimersAsync(), p]);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("throws last error after maxRetries exhausted", async () => {
    const err = new Error("persistent failure");
    const fn = vi.fn().mockRejectedValue(err);
    const p = withRetry(fn, { maxRetries: 2, baseDelayMs: 50, maxDelayMs: 500, jitter: false });
    await Promise.all([vi.runAllTimersAsync(), expect(p).rejects.toThrow("persistent failure")]);
    expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it("maxRetries=0 means no retries — throws on first failure", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("fail"));
    const p = withRetry(fn, { maxRetries: 0, baseDelayMs: 100, maxDelayMs: 1000, jitter: false });
    await Promise.all([vi.runAllTimersAsync(), expect(p).rejects.toThrow("fail")]);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("applies exponential backoff delays between retries (verify attempt count)", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("fail"));
    const p = withRetry(fn, { maxRetries: 3, baseDelayMs: 100, maxDelayMs: 10_000, jitter: false });
    await Promise.all([vi.runAllTimersAsync(), expect(p).rejects.toThrow()]);
    // 1 initial + 3 retries = 4 total calls
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it("jitter produces delay within [0.5x, 1.0x] range", () => {
    // Test computeDelay directly with jitter seeds
    const base = computeDelay(0, { baseDelayMs: 1000, maxDelayMs: 30_000 }, 1.0);
    const min  = computeDelay(0, { baseDelayMs: 1000, maxDelayMs: 30_000 }, 0.5);
    expect(base).toBe(1000);
    expect(min).toBe(500);
    // Any actual jittered value should be in [min, base]
    for (let i = 0; i < 10; i++) {
      const seed = 0.5 + Math.random() * 0.5;
      const d = computeDelay(0, { baseDelayMs: 1000, maxDelayMs: 30_000 }, seed);
      expect(d).toBeGreaterThanOrEqual(500);
      expect(d).toBeLessThanOrEqual(1000);
    }
  });

  it("successful retry on third attempt returns result", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("fail 1"))
      .mockRejectedValueOnce(new Error("fail 2"))
      .mockResolvedValue("success on third");
    const p = withRetry(fn, { maxRetries: 3, baseDelayMs: 10, maxDelayMs: 100, jitter: false });
    const [, result] = await Promise.all([vi.runAllTimersAsync(), p]);
    expect(result).toBe("success on third");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("default options work when opts is omitted", async () => {
    const fn = vi.fn().mockResolvedValue(42);
    const p = withRetry(fn);
    const [, result] = await Promise.all([vi.runAllTimersAsync(), p]);
    expect(result).toBe(42);
  });

  it("DEFAULT_RETRY_OPTIONS has sensible values", () => {
    expect(DEFAULT_RETRY_OPTIONS.maxRetries).toBeGreaterThan(0);
    expect(DEFAULT_RETRY_OPTIONS.baseDelayMs).toBeGreaterThan(0);
    expect(DEFAULT_RETRY_OPTIONS.maxDelayMs).toBeGreaterThan(DEFAULT_RETRY_OPTIONS.baseDelayMs);
    expect(DEFAULT_RETRY_OPTIONS.jitter).toBe(true);
  });
});
