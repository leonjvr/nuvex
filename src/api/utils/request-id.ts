// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — API request ID utility
 *
 * Single shared helper that extracts the request correlation ID from a Hono
 * context.  Replaces the identical copy-pasted `reqId()` function that was
 * duplicated across agents.ts, governance.ts, outputs.ts, and tasks.ts.
 */

import { REQUEST_ID_KEY } from "../middleware/request-logger.js";

/**
 * Extract the request correlation ID from the Hono context.
 *
 * @param c - Any object exposing a `get` method (Hono Context or test stub).
 * @returns The request ID string, or `"unknown"` if not set.
 */
export function reqId(c: { get(k: string): unknown }): string {
  return (c.get(REQUEST_ID_KEY as string) as string | undefined) ?? "unknown";
}
