/**
 * Unit tests: SlidingWindowRateLimiter
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { SlidingWindowRateLimiter } from "../../src/tool-integration/rate-limiter.js";
import type { RateLimitConfig } from "../../src/tool-integration/rate-limiter.js";

describe("SlidingWindowRateLimiter", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows requests under the limit", () => {
    const limiter = new SlidingWindowRateLimiter();
    const config: RateLimitConfig = { ops_per_min: 5 };

    const result = limiter.check("tool1", "exec", false, false, config);

    expect(result.allowed).toBe(true);
  });

  it("blocks requests over the limit", () => {
    const limiter = new SlidingWindowRateLimiter();
    const config: RateLimitConfig = { ops_per_min: 3 };

    // Record 3 hits to reach the limit
    for (let i = 0; i < 3; i++) {
      const checkResult = limiter.check("tool1", "exec", false, false, config);
      expect(checkResult.allowed).toBe(true);
      limiter.record("tool1", "exec", false, false, config);
    }

    // The 4th check should be blocked
    const blocked = limiter.check("tool1", "exec", false, false, config);
    expect(blocked.allowed).toBe(false);
    expect(blocked.window_type).toBe("ops_per_min");
    expect(blocked.limit).toBe(3);
    expect(blocked.current).toBe(3);
  });

  it("allows again after window expires", () => {
    const limiter = new SlidingWindowRateLimiter();
    const config: RateLimitConfig = { ops_per_min: 2 };

    // Fill to the limit
    for (let i = 0; i < 2; i++) {
      limiter.record("tool2", "write", false, false, config);
    }

    // Verify blocked
    const beforeReset = limiter.check("tool2", "write", false, false, config);
    expect(beforeReset.allowed).toBe(false);

    // Reset all windows (simulates all timestamps expiring)
    limiter.resetAll();

    // Should be allowed again
    const afterReset = limiter.check("tool2", "write", false, false, config);
    expect(afterReset.allowed).toBe(true);
  });
});
