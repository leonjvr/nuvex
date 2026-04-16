// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — P269: Route-level RBAC Scope Enforcement
 *
 * requireScope(minimumScope) creates a Hono middleware that rejects requests
 * whose CallerContext scope is below the required level.
 *
 * Scope hierarchy: admin(4) > operator(3) > agent(2) > readonly(1) > bootstrap(0)
 *
 * "bootstrap" is the legacy single-key role — it falls below all scopes and
 * is rejected by every requireScope() call. The only exception is
 * POST /api/v1/tokens which uses requireAdminOrBootstrap() to allow the
 * initial scoped-token creation flow.
 */

import type { MiddlewareHandler } from "hono";
import type { TokenScope }        from "../token-store.js";
import type { CallerContext }     from "../caller-context.js";
import { createLogger }           from "../../core/logger.js";

const logger = createLogger("require-scope");

/** Hono context key under which CallerContext is stored by the auth middleware. */
export const CALLER_CONTEXT_KEY = "callerContext";

/** Numeric levels for scope comparison. */
const SCOPE_LEVELS: Record<TokenScope, number> = {
  readonly: 1,
  agent:    2,
  operator: 3,
  admin:    4,
};

/**
 * Returns true when the actual scope satisfies the required minimum.
 * Missing/undefined scope is treated as 0 (below all scopes — no access).
 * "bootstrap" is explicitly treated as level 0 — it never satisfies any requireScope() call.
 */
export function scopeAtLeast(actual: CallerContext["role"], required: TokenScope): boolean {
  if (actual === undefined || actual === "bootstrap") return false;
  return (SCOPE_LEVELS[actual as TokenScope] ?? 0) >= SCOPE_LEVELS[required];
}

/**
 * Create a Hono middleware that enforces a minimum scope.
 *
 * Returns 401 when no CallerContext is present (unauthenticated request).
 * Returns 403 when the caller's scope is below the required minimum.
 *
 * Usage:
 *   app.post("/api/v1/tasks/run", requireScope("operator"), handler)
 *   app.delete("/api/v1/tokens/:id", requireScope("admin"), handler)
 */
export function requireScope(minimumScope: TokenScope): MiddlewareHandler {
  return async (c, next) => {
    const ctx = c.get(CALLER_CONTEXT_KEY) as CallerContext | undefined;

    if (ctx === undefined) {
      logger.warn("scope_no_context", "Route reached without CallerContext (auth middleware issue)", {
        metadata: { path: c.req.path, required: minimumScope },
      });
      return c.json(
        {
          error: {
            code:        "AUTH-001",
            message:     "Authentication required",
            recoverable: false,
          },
        },
        401,
      );
    }

    if (!scopeAtLeast(ctx.role, minimumScope)) {
      logger.warn("scope_insufficient", "Caller scope below required minimum", {
        metadata: {
          path:     c.req.path,
          actual:   ctx.role   ?? "readonly",
          required: minimumScope,
          tokenId:  ctx.tokenId,
        },
      });
      return c.json(
        {
          error: {
            code:        "AUTH-003",
            message:     "Insufficient scope",
            required:    minimumScope,
            actual:      ctx.role ?? "readonly",
            recoverable: false,
          },
        },
        403,
      );
    }

    return next();
  };
}
