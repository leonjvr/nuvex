// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Body size limit middleware
 *
 * Rejects requests whose Content-Length exceeds MAX_BODY_BYTES before the
 * body is parsed. Applied to ALL request methods / content types so it runs
 * before auth, rate-limiting, and the JSON sanitizer.
 *
 * Limit is configurable via SIDJUA_MAX_BODY_BYTES env var (bytes).
 * Default: 1 MiB — shared with the JSON sanitizer so both layers enforce the
 * same ceiling and requests never slip between them.
 *
 * NOTE: Multi-worker/cluster support requires a shared body-limit config.
 *
 * NOTE: Content-Length is advisory (a malicious client could omit it or lie).
 * The httpInputSanitizer has an additional defensive check at JSON-parse time.
 * Hono's streaming infrastructure limits actual body reads per Fetch API spec.
 */

import type { MiddlewareHandler } from "hono";
import { createLogger } from "../../core/logger.js";
import { MAX_BODY_BYTES } from "./body-constants.js";

export { MAX_BODY_BYTES };

const logger = createLogger("api-server");


/**
 * Reject requests with Content-Length > MAX_BODY_BYTES before parsing.
 * Applies to all HTTP methods.
 */
export const bodyLimitMiddleware: MiddlewareHandler = async (c, next) => {
  const contentLength = c.req.header("content-length");
  if (contentLength !== undefined) {
    const len = parseInt(contentLength, 10);
    if (!isNaN(len) && len > MAX_BODY_BYTES) {
      logger.warn("body_too_large", "Request body exceeds size limit", {
        metadata: { contentLength: len, limit: MAX_BODY_BYTES, path: c.req.path },
      });
      return c.json(
        { error: `Request body too large (limit: ${MAX_BODY_BYTES} bytes)` },
        413,
      );
    }
  }
  return next();
};
