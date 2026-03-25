// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Retry utility with exponential backoff + jitter
 *
 * Replaces ad-hoc fixed-delay retry patterns across provider calls,
 * IPC reconnects, and other transient-failure scenarios.
 *
 * Usage:
 *   const result = await withRetry(() => provider.complete(prompt));
 *   const result = await withRetry(() => fetch(url), { maxRetries: 5, baseDelayMs: 500 });
 */


export interface RetryOptions {
  /** Maximum number of retry attempts after the first call. Default: 3 */
  maxRetries:   number;
  /** Base delay in milliseconds before the first retry. Default: 1000 */
  baseDelayMs:  number;
  /** Maximum delay cap in milliseconds. Default: 30_000 */
  maxDelayMs:   number;
  /** Add random jitter (±50% of computed delay) to prevent thundering herd. Default: true */
  jitter:       boolean;
}

export const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries:  3,
  baseDelayMs: 1_000,
  maxDelayMs:  30_000,
  jitter:      true,
};


/**
 * Execute `fn` with automatic retry on failure.
 *
 * Delay between attempts follows exponential backoff: `base * 2^attempt`,
 * capped at `maxDelayMs`. When `jitter` is enabled, the delay is multiplied
 * by a random factor in [0.5, 1.0] to spread retries across instances.
 *
 * @param fn       Async function to call. Should be idempotent.
 * @param opts     Retry options (merged with DEFAULT_RETRY_OPTIONS).
 * @throws         The last error thrown by `fn` after all retries are exhausted.
 */
export async function withRetry<T>(
  fn:   () => Promise<T>,
  opts: Partial<RetryOptions> = {},
): Promise<T> {
  const { maxRetries, baseDelayMs, maxDelayMs, jitter } = {
    ...DEFAULT_RETRY_OPTIONS,
    ...opts,
  };

  let lastErr: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastErr = err;

      if (attempt === maxRetries) break; // exhausted — fall through to throw

      const base    = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
      const delay   = jitter ? base * (0.5 + Math.random() * 0.5) : base;
      await sleep(delay);
    }
  }

  throw lastErr;
}

/**
 * Compute the delay (in ms) for a given attempt without actually sleeping.
 * Exported for tests; callers should use `withRetry`.
 */
export function computeDelay(
  attempt:    number,
  opts:       Partial<RetryOptions> = {},
  jitterSeed: number = 1.0,   // 1.0 = max, 0.5 = min (for deterministic tests)
): number {
  const { baseDelayMs, maxDelayMs } = { ...DEFAULT_RETRY_OPTIONS, ...opts };
  const base = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
  return base * jitterSeed;
}


function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
