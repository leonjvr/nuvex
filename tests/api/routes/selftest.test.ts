// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Tests for src/api/routes/selftest.ts — REST API
 */

import { describe, it, expect } from "vitest";
import { Hono }   from "hono";
import { registerSelftestApiRoutes } from "../../../src/api/routes/selftest.js";
import { createErrorHandler }        from "../../../src/api/middleware/error-handler.js";
import { withAdminCtx }              from "../../helpers/with-admin-ctx.js";

function buildApp(): Hono {
  const app = new Hono();
  app.onError(createErrorHandler(false));
  app.use("*", withAdminCtx);
  registerSelftestApiRoutes(app, process.cwd());
  return app;
}

// ---------------------------------------------------------------------------

describe("GET /api/v1/selftest", () => {
  it("returns 200 with SelftestReport shape", async () => {
    const app = buildApp();
    const res  = await app.request("/api/v1/selftest");
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty("healthScore");
    expect(body).toHaveProperty("checks");
    expect(body).toHaveProperty("summary");
    expect(body).toHaveProperty("version");
    expect(body).toHaveProperty("recommendations");
  }, 30_000);

  it("healthScore is a number 0-100", async () => {
    const app = buildApp();
    const res  = await app.request("/api/v1/selftest");
    const body = await res.json() as Record<string, unknown>;
    const score = body["healthScore"] as number;
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  }, 30_000);

  it("checks array contains objects with expected shape", async () => {
    const app = buildApp();
    const res  = await app.request("/api/v1/selftest");
    const body = await res.json() as Record<string, unknown>;
    const checks = body["checks"] as Array<Record<string, unknown>>;
    expect(Array.isArray(checks)).toBe(true);
    if (checks.length > 0) {
      expect(checks[0]).toHaveProperty("name");
      expect(checks[0]).toHaveProperty("status");
      expect(checks[0]).toHaveProperty("category");
      expect(checks[0]).toHaveProperty("message");
      expect(checks[0]).toHaveProperty("duration");
    }
  }, 30_000);

  it("filters to a single category via ?category param", async () => {
    const app  = buildApp();
    const res  = await app.request("/api/v1/selftest?category=resource");
    expect(res.status).toBe(200);
    const body   = await res.json() as Record<string, unknown>;
    const checks = body["checks"] as Array<Record<string, unknown>>;
    expect(checks.every((c) => c["category"] === "resource")).toBe(true);
  }, 30_000);

  it("filters to multiple categories", async () => {
    const app  = buildApp();
    const res  = await app.request("/api/v1/selftest?category=resource,dependency");
    expect(res.status).toBe(200);
    const body   = await res.json() as Record<string, unknown>;
    const checks = body["checks"] as Array<Record<string, unknown>>;
    const cats   = new Set(checks.map((c) => c["category"] as string));
    expect([...cats].every((cat) => ["resource", "dependency"].includes(cat))).toBe(true);
  }, 30_000);

  it("returns 400 for unknown category", async () => {
    const app = buildApp();
    const res = await app.request("/api/v1/selftest?category=nonexistent");
    expect(res.status).toBe(400);
  }, 10_000);

  it("summary has total, passed, warned, failed, skipped", async () => {
    const app  = buildApp();
    const res  = await app.request("/api/v1/selftest");
    const body = await res.json() as Record<string, unknown>;
    const sum  = body["summary"] as Record<string, unknown>;
    expect(sum).toHaveProperty("total");
    expect(sum).toHaveProperty("passed");
    expect(sum).toHaveProperty("warned");
    expect(sum).toHaveProperty("failed");
    expect(sum).toHaveProperty("skipped");
  }, 30_000);
});

// ---------------------------------------------------------------------------

describe("POST /api/v1/selftest/fix", () => {
  it("returns 200 with SelftestReport", async () => {
    const app = buildApp();
    const res = await app.request("/api/v1/selftest/fix", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty("healthScore");
    expect(body).toHaveProperty("checks");
  }, 30_000);
});
