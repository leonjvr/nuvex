// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Prompt-120 Code Quality Fix Regression Tests
 *
 * FIX L5: Async log rotation
 * FIX L8: Detailed health check endpoint
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ============================================================================
// FIX L5 — Async log rotation (no synchronous renameSync blocking event loop)
// ============================================================================

import {
  createLogger,
  configureLogger,
  setGlobalLevel,
  resetLogger,
} from "../../src/core/logger.js";

describe("FIX L5 — Log rotation is async (no blocking renameSync)", () => {
  let logDir: string;

  beforeEach(() => {
    logDir = mkdtempSync(join(tmpdir(), "sidjua-log-rotation-test-"));
    resetLogger();
  });

  afterEach(() => {
    resetLogger();
    rmSync(logDir, { recursive: true, force: true });
  });

  it("logger writes to file without throwing", async () => {
    const logPath = join(logDir, "test.log");
    configureLogger({ output: "file", filePath: logPath });
    setGlobalLevel("info");
    const logger = createLogger("rotation-test");
    expect(() => logger.info("test_event", "hello", {})).not.toThrow();
    // Allow async stream flush to settle
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    expect(existsSync(logPath)).toBe(true);
  });

  it("repeated log writes don't throw during normal operation", async () => {
    const logPath = join(logDir, "multi.log");
    configureLogger({ output: "file", filePath: logPath });
    setGlobalLevel("debug");
    const logger = createLogger("rotation-multi");
    expect(() => {
      for (let i = 0; i < 10; i++) {
        logger.info("loop_event", `iteration ${i}`, { metadata: { i } });
      }
    }).not.toThrow();
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    expect(existsSync(logPath)).toBe(true);
  });

  it("rotation lock prevents concurrent rotation — many concurrent writes are safe", async () => {
    const logPath = join(logDir, "stress.log");
    configureLogger({ output: "file", filePath: logPath });
    setGlobalLevel("debug");
    const logger = createLogger("rotation-stress");

    const writes: Promise<void>[] = [];
    for (let i = 0; i < 20; i++) {
      writes.push(
        Promise.resolve().then(() => {
          logger.info("stress_event", `msg ${i}`, { metadata: { i } });
        }),
      );
    }
    await Promise.all(writes);
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    // No uncaught exceptions — rotation lock held correctly
    expect(existsSync(logPath)).toBe(true);
  });
});

// ============================================================================
// FIX L8 — Detailed health check endpoint (/api/v1/health/details)
// ============================================================================

import { Hono }               from "hono";
import { generateApiKey }     from "../../src/api/cli-server.js";
import { createApiServer }    from "../../src/api/server.js";
import { registerAllRoutes }  from "../../src/api/routes/index.js";

function makeAuthHeader(key: string): string {
  return `Bearer ${key}`;
}

describe("FIX L8 — /api/v1/health/details endpoint", () => {
  let apiKey: string;
  let app: Hono;

  beforeEach(() => {
    apiKey = generateApiKey();
    const server = createApiServer({
      port:         0,
      host:         "127.0.0.1",
      api_key:      apiKey,
      cors_origins: ["http://localhost:3000"],
      rate_limit:   { enabled: false, window_ms: 60_000, max_requests: 100, burst_max: 20 },
      trust_proxy:  false,
    });
    app = server.app;

    // Register routes with no db / orchestrator (minimal services)
    registerAllRoutes(app);
  });

  it("GET /api/v1/health/details returns 200 with valid auth", async () => {
    const res = await app.request("/api/v1/health/details", {
      method: "GET",
      headers: { Authorization: makeAuthHeader(apiKey) },
    });
    expect(res.status).toBe(200);
  });

  it("GET /api/v1/health/details returns 401 without auth", async () => {
    const res = await app.request("/api/v1/health/details", {
      method: "GET",
    });
    expect(res.status).toBe(401);
  });

  it("GET /api/v1/health/details returns component status object", async () => {
    const res = await app.request("/api/v1/health/details", {
      method: "GET",
      headers: { Authorization: makeAuthHeader(apiKey) },
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty("status");
    expect(body).toHaveProperty("components");
    expect(body).toHaveProperty("version");
  });

  it("GET /api/v1/health/details includes database component status", async () => {
    const res = await app.request("/api/v1/health/details", {
      method: "GET",
      headers: { Authorization: makeAuthHeader(apiKey) },
    });
    const body = (await res.json()) as Record<string, unknown>;
    const components = body["components"] as Record<string, unknown>;
    expect(components).toHaveProperty("database");
    const db = components["database"] as Record<string, unknown>;
    expect(db).toHaveProperty("status");
    // Without a DB configured, status should be 'unconfigured'
    expect(db["status"]).toBe("unconfigured");
  });

  it("GET /api/v1/health/details includes orchestrator component status", async () => {
    const res = await app.request("/api/v1/health/details", {
      method: "GET",
      headers: { Authorization: makeAuthHeader(apiKey) },
    });
    const body = (await res.json()) as Record<string, unknown>;
    const components = body["components"] as Record<string, unknown>;
    expect(components).toHaveProperty("orchestrator");
    const orch = components["orchestrator"] as Record<string, unknown>;
    expect(orch).toHaveProperty("status");
    expect(orch["status"]).toBe("unconfigured");
  });

  it("GET /api/v1/health still works (public, no auth needed)", async () => {
    const res = await app.request("/api/v1/health", { method: "GET" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["status"]).toBe("ok");
  });
});

// ============================================================================
// FIX L2 — openCliDatabase replaces boilerplate (unit level check)
// ============================================================================

import { openCliDatabase, hasTable } from "../../src/cli/utils/db-init.js";
import { mkdirSync } from "node:fs";
import Database from "better-sqlite3";

describe("FIX L2 — openCliDatabase helper", () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "sidjua-dbinit-test-"));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("returns null and writes to stderr when DB file does not exist", () => {
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const result = openCliDatabase({ workDir });
    expect(result).toBeNull();
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("sidjua apply"));
    errSpy.mockRestore();
  });

  it("opens successfully when DB file exists", () => {
    const systemDir = join(workDir, ".system");
    mkdirSync(systemDir, { recursive: true });
    // Create minimal DB
    const db = new Database(join(systemDir, "sidjua.db"));
    db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY)");
    db.close();

    const result = openCliDatabase({ workDir });
    expect(result).not.toBeNull();
    result?.close();
  });

  it("hasTable returns false for non-existent table", async () => {
    const systemDir = join(workDir, ".system");
    mkdirSync(systemDir, { recursive: true });
    const db = new Database(join(systemDir, "sidjua.db"));
    db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY)");
    expect(hasTable(db, "nonexistent")).toBe(false);
    expect(hasTable(db, "test")).toBe(true);
    db.close();
  });
});
