// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * Test helper — injects an admin CallerContext into the Hono context.
 *
 * Route-level tests that create bare Hono apps (without the full auth
 * middleware stack) must inject a CallerContext so that requireScope()
 * middleware passes through.  Call this before registering routes:
 *
 *   const app = new Hono();
 *   app.use("*", withAdminCtx);
 *   registerMyRoutes(app, { ... });
 */

import type { MiddlewareHandler } from "hono";
import { CALLER_CONTEXT_KEY }    from "../../src/api/middleware/require-scope.js";

/**
 * Hono middleware that sets an admin CallerContext on every request.
 * Use ONLY in tests — simulates a fully-authenticated admin request.
 */
export const withAdminCtx: MiddlewareHandler = (c, next) => {
  c.set(CALLER_CONTEXT_KEY, { role: "admin" });
  return next();
};
