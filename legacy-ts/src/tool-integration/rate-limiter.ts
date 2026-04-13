// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 10.7: Sliding Window Rate Limiter
 *
 * In-memory per-tool, per-capability rate limiting with configurable windows.
 * Tracks ops_per_min, writes_per_min, deletes_per_hour.
 */

export interface RateLimitConfig {
  ops_per_min?: number;
  writes_per_min?: number;
  deletes_per_hour?: number;
}

export interface RateLimitResult {
  allowed: boolean;
  window_type?: string;
  limit?: number;
  current?: number;
  retry_after_ms?: number;
}

type WindowType = "ops_per_min" | "writes_per_min" | "deletes_per_hour";

const WINDOW_DURATIONS_MS: Record<WindowType, number> = {
  ops_per_min:     60_000,
  writes_per_min:  60_000,
  deletes_per_hour: 3_600_000,
};

/**
 * SlidingWindowRateLimiter
 *
 * Tracks timestamps for each (toolId, capability, windowType) bucket.
 * check() prunes old entries and tests whether the limit is exceeded.
 */
export class SlidingWindowRateLimiter {
  /** Map key: `${toolId}:${capability}:${windowType}` → sorted timestamps (ms) */
  private readonly windows = new Map<string, number[]>();

  /**
   * Check whether the given capability for a tool is within limits.
   *
   * @param toolId      Tool definition ID
   * @param capability  Capability name (e.g. "shell_exec")
   * @param isWrite     Whether the action is a write operation
   * @param isDelete    Whether the action is a delete operation
   * @param config      Rate limit configuration for this tool
   * @returns RateLimitResult — allowed=true means proceed, false means blocked
   */
  check(
    toolId: string,
    capability: string,
    isWrite: boolean,
    isDelete: boolean,
    config: RateLimitConfig,
  ): RateLimitResult {
    const now = Date.now();

    // --- ops_per_min (applies to all actions) ---
    if (config.ops_per_min !== undefined) {
      const result = this.checkWindow(
        toolId,
        capability,
        "ops_per_min",
        config.ops_per_min,
        now,
      );
      if (!result.allowed) return result;
    }

    // --- writes_per_min (applies to write + delete actions) ---
    if (isWrite && config.writes_per_min !== undefined) {
      const result = this.checkWindow(
        toolId,
        capability,
        "writes_per_min",
        config.writes_per_min,
        now,
      );
      if (!result.allowed) return result;
    }

    // --- deletes_per_hour ---
    if (isDelete && config.deletes_per_hour !== undefined) {
      const result = this.checkWindow(
        toolId,
        capability,
        "deletes_per_hour",
        config.deletes_per_hour,
        now,
      );
      if (!result.allowed) return result;
    }

    return { allowed: true };
  }

  /**
   * Record a hit after a successful check.
   * Must be called after check() returns allowed=true.
   */
  record(
    toolId: string,
    capability: string,
    isWrite: boolean,
    isDelete: boolean,
    config: RateLimitConfig,
  ): void {
    const now = Date.now();

    if (config.ops_per_min !== undefined) {
      this.recordHit(toolId, capability, "ops_per_min", now);
    }
    if (isWrite && config.writes_per_min !== undefined) {
      this.recordHit(toolId, capability, "writes_per_min", now);
    }
    if (isDelete && config.deletes_per_hour !== undefined) {
      this.recordHit(toolId, capability, "deletes_per_hour", now);
    }
  }

  /** Reset all windows for a specific tool (e.g. on restart). */
  reset(toolId: string): void {
    for (const key of this.windows.keys()) {
      if (key.startsWith(`${toolId}:`)) {
        this.windows.delete(key);
      }
    }
  }

  /** Reset all windows (useful in tests). */
  resetAll(): void {
    this.windows.clear();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private checkWindow(
    toolId: string,
    capability: string,
    windowType: WindowType,
    limit: number,
    now: number,
  ): RateLimitResult {
    const key = `${toolId}:${capability}:${windowType}`;
    const durationMs = WINDOW_DURATIONS_MS[windowType];
    const timestamps = this.getPruned(key, now, durationMs);

    if (timestamps.length >= limit) {
      // timestamps is non-empty here (length >= limit >= 1); [0] is safe
      const oldestInWindow = timestamps[0] ?? now;
      const retryAfterMs = durationMs - (now - oldestInWindow) + 1;
      return {
        allowed: false,
        window_type: windowType,
        limit,
        current: timestamps.length,
        retry_after_ms: retryAfterMs > 0 ? retryAfterMs : 1,
      };
    }

    return { allowed: true };
  }

  private recordHit(
    toolId: string,
    capability: string,
    windowType: WindowType,
    now: number,
  ): void {
    const key = `${toolId}:${capability}:${windowType}`;
    const durationMs = WINDOW_DURATIONS_MS[windowType];
    const timestamps = this.getPruned(key, now, durationMs);
    timestamps.push(now);
    this.windows.set(key, timestamps);
  }

  /**
   * Get (and update) the pruned timestamp list for a key.
   * Returns a NEW array with entries older than `durationMs` removed.
   */
  private getPruned(key: string, now: number, durationMs: number): number[] {
    const existing = this.windows.get(key) ?? [];
    const cutoff = now - durationMs;
    const pruned = existing.filter((ts) => ts > cutoff);
    this.windows.set(key, pruned);
    return pruned;
  }
}
