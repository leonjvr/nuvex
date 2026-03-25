// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * P267: Security Hardening — master key, secrets fail-closed, SSRF, symlink, audit.
 *
 * Covers:
 *   1. master key generated on first run (32 bytes, mode 0o600)
 *   2. master key migration from legacy hostname-derived encryption
 *   3. secrets route without callerContext returns 403
 *   4. secrets route with operator callerContext works
 *   5. provider test rejects private IPs
 *   6. provider test rejects unknown domains
 *   7. provider test allows known providers (returns 400/401, not URL rejection 400)
 *   8. GUI rejects symlink outside directory
 *   9. audit service works without legacy audit_trail table
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync, rmSync, mkdirSync, writeFileSync,
  symlinkSync, statSync, readFileSync, realpathSync,
} from "node:fs";
import { join }          from "node:path";
import { tmpdir, hostname } from "node:os";
import { createHash, createCipheriv, randomBytes } from "node:crypto";
import BetterSQLite3     from "better-sqlite3";
import { Hono }          from "hono";
import { assertWithinDirectory } from "../../src/utils/path-utils.js";
import { withAdminCtx } from "../helpers/with-admin-ctx.js";

import {
  loadKeyState,
  persistKeyState,
  encryptApiKey,
  decryptApiKey,
  _resetMasterKey,
} from "../../src/api/key-store.js";
import { registerSecretRoutes } from "../../src/api/routes/secrets.js";
import { validateProviderUrl }  from "../../src/core/network/url-validator.js";
import { AuditService }         from "../../src/core/audit/audit-service.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "sidjua-sec-"));
  _resetMasterKey();
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  _resetMasterKey();
});

// ---------------------------------------------------------------------------
// Test 1: master key generated on first run
// ---------------------------------------------------------------------------

