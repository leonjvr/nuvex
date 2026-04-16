// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 11a: Request Logger Middleware
 *
 * Generates a UUID request ID per request, adds it to the X-Request-Id
 * response header, and logs method/path/status/duration_ms via the
 * Phase 10.8 structured logger (component: api-server).
 *
 * The request ID is threaded as correlationId through all downstream logging.
 */

import type { MiddlewareHandler } from "hono";
import { randomUUID } from "node:crypto";
import { createLogger } from "../../core/logger.js";

const logger = createLogger("api-server");

/** Context variable key — downstream handlers read this for correlationId */
export const REQUEST_ID_KEY = "requestId";

export const requestLogger = (): MiddlewareHandler => async (c, next) => {
  const requestId = randomUUID();
  const start     = Date.now();

  // Make request ID available to downstream handlers
  c.set(REQUEST_ID_KEY, requestId);

  try {
    await next();
  } finally {
    const duration = Date.now() - start;
    const status   = c.res?.status ?? 500;

    // Add request ID to response header
    c.header("X-Request-Id", requestId);

    logger.info("http_request", `${c.req.method} ${c.req.path} ${status}`, {
      correlationId: requestId,
      duration_ms:   duration,
      metadata: {
        method:     c.req.method,
        path:       c.req.path,
        status,
        duration_ms: duration,
      },
    });
  }
};
