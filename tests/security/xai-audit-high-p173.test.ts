// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Security regression tests for xAI Grok 4.1 audit HIGH-priority findings.
 *
 *   T1: Tar-slip — backup.ts stores per-file SHA-256 checksums and verifies
 *       them after extraction; cleanup on mismatch.
 *   T2: N+1 queries in getAgentTrust — replaced with 3-query batch approach.
 *   T3: CLI server timer leak on SIGTERM — cleanupApiKeyTimers() clears
 *       pending rotation timers on graceful shutdown.
 *   T4: eval:true removed from WAL checkpoint worker — Worker now loads from
 *       a .cjs file path.
 *   T5: Secrets API CallerContext RBAC — agent callers restricted to own
 *       division namespace; operators have unrestricted access.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join }   from "node:path";
import Database   from "better-sqlite3";

// ===========================================================================
// T1: Tar-slip — per-file checksum manifest
// ===========================================================================

describe("T1: Backup tar-slip — per-file checksums", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "sidjua-t1-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("BackupManifest declares file_checksums field in source", () => {
    const src = readFileSync(
      new URL("../../src/core/backup.ts", import.meta.url),
      "utf-8",
    );
    expect(src).toContain("file_checksums");
    expect(src).toContain("Record<string, string>");
  });

  it("createBackup produces manifest with per-file SHA-256 checksums", async () => {
    const { createBackup, getBackupInfo } = await import("../../src/core/backup.js");
    const backupDir  = join(tmp, "backups");
    const configPath = join(tmp, "divisions.yaml");
    mkdirSync(backupDir, { recursive: true });
    writeFileSync(configPath, "schema_version: '1.0'\ncompany:\n  name: Test\n");

    const result = await createBackup({
      workDir:    tmp,
      configPath,
      outputPath: join(backupDir, "test.zip"),
    });

    const manifest = await getBackupInfo(result.archive_path);
    expect(manifest.file_checksums).toBeDefined();
    expect(typeof manifest.file_checksums).toBe("object");

    // Every file listed in manifest.files must have a SHA-256 checksum
    for (const relPath of manifest.files) {
      const checksum = manifest.file_checksums?.[relPath];
      expect(checksum).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("restoreBackup source verifies per-file checksums after extraction", () => {
    const src = readFileSync(
      new URL("../../src/core/backup.ts", import.meta.url),
      "utf-8",
    );
    // Post-extract verification must exist
    expect(src).toContain("Per-file checksum mismatch after extraction");
    expect(src).toContain("computeFileChecksum");
    // Cleanup is covered by the finally block — verify it is present
    expect(src).toContain("finally");
    expect(src).toContain("rmSync(tempDir");
  });
});

// ===========================================================================
// T2: N+1 queries in getAgentTrust
// ===========================================================================

import { AuditService }      from "../../src/core/audit/audit-service.js";
import { runAuditMigrations } from "../../src/core/audit/audit-migrations.js";
import { openDatabase }      from "../../src/utils/db.js";

function makeAuditTestDb(dir: string) {
  const systemDir = join(dir, ".system");
  mkdirSync(systemDir, { recursive: true });
  const db = openDatabase(join(systemDir, "sidjua.db"));
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id             TEXT PRIMARY KEY,
      parent_id      TEXT,
      root_id        TEXT NOT NULL,
      division       TEXT NOT NULL,
      type           TEXT NOT NULL,
      tier           INTEGER NOT NULL DEFAULT 2,
      title          TEXT NOT NULL,
      description    TEXT NOT NULL,
      assigned_agent TEXT,
      status         TEXT NOT NULL DEFAULT 'DONE',
      priority       INTEGER NOT NULL DEFAULT 3,
      classification TEXT NOT NULL DEFAULT 'internal',
      created_at     TEXT NOT NULL,
      updated_at     TEXT NOT NULL
    );
  `);
  runAuditMigrations(db);
  return db;
}

describe("T2: getAgentTrust — batch SQL queries", () => {
  let tmp: string;
  let db:  ReturnType<typeof openDatabase>;
  let svc: AuditService;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "sidjua-t2-"));
    db  = makeAuditTestDb(tmp);
    svc = new AuditService(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  function insertTask(agentId: string, division: string, status = "DONE", ts = new Date().toISOString()) {
    const id = crypto.randomUUID();
    db.prepare(
      "INSERT INTO tasks (id, root_id, division, type, tier, title, description, assigned_agent, status, priority, classification, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(id, id, division, "execute", 2, "T", "D", agentId, status, 3, "internal", ts, ts);
  }

  function insertViolation(agentId: string, action = "blocked") {
    const id = crypto.randomUUID();
    const ts = new Date().toISOString();
    db.prepare(
      "INSERT INTO audit_events (id, timestamp, agent_id, division, event_type, rule_id, action, severity, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(id, ts, agentId, "engineering", "policy_check", "R1", action, "low", "{}");
  }

  it("getAgentTrust returns correct trust data for multiple agents", async () => {
    insertTask("agent-alpha", "engineering", "DONE");
    insertTask("agent-alpha", "engineering", "DONE");
    insertTask("agent-alpha", "engineering", "FAILED");
    insertViolation("agent-alpha", "blocked");

    insertTask("agent-beta", "product", "DONE");
    insertTask("agent-beta", "product", "DONE");

    const records = await svc.getAgentTrust({});

    const alpha = records.find((r) => r.agentId === "agent-alpha");
    const beta  = records.find((r) => r.agentId === "agent-beta");

    expect(alpha).toBeDefined();
    expect(alpha!.totalTasks).toBe(3);
    expect(alpha!.successfulTasks).toBe(2);
    expect(alpha!.failedTasks).toBe(1);
    expect(alpha!.violations).toBe(1);

    expect(beta).toBeDefined();
    expect(beta!.totalTasks).toBe(2);
    expect(beta!.successfulTasks).toBe(2);
    expect(beta!.violations).toBe(0);
    expect(beta!.trustScore).toBe(100);
  });

  it("getAgentTrust uses batch query methods instead of per-agent queries", () => {
    const src = readFileSync(
      new URL("../../src/core/audit/audit-service.ts", import.meta.url),
      "utf-8",
    );
    // Batch methods must be defined
    expect(src).toContain("_getBatchTaskCounts");
    expect(src).toContain("_getBatchViolationCounts");

    // Extract the getAgentTrust function body
    const startIdx = src.indexOf("async getAgentTrust");
    const endIdx   = src.indexOf("async getSummary");
    const trustFn  = src.slice(startIdx, endIdx);

    // Must call the batch methods
    expect(trustFn).toContain("_getBatchTaskCounts");
    expect(trustFn).toContain("_getBatchViolationCounts");

    // Must NOT call the per-agent methods directly inside the loop
    expect(trustFn).not.toContain("this._getTaskCounts(");
    expect(trustFn).not.toContain("this._getViolationCount(");
  });
});

// ===========================================================================
// T3: CLI server timer leak on SIGTERM
// ===========================================================================

import {
  cleanupApiKeyTimers,
  _resetApiKeyState,
} from "../../src/api/cli-server.js";

describe("T3: CLI server timer leak — cleanupApiKeyTimers", () => {
  beforeEach(() => _resetApiKeyState());
  afterEach(() => _resetApiKeyState());

  it("cleanupApiKeyTimers is exported from cli-server as a function", () => {
    expect(typeof cleanupApiKeyTimers).toBe("function");
  });

  it("cleanupApiKeyTimers is idempotent — safe to call with no active timer", () => {
    expect(() => cleanupApiKeyTimers()).not.toThrow();
    expect(() => cleanupApiKeyTimers()).not.toThrow();
  });

  it("cli-server.ts source hooks cleanupApiKeyTimers to SIGTERM and SIGINT handlers", () => {
    const src = readFileSync(
      new URL("../../src/api/cli-server.ts", import.meta.url),
      "utf-8",
    );
    expect(src).toContain("export function cleanupApiKeyTimers");
    expect(src).toContain("clearTimeout");

    // Verify the signal handlers call cleanupApiKeyTimers
    const sigBlock = src.slice(src.indexOf("process.once(\"SIGTERM\""), src.indexOf("process.once(\"SIGTERM\"") + 300);
    expect(sigBlock).toContain("cleanupApiKeyTimers");
  });

  it("cli-server.ts source clears pendingTimer to null in cleanupApiKeyTimers", () => {
    const src = readFileSync(
      new URL("../../src/api/cli-server.ts", import.meta.url),
      "utf-8",
    );
    // The cleanup function must null out the timer after clearing
    const cleanupFn = src.slice(
      src.indexOf("function cleanupApiKeyTimers"),
      src.indexOf("function cleanupApiKeyTimers") + 200,
    );
    expect(cleanupFn).toContain("clearTimeout");
    expect(cleanupFn).toContain("pendingTimer = null");
  });
});

// ===========================================================================
// T4: eval:true removed from WAL checkpoint worker
// ===========================================================================

describe("T4: WAL checkpoint worker — eval:true removed", () => {
  it("backup.ts does not contain eval:true for Worker spawning", () => {
    const src = readFileSync(
      new URL("../../src/core/backup.ts", import.meta.url),
      "utf-8",
    );
    expect(src).not.toContain("eval: true");
    expect(src).not.toContain("eval:true");
  });

  it("backup.ts spawns Worker from a file path using import.meta.url", () => {
    const src = readFileSync(
      new URL("../../src/core/backup.ts", import.meta.url),
      "utf-8",
    );
    expect(src).toContain("backup-checkpoint-worker.cjs");
    expect(src).toContain("new URL");
    expect(src).toContain("import.meta.url");
  });

  it("backup-checkpoint-worker.cjs exists and contains WAL checkpoint logic", () => {
    const workerSrc = readFileSync(
      new URL("../../src/core/backup-checkpoint-worker.cjs", import.meta.url),
      "utf-8",
    );
    expect(workerSrc).toContain("wal_checkpoint");
    expect(workerSrc).toContain("workerData");
    expect(workerSrc).toContain("worker_threads");
    expect(workerSrc).not.toContain("eval");
  });
});

// ===========================================================================
// T5: Secrets API CallerContext RBAC
// ===========================================================================

import {
  authorizeSecretAccess,
  authorizeSecretWrite,
  registerSecretRoutes,
  type CallerContext,
} from "../../src/api/routes/secrets.js";
import { Hono }            from "hono";
import { CALLER_CONTEXT_KEY } from "../../src/api/middleware/require-scope.js";
import type { SecretsProvider, SecretMetadata } from "../../src/types/apply.js";

function makeSecretsProvider(): SecretsProvider {
  const store = new Map<string, string>();
  const MOCK_META: SecretMetadata = {
    created_at:       new Date().toISOString(),
    updated_at:       new Date().toISOString(),
    last_accessed_at: new Date().toISOString(),
    last_accessed_by: "test",
    rotation_age_days: 0,
    version:           1,
  };
  return {
    init:            async () => {},
    get:             async (ns, key) => store.get(`${ns}::${key}`) ?? null,
    set:             async (ns, key, val) => { store.set(`${ns}::${key}`, val); },
    delete:          async (ns, key) => { store.delete(`${ns}::${key}`); },
    list:            async (ns) => [...store.keys()].filter((k) => k.startsWith(`${ns}::`)).map((k) => k.slice(ns.length + 2)),
    ensureNamespace: async () => {},
    rotate:          async (ns, key, val) => { store.set(`${ns}::${key}`, val); },
    getMetadata:     async (ns, key) => store.has(`${ns}::${key}`) ? MOCK_META : null,
  };
}

function makeSecretsDb(): InstanceType<typeof Database> {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE secrets (
      namespace TEXT NOT NULL,
      key       TEXT NOT NULL,
      value     TEXT NOT NULL,
      PRIMARY KEY (namespace, key)
    );
  `);
  return db;
}

