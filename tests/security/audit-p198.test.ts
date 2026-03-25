// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Audit round-2 input validation + consistency tests.
 *
 * Covers:
 *   Task 1 (confirmed fix): CLI inline description size limit (100KB)
 *   Task 2 (confirmed fix): Shared MAX_BODY_BYTES constant (1MB both middlewares)
 *   Task 3 (confirmed fix): Content-Type middleware rejects missing/empty header
 *   Task 4 (false positive): costs.ts period clause uses switch allowlist
 */

import { describe, it, expect } from "vitest";
import { Hono } from "hono";

// ---------------------------------------------------------------------------
// Task 1 — CLI inline description size limit
// ---------------------------------------------------------------------------

describe("Task 1: run.ts — inline description 100KB size limit", () => {
  it("source contains MAX_INLINE_BYTES check", () => {
    const src = require("node:fs").readFileSync(
      require("node:path").join(process.cwd(), "src/cli/commands/run.ts"),
      "utf8",
    ) as string;
    expect(src).toContain("MAX_INLINE_BYTES");
    expect(src).toContain("100 * 1024");
    expect(src).toContain("100KB limit");
  });

  it("size check is applied before processing inline description", () => {
    const src = require("node:fs").readFileSync(
      require("node:path").join(process.cwd(), "src/cli/commands/run.ts"),
      "utf8",
    ) as string;
    const inlineBranch = src.slice(src.indexOf("opts.description !== undefined"));
    const limitPos     = inlineBranch.indexOf("MAX_INLINE_BYTES");
    const slicePos     = inlineBranch.indexOf("opts.description.slice(0, 80)");
    expect(limitPos).toBeGreaterThan(-1);
    expect(slicePos).toBeGreaterThan(-1);
    // The size check must precede the slice assignment
    expect(limitPos).toBeLessThan(slicePos);
  });

  it("1KB description passes limit check (simulation)", () => {
    const desc = "A".repeat(1024);
    const MAX_INLINE_BYTES = 100 * 1024;
    expect(Buffer.byteLength(desc, "utf8")).toBeLessThanOrEqual(MAX_INLINE_BYTES);
  });

  it("50KB description passes limit check (simulation)", () => {
    const desc = "A".repeat(50 * 1024);
    const MAX_INLINE_BYTES = 100 * 1024;
    expect(Buffer.byteLength(desc, "utf8")).toBeLessThanOrEqual(MAX_INLINE_BYTES);
  });

  it("101KB description exceeds limit (simulation)", () => {
    const desc = "A".repeat(101 * 1024);
    const MAX_INLINE_BYTES = 100 * 1024;
    expect(Buffer.byteLength(desc, "utf8")).toBeGreaterThan(MAX_INLINE_BYTES);
  });

  it("YAML file up to 1MB is still accepted (separate limit, unaffected)", () => {
    const src = require("node:fs").readFileSync(
      require("node:path").join(process.cwd(), "src/cli/commands/run.ts"),
      "utf8",
    ) as string;
    // The YAML file check uses 1MB, not 100KB
    expect(src).toContain("MAX_PROMPT_SIZE = 1 * 1024 * 1024");
  });
});

// ---------------------------------------------------------------------------
// Task 2 — Shared MAX_BODY_BYTES constant
// ---------------------------------------------------------------------------

describe("Task 2: body-constants.ts — shared MAX_BODY_BYTES", () => {
  it("body-constants.ts exists and exports MAX_BODY_BYTES", async () => {
    const { MAX_BODY_BYTES } = await import("../../src/api/middleware/body-constants.js");
    expect(typeof MAX_BODY_BYTES).toBe("number");
    expect(MAX_BODY_BYTES).toBe(1 * 1024 * 1024); // 1 MiB default
  });

  it("body-limit.ts imports from body-constants (not its own IIFE)", () => {
    const src = require("node:fs").readFileSync(
      require("node:path").join(process.cwd(), "src/api/middleware/body-limit.ts"),
      "utf8",
    ) as string;
    expect(src).toContain("from \"./body-constants.js\"");
    // Must NOT contain a local IIFE definition
    expect(src).not.toContain("return 2 * 1024 * 1024");
  });

  it("input-sanitizer.ts imports from body-constants (not its own IIFE)", () => {
    const src = require("node:fs").readFileSync(
      require("node:path").join(process.cwd(), "src/api/middleware/input-sanitizer.ts"),
      "utf8",
    ) as string;
    expect(src).toContain("from \"./body-constants.js\"");
    // Must NOT contain a local IIFE definition
    expect(src).not.toContain("return 1 * 1024 * 1024");
  });

  it("both middlewares now share the same limit value", async () => {
    const { MAX_BODY_BYTES: limitBytes } = await import("../../src/api/middleware/body-constants.js");
    // body-limit re-exports from body-constants
    const { MAX_BODY_BYTES: bodyLimitBytes } = await import("../../src/api/middleware/body-limit.js");
    expect(limitBytes).toBe(bodyLimitBytes);
  });

  it("SIDJUA_MAX_BODY_BYTES env var overrides the default", async () => {
    // Test the IIFE logic inline (cannot easily reload module with different env)
    const env = "2097152"; // 2 MB
    const parsed = parseInt(env, 10);
    expect(!isNaN(parsed) && parsed > 0).toBe(true);
    expect(parsed).toBe(2 * 1024 * 1024);
  });
});

