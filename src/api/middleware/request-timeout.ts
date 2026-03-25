// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Request Timeout Middleware
 *
 * Enforces per-request maximum durations to prevent long-running DB queries
 * or LLM calls from holding connections indefinitely.
 *
 * Default timeouts by route category:
 *   Health checks:      5 s   (/api/v1/health)
 *   Read (GET):        30 s
 *   Write (POST/PUT):  60 s
 *   All others:        30 s
 *
 * Override via SIDJUA_REQUEST_TIMEOUT_MS env var (applies to all routes).
 *
 * Returns HTTP 504 with standard error format on timeout.
 */

import type { MiddlewareHandler } from "hono";
import { createLogger }           from "../../core/logger.js";

const logger = createLogger("api-server");

/** Context key for the per-request AbortSignal — downstream handlers check this to cancel in-flight work. */
export const ABORT_SIGNAL_KEY = "abortSignal";

export const REQUEST_TIMEOUTS = {
  HEALTH:   5_000,
  READ:    30_000,
  WRITE:   60_000,
  DEFAULT: 30_000,
} as const;

/** Global override from environment. When set, all routes use this value. */
const ENV_OVERRIDE: number | null = (() => {
  const raw = process.env["SIDJUA_REQUEST_TIMEOUT_MS"];
  if (raw === undefined) return null;
  const n = parseInt(raw, 10);
  return (!isNaN(n) && n > 0) ? n : null;
})();

/** Resolve timeout for a given method + path. */
export function resolveTimeout(method: string, path: string): number {
  if (ENV_OVERRIDE !== null) return ENV_OVERRIDE;
  if (path === "/api/v1/health") return REQUEST_TIMEOUTS.HEALTH;
  const m = method.toUpperCase();
  if (m === "GET"  || m === "HEAD") return REQUEST_TIMEOUTS.READ;
  if (m === "POST" || m === "PUT"  || m === "PATCH" || m === "DELETE")
    return REQUEST_TIMEOUTS.WRITE;
  return REQUEST_TIMEOUTS.DEFAULT;
}


/**
 * Apply a per-request timeout.
 *
 * Creates an AbortController per request and stores the signal in the Hono
 * context under ABORT_SIGNAL_KEY so downstream handlers can cancel in-flight
 * work (DB queries, LLM calls, etc.) when the timeout fires.
 *
 * Returns HTTP 504 if the deadline is exceeded.
 */
export const requestTimeout: MiddlewareHandler = async (c, next) => {
  const timeoutMs = resolveTimeout(c.req.method, c.req.path);

  const controller = new AbortController();
  c.set(ABORT_SIGNAL_KEY, controller.signal);

  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      controller.abort();          // ← abort FIRST
      reject(new Error(`TIMEOUT_${timeoutMs}`));
    }, timeoutMs);
    if (typeof timeoutHandle === "object" && timeoutHandle !== null && "unref" in timeoutHandle) {
      (timeoutHandle as { unref(): void }).unref();
    }
  });

  try {
    await Promise.race([next(), timeoutPromise]);
    clearTimeout(timeoutHandle!);
  } catch (err: unknown) {
    clearTimeout(timeoutHandle!);
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith("TIMEOUT_")) {
      const requestId = (c.get("requestId") as string | undefined) ?? "unknown";
      logger.warn("request_timeout", `Request timed out after ${timeoutMs}ms`, {
        metadata: { method: c.req.method, path: c.req.path, timeoutMs },
        correlationId: requestId,
      });
      return c.json(
        {
          error: {
            code:        "SYS-504",
            message:     "Request timed out",
            recoverable: true,
            request_id:  requestId,
          },
        },
        504,
      );
    }
    // Re-throw non-timeout errors for the global error handler.
    throw err;
  }
};
