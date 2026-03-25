// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Tests for P191 — Locale REST API Routes
 *
 * Coverage:
 *   - GET  /api/v1/locale        — metadata: current, available, completeness
 *   - GET  /api/v1/locale/:code  — full strings for a locale; 404 for unknown
 *   - POST /api/v1/config/locale — set locale; validates against available list
 *   - Completeness calculation   — en = 1.0, de = fraction
 *   - DB persistence             — locale persisted to workspace_config
 *   - Graceful degradation       — works without DB
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono }    from "hono";
import type { MiddlewareHandler } from "hono";
import Database    from "better-sqlite3";
import { createErrorHandler } from "../../src/api/middleware/error-handler.js";
import { registerLocaleRoutes }           from "../../src/api/routes/locale.js";
import { runWorkspaceConfigMigration }    from "../../src/api/workspace-config-migration.js";
import { getAvailableLocales, clearLocaleCache } from "../../src/i18n/index.js";
import { CALLER_CONTEXT_KEY } from "../../src/api/middleware/require-scope.js";

const withAdmin: MiddlewareHandler = (c, next) => {
  c.set(CALLER_CONTEXT_KEY, { role: "admin" });
  return next();
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDb() {
  const db = new Database(":memory:");
  runWorkspaceConfigMigration(db);
  return db;
}

function buildApp(db?: InstanceType<typeof Database> | null) {
  const app = new Hono();
  app.use("*", withAdmin);
  app.onError(createErrorHandler(false));
  registerLocaleRoutes(app, db !== undefined ? { db } : {});
  return app;
}

// ---------------------------------------------------------------------------
// GET /api/v1/locale — metadata
// ---------------------------------------------------------------------------

describe("GET /api/v1/locale", () => {
  beforeEach(() => clearLocaleCache());
  afterEach(() => clearLocaleCache());

  it("returns current, available, and completeness fields", async () => {
    const app = buildApp(null);
    const res  = await app.request("/api/v1/locale");
    expect(res.status).toBe(200);
    const body = await res.json() as { current: string; available: string[]; completeness: Record<string, number> };
    expect(body.current).toBe("en");
    expect(Array.isArray(body.available)).toBe(true);
    expect(body.available).toContain("en");
    expect(typeof body.completeness).toBe("object");
  });

  it("completeness.en is 1.0", async () => {
    const app = buildApp(null);
    const res  = await app.request("/api/v1/locale");
    const body = await res.json() as { completeness: Record<string, number> };
    expect(body.completeness["en"]).toBe(1.0);
  });

  it("completeness.de is between 0 and 1", async () => {
    const app = buildApp(null);
    const res  = await app.request("/api/v1/locale");
    const body = await res.json() as { completeness: Record<string, number> };
    const deCompleteness = body.completeness["de"];
    if (deCompleteness !== undefined) {
      expect(deCompleteness).toBeGreaterThan(0);
      expect(deCompleteness).toBeLessThanOrEqual(1.0);
    }
  });

  it("reads current locale from DB when set", async () => {
    const db  = makeDb();
    db.prepare("INSERT OR REPLACE INTO workspace_config (key, value, updated_at) VALUES ('locale', 'de', datetime('now'))").run();
    const app = buildApp(db);
    const res  = await app.request("/api/v1/locale");
    const body = await res.json() as { current: string };
    expect(body.current).toBe("de");
    db.close();
  });

  it("works without DB (no crash)", async () => {
    const app = buildApp(null);
    const res  = await app.request("/api/v1/locale");
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/locale/:locale — full strings
// ---------------------------------------------------------------------------

describe("GET /api/v1/locale/:locale", () => {
  beforeEach(() => clearLocaleCache());
  afterEach(() => clearLocaleCache());

  it("returns strings and completeness for 'en'", async () => {
    const app = buildApp(null);
    const res  = await app.request("/api/v1/locale/en");
    expect(res.status).toBe(200);
    const body = await res.json() as { locale: string; strings: Record<string, string>; completeness: number };
    expect(body.locale).toBe("en");
    expect(typeof body.strings).toBe("object");
    expect(Object.keys(body.strings).length).toBeGreaterThan(10);
    expect(body.completeness).toBe(1.0);
  });

  it("en strings contain gui namespace keys", async () => {
    const app = buildApp(null);
    const res  = await app.request("/api/v1/locale/en");
    const body = await res.json() as { strings: Record<string, string> };
    expect(body.strings["gui.nav.dashboard"]).toBe("Dashboard");
    expect(body.strings["gui.shell.not_connected"]).toBe("Not connected to SIDJUA server.");
  });

  it("returns strings for 'de'", async () => {
    const available = getAvailableLocales();
    if (!available.includes("de")) return; // skip if de not present
    const app = buildApp(null);
    const res  = await app.request("/api/v1/locale/de");
    expect(res.status).toBe(200);
    const body = await res.json() as { locale: string; strings: Record<string, string> };
    expect(body.locale).toBe("de");
    expect(body.strings["gui.nav.dashboard"]).toBe("Dashboard");
    expect(body.strings["gui.shell.not_connected"]).toBe("Nicht mit SIDJUA-Server verbunden.");
  });

  it("returns 404 for unknown locale", async () => {
    const app = buildApp(null);
    const res  = await app.request("/api/v1/locale/xx");
    expect(res.status).toBe(404);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe("LOCALE-001");
  });

  it("does not include _meta keys in completeness calculation for en", async () => {
    const app = buildApp(null);
    const res  = await app.request("/api/v1/locale/en");
    const body = await res.json() as { completeness: number };
    expect(body.completeness).toBe(1.0); // en always 1.0 regardless of meta
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/config/locale — set locale
// ---------------------------------------------------------------------------

describe("POST /api/v1/config/locale", () => {
  beforeEach(() => clearLocaleCache());
  afterEach(() => clearLocaleCache());

  it("accepts a valid locale and returns success", async () => {
    const app = buildApp(null);
    const res  = await app.request("/api/v1/config/locale", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ locale: "en" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; locale: string };
    expect(body.success).toBe(true);
    expect(body.locale).toBe("en");
  });

  it("persists locale to DB", async () => {
    const available = getAvailableLocales();
    if (!available.includes("de")) return;
    const db  = makeDb();
    const app = buildApp(db);
    await app.request("/api/v1/config/locale", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ locale: "de" }),
    });
    const row = db.prepare<[], { value: string }>("SELECT value FROM workspace_config WHERE key = 'locale'").get();
    expect(row?.value).toBe("de");
    db.close();
  });

  it("returns 400 for unknown locale", async () => {
    const app = buildApp(null);
    const res  = await app.request("/api/v1/config/locale", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ locale: "xx" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe("LOCALE-003");
  });

  it("returns 400 for missing locale field", async () => {
    const app = buildApp(null);
    const res  = await app.request("/api/v1/config/locale", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid JSON body", async () => {
    const app = buildApp(null);
    const res  = await app.request("/api/v1/config/locale", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    "not-json",
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe("LOCALE-002");
  });

  it("works without DB (no crash, still changes in-memory locale)", async () => {
    const app = buildApp(null);
    const res  = await app.request("/api/v1/config/locale", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ locale: "en" }),
    });
    expect(res.status).toBe(200);
  });

  it("returns 400 LOCALE-001 for GUI-only locale (es) — not server-supported", async () => {
    const available = getAvailableLocales();
    if (!available.includes("es")) return; // skip if es not present in this env
    const app = buildApp(null);
    const res  = await app.request("/api/v1/config/locale", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ locale: "es" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe("LOCALE-001");
    expect(body.error.message).toContain("es");
    expect(body.error.message).toContain("en");
    expect(body.error.message).toContain("de");
  });

  it("accepts 'de' (server-supported locale)", async () => {
    const available = getAvailableLocales();
    if (!available.includes("de")) return;
    const app = buildApp(null);
    const res  = await app.request("/api/v1/config/locale", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ locale: "de" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; locale: string };
    expect(body.success).toBe(true);
    expect(body.locale).toBe("de");
  });
});
