// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — CSRF origin-validation middleware
 *
 * Validates the Origin (or Referer) header for state-changing requests
 * (POST/PUT/DELETE/PATCH). Blocks cross-origin requests from non-localhost /
 * non-Tauri origins.
 *
 * Defense-in-depth: API key auth already prevents most CSRF, but a malicious
 * localhost page (e.g. compromised npm package with a dev server) could read
 * the key from localStorage. Origin validation adds an extra layer.
 *
 * BYPASS RULE:
 *   Requests carrying an Authorization header use custom-header auth (API key).
 *   Browsers cannot send custom headers cross-origin without a CORS pre-flight
 *   that this server would reject — so CSRF is not a viable attack vector when
 *   Authorization is present.  We skip the check to preserve CLI compatibility.
 *
 * MISSING ORIGIN RULE (updated):
 *   The previous implementation allowed requests with NO Origin header, which
 *   means form-POST CSRF attacks (which may omit Origin in some configs) could
 *   bypass the check.  Fixed: no-Origin requests are now blocked for mutating
 *   methods UNLESS the Authorization header is present (see bypass rule above).
 *
 * Allowed origins (when Origin IS present):
 *   - tauri://localhost* — Tauri 2.x WebView
 *   - http(s)://localhost[:<port>] — local dev server
 *   - http(s)://127.0.0.1[:<port>] — loopback alias
 *
 * Fallback: if Origin is absent but Referer is present, the origin component
 *   of the Referer URL is validated against the same allowlist.
 */

import type { MiddlewareHandler } from "hono";
import { createLogger } from "../../core/logger.js";

const logger = createLogger("api-server");


/** HTTP methods that mutate server state and therefore need CSRF protection. */
const MUTATING_METHODS = new Set(["POST", "PUT", "DELETE", "PATCH"]);

/**
 * Regex matching allowed origins.
 * - tauri://localhost* — Tauri 2.0 WebView
 * - http(s)://localhost[:<port>] — local dev server
 * - http(s)://127.0.0.1[:<port>] — loopback alias
 */
const ALLOWED_ORIGIN_RE =
  /^tauri:\/\/localhost(\.localhost)?$|^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;


/**
 * Reject state-changing requests from unexpected origins.
 *
 * Previously requests with NO Origin header were allowed
 * unconditionally. Now they are blocked unless the Authorization header
 * is present (indicating custom-header auth, not cookie-based auth).
 */
export const csrfMiddleware: MiddlewareHandler = async (c, next) => {
  // Safe methods don't mutate state — skip check
  if (!MUTATING_METHODS.has(c.req.method)) {
    return next();
  }

  // Custom-header auth (Authorization / Bearer) is CSRF-safe.
  // Browsers cannot send Authorization cross-origin without CORS pre-flight,
  // which this server would refuse for disallowed origins.
  const authHeader = c.req.header("authorization") ?? c.req.header("Authorization");
  if (authHeader !== undefined) {
    return next();
  }

  const origin  = c.req.header("origin");
  const referer = c.req.header("referer");

  // If neither Origin nor Referer is present, block the request.
  // A legitimate browser making a cross-origin form POST would include at
  // least one of these headers.  CLI / programmatic clients should send
  // Authorization (see bypass above) or include Origin.
  if (origin === undefined && referer === undefined) {
    logger.warn("csrf_missing_origin", "CSRF: state-changing request missing both Origin and Referer", {
      metadata: { method: c.req.method, path: c.req.path },
    });
    return c.json({ error: "CSRF validation failed: missing Origin header" }, 403);
  }

  // Validate Origin header if present
  if (origin !== undefined) {
    if (!ALLOWED_ORIGIN_RE.test(origin)) {
      logger.warn("csrf_origin_rejected", "CSRF: request from disallowed origin blocked", {
        metadata: { origin, method: c.req.method, path: c.req.path },
      });
      return c.json({ error: "CSRF: invalid origin" }, 403);
    }
    return next();
  }

  // Fallback: validate Referer when Origin is absent
  // (some browsers and HTTP/1.0 clients send Referer without Origin)
  if (referer !== undefined) {
    let refererOrigin: string;
    try {
      refererOrigin = new URL(referer).origin;
    } catch (_err) {
      logger.warn("csrf_malformed_referer", "CSRF: malformed Referer header blocked", {
        metadata: { referer, method: c.req.method, path: c.req.path },
      });
      return c.json({ error: "CSRF validation failed: malformed Referer header" }, 403);
    }

    if (!ALLOWED_ORIGIN_RE.test(refererOrigin)) {
      logger.warn("csrf_referer_rejected", "CSRF: request from disallowed Referer origin blocked", {
        metadata: { refererOrigin, method: c.req.method, path: c.req.path },
      });
      return c.json({ error: "CSRF validation failed: disallowed Referer origin" }, 403);
    }
    return next();
  }

  // Unreachable — both origin and referer checked above — but TypeScript safety
  return next();
};