describe("T5: Secrets RBAC — CallerContext enforcement", () => {
  // Unit tests for the authorization helpers
  it("authorizeSecretAccess: agent can read own division namespace", () => {
    const ctx: CallerContext = { role: "agent", division: "engineering" };
    expect(authorizeSecretAccess("divisions/engineering", ctx)).toBe(true);
  });

  it("authorizeSecretAccess: agent cannot read a different division namespace", () => {
    const ctx: CallerContext = { role: "agent", division: "engineering" };
    expect(authorizeSecretAccess("divisions/product", ctx)).toBe(false);
  });

  it("authorizeSecretAccess: operator can read any namespace", () => {
    const ctx: CallerContext = { role: "operator" };
    expect(authorizeSecretAccess("divisions/engineering", ctx)).toBe(true);
    expect(authorizeSecretAccess("divisions/product", ctx)).toBe(true);
    expect(authorizeSecretAccess("global", ctx)).toBe(true);
  });

  it("authorizeSecretWrite: agent cannot write to global or other-division namespace", () => {
    const ctx: CallerContext = { role: "agent", division: "engineering" };
    expect(authorizeSecretWrite("global", ctx)).toBe(false);
    expect(authorizeSecretWrite("divisions/product", ctx)).toBe(false);
    expect(authorizeSecretWrite("divisions/engineering", ctx)).toBe(true);
  });

  // Route-level integration tests
  it("GET /api/v1/secrets/keys — agent accessing own division returns 200", async () => {
    const provider  = makeSecretsProvider();
    const secretsDb = makeSecretsDb();
    const ctx: CallerContext = { role: "agent", division: "engineering" };

    const app = new Hono();
    app.use("*", (c, next) => { c.set(CALLER_CONTEXT_KEY, ctx); return next(); });
    registerSecretRoutes(app, { provider, secretsDb, callerContext: ctx });

    const res = await app.request("/api/v1/secrets/keys?ns=divisions/engineering");
    expect(res.status).toBe(200);
    secretsDb.close();
  });

  it("GET /api/v1/secrets/keys — agent accessing different division returns 403", async () => {
    const provider  = makeSecretsProvider();
    const secretsDb = makeSecretsDb();
    const ctx: CallerContext = { role: "agent", division: "engineering" };

    const app = new Hono();
    app.use("*", (c, next) => { c.set(CALLER_CONTEXT_KEY, ctx); return next(); });
    registerSecretRoutes(app, { provider, secretsDb, callerContext: ctx });

    const res = await app.request("/api/v1/secrets/keys?ns=divisions/product");
    expect(res.status).toBe(403);
    secretsDb.close();
  });

  it("GET /api/v1/secrets/keys — operator accessing any division returns 200", async () => {
    const provider  = makeSecretsProvider();
    const secretsDb = makeSecretsDb();
    const ctx: CallerContext = { role: "operator" };

    const app = new Hono();
    app.use("*", (c, next) => { c.set(CALLER_CONTEXT_KEY, ctx); return next(); });
    registerSecretRoutes(app, { provider, secretsDb, callerContext: ctx });

    const res = await app.request("/api/v1/secrets/keys?ns=divisions/product");
    expect(res.status).toBe(200);
    secretsDb.close();
  });
});