describe("master key generation", () => {
  it("creates master.key with 32 bytes on first loadKeyState", () => {
    const systemDir = join(tmpDir, ".system");
    mkdirSync(systemDir, { recursive: true });
    const dbPath = join(systemDir, "sidjua.db");

    // Seed DB with a plaintext key (no master.key yet)
    const db = new BetterSQLite3(dbPath);
    db.exec(`
      CREATE TABLE api_key_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        current_key TEXT NOT NULL,
        pending_key TEXT,
        pending_expires_at TEXT
      )
    `);
    // Store plaintext (pre-encryption migration)
    db.prepare("INSERT INTO api_key_state (id, current_key) VALUES (1, ?)").run("sk-test-key");
    db.close();

    loadKeyState(dbPath);

    const keyPath = join(systemDir, "master.key");
    const keyData = readFileSync(keyPath);
    expect(keyData.length).toBe(32);

    // Verify file permissions (mode 0o600 = 384 decimal, mask with 0o777)
    const stat = statSync(keyPath);
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it("reuses existing master.key on subsequent loads", () => {
    const systemDir = join(tmpDir, ".system");
    mkdirSync(systemDir, { recursive: true });
    const dbPath = join(systemDir, "sidjua.db");

    const db = new BetterSQLite3(dbPath);
    db.exec(`CREATE TABLE api_key_state (id INTEGER PRIMARY KEY CHECK (id = 1), current_key TEXT NOT NULL, pending_key TEXT, pending_expires_at TEXT)`);
    db.prepare("INSERT INTO api_key_state (id, current_key) VALUES (1, ?)").run("sk-test-key");
    db.close();

    loadKeyState(dbPath);

    const keyPath = join(systemDir, "master.key");
    const first   = readFileSync(keyPath);

    _resetMasterKey();
    loadKeyState(dbPath);

    const second = readFileSync(keyPath);
    expect(first.equals(second)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test 2: master key migration from legacy hostname-derived encryption
// ---------------------------------------------------------------------------

describe("legacy key migration", () => {
  it("decryptApiKey falls back to hostname-derived key for legacy ciphertext", () => {
    // Encrypt "my-api-key" with the legacy hostname-derived scheme
    const legacyKey = createHash("sha256")
      .update(`sidjua-key-store-v1:${hostname()}`)
      .digest();
    const iv     = randomBytes(16);
    const cipher = createCipheriv("aes-256-gcm", legacyKey, iv);
    const enc    = Buffer.concat([cipher.update("my-api-key", "utf8"), cipher.final()]);
    const tag    = cipher.getAuthTag();
    const encoded = Buffer.concat([iv, tag, enc]).toString("base64");

    // The new decryptApiKey must fall back to hostname-derived key
    const result = decryptApiKey(encoded);
    expect(result).toBe("my-api-key");
  });

  it("loadKeyState migrates a hostname-derived-encrypted current_key", () => {
    const systemDir = join(tmpDir, ".system");
    mkdirSync(systemDir, { recursive: true });
    const dbPath = join(systemDir, "sidjua.db");

    // Encrypt with legacy hostname key
    const legacyKey = createHash("sha256")
      .update(`sidjua-key-store-v1:${hostname()}`)
      .digest();
    const iv     = randomBytes(16);
    const cipher = createCipheriv("aes-256-gcm", legacyKey, iv);
    const enc    = Buffer.concat([cipher.update("sk-legacy", "utf8"), cipher.final()]);
    const tag    = cipher.getAuthTag();
    const legacy  = Buffer.concat([iv, tag, enc]).toString("base64");

    const db = new BetterSQLite3(dbPath);
    db.exec(`CREATE TABLE api_key_state (id INTEGER PRIMARY KEY CHECK (id = 1), current_key TEXT NOT NULL, pending_key TEXT, pending_expires_at TEXT)`);
    db.prepare("INSERT INTO api_key_state (id, current_key) VALUES (1, ?)").run(legacy);
    db.close();

    const state = loadKeyState(dbPath);
    expect(state).not.toBeNull();
    expect(state?.currentKey).toBe("sk-legacy");
  });
});

// ---------------------------------------------------------------------------
// Tests 3 & 4: secrets fail-closed / open
// ---------------------------------------------------------------------------

describe("secrets route caller context", () => {
  function makeSecretsDb() {
    const db = new BetterSQLite3(":memory:");
    db.exec(`
      CREATE TABLE secrets (
        namespace TEXT NOT NULL,
        key       TEXT NOT NULL,
        value     TEXT NOT NULL,
        PRIMARY KEY (namespace, key)
      )
    `);
    return db;
  }

  const mockProvider = {
    get:         async () => null,
    set:         async () => {},
    delete:      async () => {},
    list:        async () => [],
    rotate:      async () => {},
    getMetadata: async () => null,
  };

  it("returns 403 for all secrets endpoints when no callerContext provided", async () => {
    const app = new Hono();
    registerSecretRoutes(app, {
      provider:   mockProvider as never,
      secretsDb:  makeSecretsDb(),
      // callerContext intentionally omitted
    });

    const res = await app.request("/api/v1/secrets/namespaces");
    expect(res.status).toBe(403);

    const res2 = await app.request("/api/v1/secrets/keys?ns=global");
    expect(res2.status).toBe(403);
  });

  it("responds normally when operator callerContext is provided", async () => {
    const app = new Hono();
    app.use("*", withAdminCtx);
    registerSecretRoutes(app, {
      provider:      mockProvider as never,
      secretsDb:     makeSecretsDb(),
      callerContext: { role: "operator" },
    });

    const res  = await app.request("/api/v1/secrets/namespaces");
    expect(res.status).toBe(200);
    const body = await res.json() as { namespaces: string[] };
    expect(Array.isArray(body.namespaces)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests 5, 6, 7: SSRF protection via validateProviderUrl
// ---------------------------------------------------------------------------

describe("validateProviderUrl — SSRF protection", () => {
  it("rejects private IPv4 addresses", () => {
    expect(validateProviderUrl("https://10.0.0.1/v1").valid).toBe(false);
    expect(validateProviderUrl("https://192.168.1.1/v1").valid).toBe(false);
    expect(validateProviderUrl("https://172.16.0.1/v1").valid).toBe(false);
    expect(validateProviderUrl("https://127.0.0.1/v1").valid).toBe(false);
  });

  it("rejects unknown domains without allowCustom", () => {
    const r = validateProviderUrl("https://evil.com/v1");
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/unknown provider domain/i);
  });

  it("rejects non-HTTPS URLs", () => {
    const r = validateProviderUrl("http://api.openai.com/v1");
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/https/i);
  });

  it("allows known provider domains", () => {
    expect(validateProviderUrl("https://api.openai.com/v1").valid).toBe(true);
    expect(validateProviderUrl("https://api.groq.com/v1").valid).toBe(true);
    expect(validateProviderUrl("https://api.anthropic.com/v1").valid).toBe(true);
  });

  it("allows custom HTTPS domains when allowCustom is true", () => {
    const r = validateProviderUrl("https://my-own-endpoint.example.com/v1", { allowCustom: true });
    expect(r.valid).toBe(true);
  });

  it("still rejects private IPs even with allowCustom", () => {
    const r = validateProviderUrl("https://10.0.0.5/v1", { allowCustom: true });
    expect(r.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Test 8: GUI symlink rejection
// ---------------------------------------------------------------------------

describe("GUI static serving — symlink traversal", () => {
  it("rejects a symlink pointing outside the GUI directory", () => {
    // Create a "secret" file outside the GUI dir
    const secretFile = join(tmpDir, "secret.txt");
    writeFileSync(secretFile, "secret content");

    // Create a fake GUI dist dir
    const guiDir = join(tmpDir, "dist");
    mkdirSync(guiDir, { recursive: true });
    writeFileSync(join(guiDir, "index.html"), "<html></html>");

    // Create a symlink inside GUI dir pointing to the secret file
    const symlinkPath = join(guiDir, "evil.txt");
    symlinkSync(secretFile, symlinkPath);

    // assertWithinDirectory should detect that realpath(symlink) is outside guiDir
    const real = realpathSync(symlinkPath);

    let threw = false;
    try {
      assertWithinDirectory(real, guiDir);
    } catch {
      threw = true;
    }

    expect(threw).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test 9: audit service without legacy audit_trail table
// ---------------------------------------------------------------------------

describe("audit service — graceful without audit_trail", () => {
  it("generateReport succeeds when audit_trail table does not exist", async () => {
    const db = new BetterSQLite3(":memory:");
    // Only create audit_events, NOT audit_trail
    db.exec(`
      CREATE TABLE audit_events (
        id         TEXT PRIMARY KEY,
        timestamp  TEXT NOT NULL DEFAULT (datetime('now')),
        agent_id   TEXT,
        division   TEXT,
        event_type TEXT NOT NULL,
        rule_id    TEXT,
        action     TEXT NOT NULL DEFAULT 'allow',
        severity   TEXT NOT NULL DEFAULT 'low',
        details    TEXT,
        task_id    TEXT
      )
    `);

    const service = new AuditService(db);
    const report  = await service.generateReport({});

    expect(report).toBeDefined();
    expect(typeof report.complianceScore).toBe("number");

    db.close();
  });
});
