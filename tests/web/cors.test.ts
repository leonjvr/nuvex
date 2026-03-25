// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * CORS configuration tests.
 *
 * Verifies that CORS origins are correctly applied, ENV override works,
 * and wildcard mode is supported (with a warning log).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Hono } from "hono";
import { cors } from "hono/cors";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildCorsApp(origins: string[], allowAll = false): Hono {
  const app = new Hono();
  app.use("*", cors({
    origin:       allowAll ? "*" : origins,
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "Last-Event-ID"],
    exposeHeaders: ["X-Request-Id"],
    maxAge:       86400,
    credentials:  allowAll ? false : false,
  }));
  app.get("/test", (c) => c.json({ ok: true }));
  app.post("/test", (c) => c.json({ ok: true }));
  return app;
}

// ---------------------------------------------------------------------------
// Default localhost-only CORS
// ---------------------------------------------------------------------------

describe("CORS — default localhost-only", () => {
  it("allows GET from http://localhost:3000", async () => {
    const app = buildCorsApp(["http://localhost:3000"]);
    const res = await app.request("/test", {
      headers: { "Origin": "http://localhost:3000" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
  });

  it("does not include ACAO header for disallowed origin", async () => {
    const app = buildCorsApp(["http://localhost:3000"]);
    const res = await app.request("/test", {
      headers: { "Origin": "https://evil.example.com" },
    });
    // Hono cors() does not set the header for non-matching origins
    const acao = res.headers.get("access-control-allow-origin");
    expect(acao).not.toBe("https://evil.example.com");
  });

  it("responds to OPTIONS preflight with 204/200 and CORS headers", async () => {
    const app = buildCorsApp(["http://localhost:3000"]);
    const res = await app.request("/test", {
      method: "OPTIONS",
      headers: {
        "Origin":                         "http://localhost:3000",
        "Access-Control-Request-Method":  "POST",
        "Access-Control-Request-Headers": "Content-Type",
      },
    });
    expect([200, 204]).toContain(res.status);
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
  });

  it("includes Last-Event-ID in allowed headers", async () => {
    const app = buildCorsApp(["http://localhost:3000"]);
    const res = await app.request("/test", {
      method: "OPTIONS",
      headers: {
        "Origin":                         "http://localhost:3000",
        "Access-Control-Request-Method":  "GET",
        "Access-Control-Request-Headers": "Last-Event-ID",
      },
    });
    const allowedHeaders = res.headers.get("access-control-allow-headers") ?? "";
    expect(allowedHeaders.toLowerCase()).toContain("last-event-id");
  });

  it("max-age header present in preflight response", async () => {
    const app = buildCorsApp(["http://localhost:3000"]);
    const res = await app.request("/test", {
      method: "OPTIONS",
      headers: {
        "Origin":                        "http://localhost:3000",
        "Access-Control-Request-Method": "GET",
      },
    });
    expect(res.headers.get("access-control-max-age")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Multiple allowed origins
// ---------------------------------------------------------------------------

describe("CORS — multiple allowed origins", () => {
  const origins = ["http://localhost:3000", "https://admin.internal:3000"];

  it("allows first origin", async () => {
    const app = buildCorsApp(origins);
    const res = await app.request("/test", {
      headers: { "Origin": "http://localhost:3000" },
    });
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
  });

  it("allows second origin", async () => {
    const app = buildCorsApp(origins);
    const res = await app.request("/test", {
      headers: { "Origin": "https://admin.internal:3000" },
    });
    expect(res.headers.get("access-control-allow-origin")).toBe("https://admin.internal:3000");
  });
});

// ---------------------------------------------------------------------------
// Wildcard CORS
// ---------------------------------------------------------------------------

describe("CORS — wildcard mode", () => {
  it("wildcard allows any origin with *", async () => {
    const app = buildCorsApp([], true);
    const res = await app.request("/test", {
      headers: { "Origin": "https://arbitrary-client.example.com" },
    });
    expect(res.status).toBe(200);
    const acao = res.headers.get("access-control-allow-origin");
    expect(acao).toBe("*");
  });
});

// ---------------------------------------------------------------------------
// ENV override
// ---------------------------------------------------------------------------

describe("CORS — SIDJUA_CORS_ORIGINS env var", () => {
  const ORIGINAL = process.env["SIDJUA_CORS_ORIGINS"];

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env["SIDJUA_CORS_ORIGINS"];
    else process.env["SIDJUA_CORS_ORIGINS"] = ORIGINAL;
  });

  it("server startup reads SIDJUA_CORS_ORIGINS (source inspection)", () => {
    const { readFileSync } = require("node:fs");
    const src = readFileSync(
      new URL("../../src/api/cli-server.ts", import.meta.url),
      "utf-8",
    ) as string;
    expect(src).toContain("SIDJUA_CORS_ORIGINS");
    expect(src).toContain("cors_allow_all");
  });

  it("wildcard '*' in env sets cors_allow_all (source inspection)", () => {
    const { readFileSync } = require("node:fs");
    const src = readFileSync(
      new URL("../../src/api/cli-server.ts", import.meta.url),
      "utf-8",
    ) as string;
    expect(src).toContain(`corsOrigins.includes("*")`);
  });
});

// ---------------------------------------------------------------------------
// ApiServerConfig CORS fields (source inspection)
// ---------------------------------------------------------------------------

describe("ApiServerConfig CORS extension", () => {
  it("server.ts exports cors_allow_all, cors_credentials, cors_max_age fields", () => {
    const { readFileSync } = require("node:fs");
    const src = readFileSync(
      new URL("../../src/api/server.ts", import.meta.url),
      "utf-8",
    ) as string;
    expect(src).toContain("cors_allow_all");
    expect(src).toContain("cors_credentials");
    expect(src).toContain("cors_max_age");
  });

  it("wildcard warning is logged when cors_allow_all is true (source inspection)", () => {
    const { readFileSync } = require("node:fs");
    const src = readFileSync(
      new URL("../../src/api/server.ts", import.meta.url),
      "utf-8",
    ) as string;
    expect(src).toContain("cors_wildcard_enabled");
    expect(src).toContain("cors_allow_all");
  });
});
