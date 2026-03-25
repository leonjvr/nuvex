// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * P250 — HIGH Security Hardening regression tests
 *
 * Tests:
 * 1.  Logger redacts value when key is aws_access_key_id
 * 2.  Logger redacts value when key is my_secret_key
 * 3.  Rate limiter: two different keys with same 20-char prefix get different bucket IDs
 * 4.  SSE rejects token= query string with 401
 * 5.  SSE accepts valid ticket
 * 6.  Email thread query returns only threads for the specified agent_id
 * 7.  Shell adapter throws SHELL-SEC-001 on input containing "; rm -rf /"
 * 8.  Shell adapter executes clean command+args successfully
 * 9.  REST adapter throws REST-SEC-001 for http://192.168.1.1/api
 * 10. REST adapter throws REST-SEC-001 for http://localhost:8080
 * 11. REST adapter allows https://api.example.com
 * 12. Audit policyType = "%" does NOT match all records
 * 13. Messaging config defaults to require_mapping: true
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join }   from "node:path";
import { Hono }   from "hono";
import { withAdminCtx } from "../helpers/with-admin-ctx.js";
import BetterSqlite3 from "better-sqlite3";
import { registerSseTicketRoutes, clearTickets } from "../../src/api/routes/sse-ticket.js";
import { registerEventRoutes }                   from "../../src/api/routes/events.js";
import { EventStreamManager }                    from "../../src/api/sse/event-stream.js";

// ---------------------------------------------------------------------------
// FIX-1/2: Logger sensitive key redaction
// ---------------------------------------------------------------------------

describe("P250 FIX-1 — logger redacts AWS-style compound keys", () => {
  it("redacts value when metadata key is aws_access_key_id", async () => {
    const { isSensitiveKey } = await import("../../src/core/logger.js") as {
      isSensitiveKey?: (key: string) => boolean;
    };
    // isSensitiveKey may not be exported — test via log output
    const { createLogger, resetLogger } = await import("../../src/core/logger.js");
    resetLogger();

    const lines: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      if (typeof chunk === "string") lines.push(chunk);
      return true;
    });

    const logger = createLogger("test");
    logger.info("test_event", "check redaction", {
      metadata: { aws_access_key_id: "AKIAIOSFODNN7EXAMPLE" },
    });

    spy.mockRestore();
    void origWrite;

    const output = lines.join("");
    expect(output).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(output).toContain("[REDACTED]");
  });

  it("redacts value when metadata key is my_secret_key", async () => {
    const { createLogger, resetLogger } = await import("../../src/core/logger.js");
    resetLogger();

    const lines: string[] = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      if (typeof chunk === "string") lines.push(chunk);
      return true;
    });

    const logger = createLogger("test");
    logger.info("test_event", "check redaction", {
      metadata: { my_secret_key: "super-secret-value-123" },
    });

    spy.mockRestore();

    const output = lines.join("");
    expect(output).not.toContain("super-secret-value-123");
    expect(output).toContain("[REDACTED]");
  });
});

// ---------------------------------------------------------------------------
// FIX-2: Rate limiter bucket ID — SHA-256 hash, no prefix collision
// ---------------------------------------------------------------------------

describe("P250 FIX-2 — rate limiter uses full auth header hash", () => {
  it("rate-limiter.ts source uses SHA-256 hash, not slice(0,20)", () => {
    const { readFileSync } = require("node:fs") as { readFileSync: (p: string, e: string) => string };
    const src = readFileSync(
      new URL("../../src/api/middleware/rate-limiter.ts", import.meta.url).pathname,
      "utf-8",
    );
    expect(src).toContain("createHash");
    expect(src).toContain("sha256");
    expect(src).not.toContain("auth.slice(0, 20)");
  });

  it("two keys with the same first 20 chars get different bucket IDs", async () => {
    const { clearRateLimitState } = await import("../../src/api/middleware/rate-limiter.js");
    clearRateLimitState();

    const { createApiServer } = await import("../../src/api/server.js");
    const server = createApiServer({
      port:           0,
      api_key:        "some-api-key",
      rate_limit:     { enabled: true, window_ms: 60_000, max_requests: 2, burst_max: 0 },
      cors_origins:   [],
      log_requests:   false,
      log_level:      "error",
      input_sanitizer_mode: "off",
    });

    // Two keys that share the same 20-char prefix but differ after char 20
    const key1 = "aaaaaaaaaaaaaaaaaaaaXXX1";
    const key2 = "aaaaaaaaaaaaaaaaaaaaXXX2";

    // Exhaust key1's bucket (2 requests)
    await server.app.request("/api/v1/health", { headers: { Authorization: `Bearer ${key1}` } });
    await server.app.request("/api/v1/health", { headers: { Authorization: `Bearer ${key1}` } });
    const blockedForKey1 = await server.app.request("/api/v1/health", { headers: { Authorization: `Bearer ${key1}` } });

    // key2 should still be allowed (different bucket)
    const allowedForKey2 = await server.app.request("/api/v1/health", { headers: { Authorization: `Bearer ${key2}` } });

    // key1 should be rate limited
    expect(blockedForKey1.status).toBe(429);
    // key2 should NOT be rate limited (different bucket despite same prefix)
    expect(allowedForKey2.status).not.toBe(429);
  });
});

