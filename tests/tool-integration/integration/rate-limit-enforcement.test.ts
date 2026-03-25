/**
 * Integration test: Rate Limit Enforcement
 *
 * Covers: after the configured ops_per_min cap is reached, subsequent check()
 * calls return allowed=false with correct window metadata.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { runToolMigrations } from "../../../src/tool-integration/migration.js";
import {
  SlidingWindowRateLimiter,
  type RateLimitConfig,
} from "../../../src/tool-integration/rate-limiter.js";

let db: ReturnType<typeof Database>;

beforeEach(() => {
  db = new Database(":memory:");
  runToolMigrations(db);
});

afterEach(() => {
  db.close();
});

describe("Rate Limit Enforcement Integration", () => {
  it("exceeding rate limit blocks subsequent requests", () => {
    // 1. Create rate limiter
    const rateLimiter = new SlidingWindowRateLimiter();

    // 2. Configure a limit of 3 ops/min
    const config: RateLimitConfig = { ops_per_min: 3 };

    // 3. Perform 3 allowed check+record cycles
    for (let i = 0; i < 3; i++) {
      const checkResult = rateLimiter.check("tool1", "exec", false, false, config);
      expect(checkResult.allowed).toBe(true);
      rateLimiter.record("tool1", "exec", false, false, config);
    }

    // 4. The 4th check must be blocked
    const blocked = rateLimiter.check("tool1", "exec", false, false, config);
    expect(blocked.allowed).toBe(false);
    expect(blocked.window_type).toBe("ops_per_min");
    expect(blocked.limit).toBe(3);
    expect(blocked.current).toBe(3);
  });
});
