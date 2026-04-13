// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — API response helpers (audit-7, Fix 8)
 *
 * Centralises repeated JSON response patterns to keep route handlers concise
 * and ensure consistent error body structure across all endpoints.
 */

import type { Context } from "hono";

/**
 * Return a 404 JSON response with a standard SIDJUA error body.
 *
 * @param c        Hono context
 * @param message  Human-readable description of what was not found
 * @param code     Error code (default: "SYS-404")
 * @param requestId Optional request correlation ID (default: read from context header)
 */
export function notFound(
  c: Context,
  message: string,
  code = "SYS-404",
  requestId?: string,
): Response {
  const reqId =
    requestId ??
    (c.get("requestId") as string | undefined) ??
    c.req.header("X-Request-Id") ??
    "unknown";
  return c.json(
    {
      error: {
        code,
        message,
        recoverable: false,
        request_id:  reqId,
      },
    },
    404,
  );
}
