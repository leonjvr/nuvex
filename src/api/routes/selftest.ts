// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Selftest REST API Routes
 *
 * GET  /api/v1/selftest               — full selftest report
 * GET  /api/v1/selftest?category=...  — filtered by category
 * POST /api/v1/selftest/fix           — run selftest with fix=true
 *
 * Timeout: 60 seconds max for full selftest.
 */

import { Hono }                  from "hono";
import { SidjuaError }           from "../../core/error-codes.js";
import { createDefaultRunner }   from "../../core/selftest/index.js";
import { KNOWN_CATEGORIES }      from "../../core/selftest/index.js";
import { requireScope }          from "../middleware/require-scope.js";


export function registerSelftestApiRoutes(app: Hono, workDir = process.cwd()): void {

  // ---- GET /api/v1/selftest -----------------------------------------------

  app.get("/api/v1/selftest", requireScope("readonly"), async (c) => {
    const catParam = c.req.query("category");
    const categories = catParam
      ? catParam.split(",").map((s) => s.trim()).filter(Boolean)
      : undefined;

    // Validate categories
    if (categories !== undefined) {
      const invalid = categories.filter((cat) => !(KNOWN_CATEGORIES as readonly string[]).includes(cat));
      if (invalid.length > 0) {
        throw SidjuaError.from("INPUT-003", `Unknown categories: ${invalid.join(", ")}. Valid: ${KNOWN_CATEGORIES.join(", ")}`);
      }
    }

    const runner = createDefaultRunner(categories);
    const report = await withTimeout(
      runner.run({ workDir, verbose: false, fix: false }),
      60_000,
    );

    return c.json(report);
  });

  // ---- POST /api/v1/selftest/fix ------------------------------------------

  app.post("/api/v1/selftest/fix", requireScope("admin"), async (c) => {
    const runner = createDefaultRunner();
    const report = await withTimeout(
      runner.run({ workDir, verbose: false, fix: true }),
      60_000,
    );
    return c.json(report);
  });
}


function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Selftest timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e: unknown) => { clearTimeout(timer); reject(e); },
    );
  });
}
