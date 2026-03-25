// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 11a: HTTP Input Sanitizer Middleware
 *
 * Wraps the Phase 10.8 InputSanitizer for use in the HTTP middleware stack.
 * Applied to all POST/PUT/PATCH request bodies.
 *
 * Block mode: returns 400 with INPUT-xxx error code
 * Warn mode:  adds warnings to request context, continues
 */

import type { MiddlewareHandler } from "hono";
import { InputSanitizer, type SanitizerConfig } from "../../core/input-sanitizer.js";
import { SidjuaError } from "../../core/error-codes.js";
import { createLogger } from "../../core/logger.js";
import { REQUEST_ID_KEY } from "./request-logger.js";
import { MAX_BODY_BYTES } from "./body-constants.js";

const logger = createLogger("api-server");

/** Context variable key for sanitization warnings */
export const SANITIZE_WARNINGS_KEY = "sanitizeWarnings";

const BODY_METHODS = new Set(["POST", "PUT", "PATCH"]);

const COLLECT_MAX_DEPTH = 50;

/**
 * Recursively collect all strings (keys + values) from a JSON object/array.
 *
 * Now scans object KEYS in addition to values — prevents prompt injection
 * via JSON key names (e.g. `{"ignore previous instructions": "val"}`).
 * Guards against deep nesting (MAX_DEPTH=50) and circular references (WeakSet).
 */
function collectStrings(
  value: unknown,
  path  = "",
  depth = 0,
  seen  = new WeakSet<object>(),
): Array<{ path: string; value: string }> {
  if (depth > COLLECT_MAX_DEPTH) return [];

  if (typeof value === "string") {
    return [{ path, value }];
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return [];
    seen.add(value);
    return value.flatMap((item, i) =>
      collectStrings(item, `${path}[${i}]`, depth + 1, seen),
    );
  }
  if (value !== null && typeof value === "object") {
    if (seen.has(value as object)) return [];
    seen.add(value as object);
    const obj = value as Record<string, unknown>;
    const results: Array<{ path: string; value: string }> = [];
    for (const [k, v] of Object.entries(obj)) {
      // Scan key itself as a string
      results.push(...collectStrings(k, path ? `${path}.__key__` : "__key__", depth + 1, seen));
      // scan value
      results.push(...collectStrings(v, path ? `${path}.${k}` : k, depth + 1, seen));
    }
    return results;
  }
  return [];
}

/**
 * Create the HTTP input sanitizer middleware.
 *
 * @param config  Sanitizer configuration (default: warn mode)
 */
export const httpInputSanitizer = (
  config: Partial<SanitizerConfig> = { mode: "warn" },
): MiddlewareHandler => {
  const sanitizer = new InputSanitizer(config);

  return async (c, next) => {
    if (!BODY_METHODS.has(c.req.method)) {
      return next();
    }

    const contentType = c.req.header("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      return next();
    }

    // Enforce body size limit before parsing (prevent OOM).
    const contentLength = c.req.header("content-length");
    if (contentLength !== undefined) {
      const len = parseInt(contentLength, 10);
      if (!isNaN(len) && len > MAX_BODY_BYTES) {
        throw SidjuaError.from(
          "INPUT-001",
          `Request body exceeds maximum allowed size (${MAX_BODY_BYTES} bytes)`,
        );
      }
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch (e: unknown) {
      logger.debug("api-server", "Request body JSON parse failed — route handler will deal with missing body", { metadata: { error: e instanceof Error ? e.message : String(e) } });
      return next();
    }

    const requestId = (c.get(REQUEST_ID_KEY) as string | undefined) ?? "unknown";
    const strings   = collectStrings(body);
    const allWarnings: import("../../core/input-sanitizer.js").SanitizationWarning[] = [];

    for (const { path, value } of strings) {
      try {
        const result = sanitizer.sanitize(value);
        for (const w of result.warnings) {
          allWarnings.push({ ...w, detail: `[${path}] ${w.detail}` });
        }
      } catch (err) {
        if (err instanceof SidjuaError) {
          logger.warn("input_sanitization_blocked", "Request body blocked by sanitizer", {
            correlationId: requestId,
            metadata: { code: err.code, field: path },
          });
          return c.json(
            {
              error: {
                code:        err.code,
                message:     err.message,
                recoverable: err.recoverable,
                request_id:  requestId,
              },
            },
            400,
          );
        }
        throw err;
      }
    }

    if (allWarnings.length > 0) {
      logger.warn("input_sanitization_warning", "Sanitization warnings on request body", {
        correlationId: requestId,
        metadata: { warning_count: allWarnings.length },
      });
      c.set(SANITIZE_WARNINGS_KEY, allWarnings);
    }

    return next();
  };
};