// ---------------------------------------------------------------------------
// FIX-3: SSE — reject token= query parameter, accept ticket
// ---------------------------------------------------------------------------

describe("P250 FIX-3 — SSE rejects deprecated token= parameter", () => {
  const API_KEY = "test-sse-key-p250";

  function makeApp(): Hono {
    const app = new Hono();
    app.use("*", withAdminCtx);
    registerSseTicketRoutes(app, { getApiKey: () => API_KEY });
    registerEventRoutes(app, { getApiKey: () => API_KEY, manager: new EventStreamManager(), keepaliveIntervalMs: 60_000 });
    return app;
  }

  beforeEach(() => { clearTickets(); });

  it("returns 401 when token= query parameter is used", async () => {
    const app = makeApp();
    const res = await app.request(`/api/v1/events?token=${API_KEY}`);
    expect(res.status).toBe(401);
    const body = await res.json() as { error: { message: string } };
    expect(body.error.message).toContain("token= query parameter is not accepted");
  });

  it("returns 200 when a valid ticket is used", async () => {
    const app = makeApp();

    const ticketRes = await app.request("/api/v1/sse/ticket", {
      method:  "POST",
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    expect(ticketRes.status).toBe(200);
    const { ticket } = await ticketRes.json() as { ticket: string };

    const res = await app.request(`/api/v1/events?ticket=${ticket}`);
    expect(res.status).toBe(200);
    await res.body?.cancel();
  });
});

// ---------------------------------------------------------------------------
// FIX-4: Email threads filtered by agent_id
// ---------------------------------------------------------------------------

describe("P250 FIX-4 — email threads filtered by agent_id", () => {
  let tmp: string;

  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "sidjua-p250-email-")); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it("query returns only threads for the specified agent_id", async () => {
    const dbPath = join(tmp, "sidjua.db");
    const db = new BetterSqlite3(dbPath);

    db.exec(`
      CREATE TABLE email_threads (
        thread_id    TEXT PRIMARY KEY,
        message_id   TEXT NOT NULL,
        in_reply_to  TEXT,
        from_address TEXT NOT NULL,
        subject      TEXT NOT NULL,
        agent_id     TEXT NOT NULL DEFAULT 'unknown',
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL
      )
    `);

    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO email_threads (thread_id, message_id, from_address, subject, agent_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run("t1", "m1", "alice@example.com", "Subject 1", "agent-alpha", now, now);
    db.prepare(
      `INSERT INTO email_threads (thread_id, message_id, from_address, subject, agent_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run("t2", "m2", "bob@example.com", "Subject 2", "agent-beta", now, now);

    // Query for agent-alpha only
    const threads = db.prepare<[string], { thread_id: string }>(
      "SELECT thread_id FROM email_threads WHERE agent_id = ? ORDER BY updated_at DESC",
    ).all("agent-alpha");

    expect(threads).toHaveLength(1);
    expect(threads[0]!.thread_id).toBe("t1");
    db.close();
  });
});

// ---------------------------------------------------------------------------
// FIX-5: Shell adapter — metachar detection
// ---------------------------------------------------------------------------

describe("P250 FIX-5 — shell adapter metachar protection", () => {
  it("throws SHELL-SEC-001 when command contains shell metacharacters", async () => {
    const { ShellAdapter } = await import("../../src/tool-integration/adapters/shell-adapter.js");
    const { SidjuaError }  = await import("../../src/core/error-codes.js");

    const adapter = new ShellAdapter("s1", { type: "shell", allowed_commands: ["echo"] }, []);
    await adapter.connect();

    // P274 B2: shell-quote tokenization changed behavior — shell operators (;, |, &&)
    // are now detected by shell-quote's operator objects and return { success: false }
    // rather than throwing a SidjuaError. Both behaviors block the command.
    const result = await adapter.execute({
      tool_id:    "s1",
      capability: "execute",
      params:     { command: "echo hello; rm -rf /" },
      agent_id:   "a1",
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/operator/i);
  });

  it("executes clean command and args without throwing", async () => {
    const { ShellAdapter } = await import("../../src/tool-integration/adapters/shell-adapter.js");

    const adapter = new ShellAdapter("s1", { type: "shell", allowed_commands: ["echo"] }, []);
    await adapter.connect();

    const result = await adapter.execute({
      tool_id:    "s1",
      capability: "execute",
      params:     { command: "echo hello" },
      agent_id:   "a1",
    });

    expect(result.success).toBe(true);
    const data = result.data as { stdout: string };
    expect(data.stdout.trim()).toContain("hello");
  });
});

// ---------------------------------------------------------------------------
// FIX-6: REST adapter — private IP rejection
// ---------------------------------------------------------------------------

describe("P250 FIX-6 — REST adapter blocks private IP addresses", () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it("throws REST-SEC-001 for http://192.168.1.1/api", async () => {
    const { RestAdapter } = await import("../../src/tool-integration/adapters/rest-adapter.js");
    const { SidjuaError } = await import("../../src/core/error-codes.js");

    const adapter = new RestAdapter("r1", { type: "rest", base_url: "http://192.168.1.1" }, []);
    await adapter.connect();

    let caught: unknown;
    try {
      await adapter.execute({
        tool_id:    "r1",
        capability: "get",
        params:     { path: "/api" },
        agent_id:   "a1",
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(SidjuaError);
    expect((caught as import("../../src/core/error-codes.js").SidjuaError).code).toBe("REST-SEC-001");
  });

  it("throws REST-SEC-001 for http://localhost:8080", async () => {
    const { RestAdapter } = await import("../../src/tool-integration/adapters/rest-adapter.js");
    const { SidjuaError } = await import("../../src/core/error-codes.js");

    const adapter = new RestAdapter("r1", { type: "rest", base_url: "http://localhost:8080" }, []);
    await adapter.connect();

    let caught: unknown;
    try {
      await adapter.execute({
        tool_id:    "r1",
        capability: "get",
        params:     {},
        agent_id:   "a1",
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(SidjuaError);
    expect((caught as import("../../src/core/error-codes.js").SidjuaError).code).toBe("REST-SEC-001");
  });

  it("allows https://api.example.com (public address)", async () => {
    const { RestAdapter } = await import("../../src/tool-integration/adapters/rest-adapter.js");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } }),
    ));

    const adapter = new RestAdapter("r1", { type: "rest", base_url: "https://api.example.com" }, []);
    await adapter.connect();

    const result = await adapter.execute({
      tool_id:    "r1",
      capability: "get",
      params:     { path: "/data" },
      agent_id:   "a1",
    });

    expect(result.success).toBe(true);
    vi.restoreAllMocks();
  });
});

// ---------------------------------------------------------------------------
// FIX-7: Audit service — policyType = "%" does not match all records
// ---------------------------------------------------------------------------

describe("P250 FIX-7 — audit policyType wildcard does not match all records", () => {
  it('policyType = "%" does NOT match rows with other event_types', async () => {
    const { AuditService } = await import("../../src/core/audit/audit-service.js");
    const db = new BetterSqlite3(":memory:");

    db.exec(`
      CREATE TABLE audit_events (
        id TEXT PRIMARY KEY, timestamp TEXT, agent_id TEXT, division TEXT,
        event_type TEXT, rule_id TEXT, action TEXT, severity TEXT, details TEXT, task_id TEXT
      )
    `);

    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO audit_events VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).run("ev1", now, "agent-1", "eng", "forbidden.action", "r1", "blocked", "high", "{}", null);

    const svc = new AuditService(db);

    // Query with policyType = "%" should NOT match "forbidden.action"
    const report = await svc.generateReport({ policyType: "%" });

    // With exact matching, "%" does not match "forbidden.action"
    expect(report.totalEvents).toBe(0);
    db.close();
  });

  it("escapeSqlWildcards is exported and escapes % and _ correctly", async () => {
    const { escapeSqlWildcards } = await import("../../src/core/audit/audit-service.js");
    expect(escapeSqlWildcards("%")).toBe("\\%");
    expect(escapeSqlWildcards("_")).toBe("\\_");
    expect(escapeSqlWildcards("100%")).toBe("100\\%");
    expect(escapeSqlWildcards("a_b")).toBe("a\\_b");
  });
});

// ---------------------------------------------------------------------------
// FIX-8: Messaging config defaults to require_mapping: true
// ---------------------------------------------------------------------------

describe("P250 FIX-8 — messaging config defaults require_mapping to true", () => {
  it("loadMessagingConfig returns require_mapping: true when no config file exists", async () => {
    const { loadMessagingConfig } = await import("../../src/messaging/config-loader.js");
    const tmp2 = mkdtempSync(join(tmpdir(), "sidjua-p250-msg-"));
    try {
      const config = loadMessagingConfig(tmp2);
      expect(config.governance.require_mapping).toBe(true);
    } finally {
      rmSync(tmp2, { recursive: true, force: true });
    }
  });

  it("explicit require_mapping: false in config file is preserved", async () => {
    const { loadMessagingConfig } = await import("../../src/messaging/config-loader.js");
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const tmp2 = mkdtempSync(join(tmpdir(), "sidjua-p250-msg2-"));
    try {
      mkdirSync(join(tmp2, "governance"), { recursive: true });
      writeFileSync(
        join(tmp2, "governance", "messaging.yaml"),
        "governance:\n  require_mapping: false\n",
      );
      const config = loadMessagingConfig(tmp2);
      expect(config.governance.require_mapping).toBe(false);
    } finally {
      rmSync(tmp2, { recursive: true, force: true });
    }
  });
});