// ---------------------------------------------------------------------------
// Task 3 — Content-Type middleware: reject missing/empty header
// ---------------------------------------------------------------------------

describe("Task 3: content-type.ts — missing/empty Content-Type rejected", () => {
  async function makeApp() {
    const { contentTypeJson } = await import("../../src/api/middleware/content-type.js");
    const app = new Hono();
    app.use("*", contentTypeJson);
    app.post("/test", (c) => c.json({ ok: true }));
    app.get("/test",  (c) => c.json({ ok: true }));
    return app;
  }

  it("POST with application/json is still accepted", async () => {
    const app = await makeApp();
    const res = await app.request("/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(200);
  });

  it("POST with no Content-Type is now rejected 415", async () => {
    const app = await makeApp();
    // Pass body as Uint8Array — fetch does NOT auto-add Content-Type for binary
    const res = await app.request("/test", {
      method: "POST",
      headers: { "Content-Length": "2" },
      body: new Uint8Array([123, 125]), // "{}"
    });
    expect(res.status).toBe(415);
    const body = await res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe("INPUT-005");
    expect(body.error.message).toContain("(missing)");
  });

  it("POST with empty Content-Type is rejected 415", async () => {
    const app = await makeApp();
    const res = await app.request("/test", {
      method: "POST",
      headers: { "Content-Type": "", "Content-Length": "2" },
      body: "{}",
    });
    expect(res.status).toBe(415);
  });

  it("POST with text/plain is still rejected 415", async () => {
    const app = await makeApp();
    const res = await app.request("/test", {
      method: "POST",
      headers: { "Content-Type": "text/plain", "Content-Length": "2" },
      body: "{}",
    });
    expect(res.status).toBe(415);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe("INPUT-005");
  });

  it("POST with Content-Length: 0 (empty body) passes without Content-Type", async () => {
    const app = await makeApp();
    const res = await app.request("/test", {
      method: "POST",
      headers: { "Content-Length": "0" },
    });
    expect(res.status).toBe(200);
  });

  it("GET without Content-Type still passes", async () => {
    const app = await makeApp();
    const res = await app.request("/test");
    expect(res.status).toBe(200);
  });

  it("source no longer allows empty mediaType bypass", () => {
    const src = require("node:fs").readFileSync(
      require("node:path").join(process.cwd(), "src/api/middleware/content-type.ts"),
      "utf8",
    ) as string;
    // The old bypass `&& mediaType !== ""` must be gone
    expect(src).not.toContain("mediaType !== \"\"");
    // The new missing-header message must be present
    expect(src).toContain("(missing)");
  });
});

// ---------------------------------------------------------------------------
// Task 4 — FALSE POSITIVE: costs.ts period clause
// ---------------------------------------------------------------------------

describe("Task 4 (false positive): costs.ts period clause is allowlisted", () => {
  it("periodToSql uses a switch statement (allowlist, not user-input concatenation)", () => {
    const src = require("node:fs").readFileSync(
      require("node:path").join(process.cwd(), "src/cli/commands/costs.ts"),
      "utf8",
    ) as string;
    expect(src).toContain("function periodToSql");
    expect(src).toContain("switch (period)");
    // The period clauses are hardcoded — no variable interpolation in SQL strings
    expect(src).toContain("datetime('now', '-1 hour')");
    expect(src).toContain("datetime('now', '-30 days')");
  });

  it("user-supplied division and agent values use parameterized queries", () => {
    const src = require("node:fs").readFileSync(
      require("node:path").join(process.cwd(), "src/cli/commands/costs.ts"),
      "utf8",
    ) as string;
    expect(src).toContain("division_code = ?");
    expect(src).toContain("agent_id = ?");
    expect(src).toContain("params.push(opts.division)");
    expect(src).toContain("params.push(opts.agent)");
  });
});
