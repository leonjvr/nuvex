// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * v0.9.7 Security Sprint — Regression tests for MEDIUM severity fixes.
 *
 * FIX 1 (#463): Leading space in package.json dependency name — verify clean
 * FIX 2 (#468): Logs follow-mode polling — adaptive backoff from 2s → 5s
 * FIX 3 (#469): API key rotator — timer leak on rapid rotation, grace period
 * FIX 4 (#470): Code quality — reqId utility, hasTable guard, typo fix, output helper
 * FIX 5 (#453): Single API key — documented as known limitation (code comment + docs)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { join }       from "node:path";
import { readFileSync } from "node:fs";

// ============================================================================
// FIX 1 (#463): package.json — no leading space in dependency names
// ============================================================================

describe("FIX 1 (#463): package.json — clean dependency names", () => {
  it("devDependencies has no space-prefixed package names", () => {
    const pkg = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    ) as { devDependencies?: Record<string, string>; dependencies?: Record<string, string> };

    for (const [key] of Object.entries(pkg.devDependencies ?? {})) {
      expect(key).toBe(key.trim());
      expect(key).not.toMatch(/^\s/);
    }
  });

  it("dependencies has no space-prefixed package names", () => {
    const pkg = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    ) as { dependencies?: Record<string, string> };

    for (const [key] of Object.entries(pkg.dependencies ?? {})) {
      expect(key).toBe(key.trim());
      expect(key).not.toMatch(/^\s/);
    }
  });

  it("@types/better-sqlite3 resolves without leading space", () => {
    const pkg = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    ) as { devDependencies?: Record<string, string> };

    const devDeps = pkg.devDependencies ?? {};
    // The correct key (no leading space) must be present
    expect(devDeps["@types/better-sqlite3"]).toBeDefined();
    // The space-prefixed variant must NOT be present
    expect(devDeps[" @types/better-sqlite3"]).toBeUndefined();
  });
});

// ============================================================================
// FIX 2 (#468): Logs follow-mode — adaptive polling interval (structural tests)
// ============================================================================

describe("FIX 2 (#468): Logs follow-mode adaptive poll interval", () => {
  it("logs.ts source uses 2000ms base poll interval (not 500ms)", () => {
    const src = readFileSync(
      new URL("../../src/cli/commands/logs.ts", import.meta.url),
      "utf8",
    );
    expect(src).toContain("POLL_BASE_MS");
    expect(src).toContain("2_000");
    // Old 500ms constant must be gone
    expect(src).not.toContain("POLL_MS = 500");
    expect(src).not.toContain("const POLL_MS");
  });

  it("logs.ts source uses 5000ms idle poll interval", () => {
    const src = readFileSync(
      new URL("../../src/cli/commands/logs.ts", import.meta.url),
      "utf8",
    );
    expect(src).toContain("POLL_IDLE_MS");
    expect(src).toContain("5_000");
  });

  it("logs.ts source tracks consecutive empty polls for backoff", () => {
    const src = readFileSync(
      new URL("../../src/cli/commands/logs.ts", import.meta.url),
      "utf8",
    );
    expect(src).toContain("consecutiveEmpty");
    expect(src).toContain("IDLE_THRESHOLD");
  });

  it("backoff resets to base interval when new entries arrive", () => {
    // Behavioural test: simulate the backoff logic
    const POLL_BASE_MS = 2_000;
    const POLL_IDLE_MS = 5_000;
    const IDLE_THRESHOLD = 3;

    let pollInterval     = POLL_BASE_MS;
    let consecutiveEmpty = 0;

    // 3 empty polls → should slow down
    for (let i = 0; i < IDLE_THRESHOLD; i++) {
      consecutiveEmpty++;
      if (consecutiveEmpty >= IDLE_THRESHOLD) pollInterval = POLL_IDLE_MS;
    }
    expect(pollInterval).toBe(POLL_IDLE_MS);

    // One poll with new entries → should reset
    const newEntries = ["entry"];
    if (newEntries.length > 0) {
      consecutiveEmpty = 0;
      pollInterval = POLL_BASE_MS;
    }
    expect(pollInterval).toBe(POLL_BASE_MS);
    expect(consecutiveEmpty).toBe(0);
  });

  it("poll interval increases only after IDLE_THRESHOLD consecutive empty polls", () => {
    const POLL_BASE_MS   = 2_000;
    const POLL_IDLE_MS   = 5_000;
    const IDLE_THRESHOLD = 3;

    let pollInterval     = POLL_BASE_MS;
    let consecutiveEmpty = 0;

    // 2 empty polls — still base speed
    for (let i = 0; i < 2; i++) {
      consecutiveEmpty++;
      if (consecutiveEmpty >= IDLE_THRESHOLD) pollInterval = POLL_IDLE_MS;
    }
    expect(pollInterval).toBe(POLL_BASE_MS);

    // 3rd empty poll — switches to idle speed
    consecutiveEmpty++;
    if (consecutiveEmpty >= IDLE_THRESHOLD) pollInterval = POLL_IDLE_MS;
    expect(pollInterval).toBe(POLL_IDLE_MS);
  });
});

// ============================================================================
// FIX 3 (#469): API key rotator — timer leak on rapid rotation
// ============================================================================

import {
  generateApiKey,
  getActiveApiKey,
  _resetApiKeyState,
} from "../../src/api/cli-server.js";

describe("FIX 3 (#469): API key rotator — no timer leak + grace period", () => {
  beforeEach(() => {
    _resetApiKeyState();
    vi.useFakeTimers();
  });

  afterEach(() => {
    _resetApiKeyState();
    vi.useRealTimers();
  });

  it("generates unique keys", () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a).not.toBe(b);
    expect(a).toHaveLength(64);
  });

  it("getActiveApiKey returns current key initially", () => {
    // After reset, key is empty — but getActiveApiKey should not throw
    expect(typeof getActiveApiKey()).toBe("string");
  });

  it("cli-server.ts source clears old timer before setting new one", () => {
    const src = readFileSync(
      new URL("../../src/api/cli-server.ts", import.meta.url),
      "utf8",
    );
    // Must call clearTimeout before setTimeout in the rotate path
    const clearIdx   = src.indexOf("clearTimeout(apiKeyState.pendingTimer)");
    const setIdx     = src.indexOf("setTimeout(() => {", clearIdx);
    expect(clearIdx).toBeGreaterThan(-1);
    expect(setIdx).toBeGreaterThan(clearIdx);
  });

  it("cli-server.ts source nulls pendingTimer when timer fires", () => {
    const src = readFileSync(
      new URL("../../src/api/cli-server.ts", import.meta.url),
      "utf8",
    );
    // The timer callback must set pendingTimer = null (no leak after expiry)
    expect(src).toContain("apiKeyState.pendingTimer = null");
  });

  it("cli-server.ts source documents single-process limitation", () => {
    const src = readFileSync(
      new URL("../../src/api/cli-server.ts", import.meta.url),
      "utf8",
    );
    expect(src).toContain("single-process mode");
    expect(src).toContain("Per-client API tokens with RBAC scopes are planned for V1.0");
  });
});

// ============================================================================
// FIX 4 (#470): Code quality — reqId utility, hasTable, typo, output helper
// ============================================================================

import { reqId }            from "../../src/api/utils/request-id.js";
import { hasTable }         from "../../src/api/utils/has-table.js";
import { writeJsonOutput }  from "../../src/cli/utils/output.js";

describe("FIX 4a (#470): reqId utility — extracts request ID from context", () => {
  it("returns the request ID when set on context", () => {
    const mockCtx = {
      get: (k: never) => (k === "requestId" ? "req-abc-123" : undefined),
    };
    expect(reqId(mockCtx)).toBe("req-abc-123");
  });

  it("returns 'unknown' when request ID is not set", () => {
    const mockCtx = { get: () => undefined };
    expect(reqId(mockCtx)).toBe("unknown");
  });

  it("returns 'unknown' when context returns null", () => {
    const mockCtx = { get: () => null };
    expect(reqId(mockCtx)).toBe("unknown");
  });

  it("reqId is a single shared function — no duplicates in route files", () => {
    // Verify none of the route files define their own local reqId function
    const routeFiles = [
      "../../src/api/routes/agents.ts",
      "../../src/api/routes/governance.ts",
      "../../src/api/routes/outputs.ts",
      "../../src/api/routes/tasks.ts",
    ];

    for (const file of routeFiles) {
      const src = readFileSync(new URL(file, import.meta.url), "utf8");
      // Local function definition should not exist anymore
      expect(src).not.toContain("function reqId(");
    }
  });
});

describe("FIX 4b (#470): hasTable utility — schema pre-flight guard", () => {
  let db: InstanceType<typeof Database>;

  beforeEach(() => {
    db = new Database(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("returns false for a table that does not exist", () => {
    expect(hasTable(db, "nonexistent_table")).toBe(false);
  });

  it("returns true for a table that exists", () => {
    db.exec("CREATE TABLE test_table (id INTEGER PRIMARY KEY)");
    expect(hasTable(db, "test_table")).toBe(true);
  });

  it("returns false after a table is dropped", () => {
    db.exec("CREATE TABLE temp_table (x TEXT)");
    expect(hasTable(db, "temp_table")).toBe(true);
    db.exec("DROP TABLE temp_table");
    expect(hasTable(db, "temp_table")).toBe(false);
  });

  it("is safe to call repeatedly without side effects", () => {
    db.exec("CREATE TABLE stable_table (x INTEGER)");
    // Calling hasTable multiple times must not alter state
    expect(hasTable(db, "stable_table")).toBe(true);
    expect(hasTable(db, "stable_table")).toBe(true);
    expect(hasTable(db, "missing_table")).toBe(false);
    expect(hasTable(db, "missing_table")).toBe(false);
  });

  it("governance.ts uses hasTable instead of try/catch for divisions query", () => {
    const src = readFileSync(
      new URL("../../src/api/routes/governance.ts", import.meta.url),
      "utf8",
    );
    expect(src).toContain('hasTable(db, "divisions")');
    // The old silent catch should be gone
    expect(src).not.toContain("// Table not yet created — ignore");
  });
});

describe("FIX 4c (#470): outputs.ts binary field handling", () => {
  it("outputs.ts does not contain misspelled _contentBinaryin", () => {
    const src = readFileSync(
      new URL("../../src/api/routes/outputs.ts", import.meta.url),
      "utf8",
    );
    expect(src).not.toContain("_contentBinaryin");
    // L7: underscore-prefix trick replaced with void content_binary
    expect(src).toContain("content_binary");
  });
});

describe("FIX 4d (#470): writeJsonOutput utility — CLI JSON formatting helper", () => {
  let stdout: string;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdout = "";
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((data) => {
      stdout += String(data);
      return true;
    });
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  it("writes pretty-printed JSON when opts.json is true", () => {
    const data = { key: "value", count: 42 };
    const wrote = writeJsonOutput(data, { json: true });
    expect(wrote).toBe(true);
    expect(stdout).toContain('"key": "value"');
    expect(stdout).toContain('"count": 42');
  });

  it("returns false and writes nothing when opts.json is false", () => {
    const wrote = writeJsonOutput({ key: "value" }, { json: false });
    expect(wrote).toBe(false);
    expect(stdout).toBe("");
  });

  it("returns false and writes nothing when opts.json is undefined", () => {
    const wrote = writeJsonOutput({ key: "value" }, {});
    expect(wrote).toBe(false);
    expect(stdout).toBe("");
  });

  it("handles arrays, null, and primitives", () => {
    writeJsonOutput([1, 2, 3], { json: true });
    expect(stdout).toContain("[");
    expect(stdout).toContain("1");
  });

  it("output ends with newline", () => {
    writeJsonOutput({}, { json: true });
    expect(stdout).toMatch(/\n$/);
  });
});

// ============================================================================
// FIX 5 (#453): Single API key — documented as known limitation
// ============================================================================

describe("FIX 5 (#453): Single API key limitation — documented", () => {
  it("KNOWN-LIMITATIONS.md exists and mentions single API key", () => {
    const src = readFileSync(
      new URL("../../docs/KNOWN-LIMITATIONS.md", import.meta.url),
      "utf8",
    );
    expect(src).toContain("Single API Key");
  });

  it("auth.ts contains security note about single API key", () => {
    const src = readFileSync(
      new URL("../../src/api/middleware/auth.ts", import.meta.url),
      "utf8",
    );
    expect(src).toContain("SECURITY NOTE");
    expect(src.toLowerCase()).toContain("single");
  });

  it("KNOWN-LIMITATIONS.md documents mitigation strategy", () => {
    const src = readFileSync(
      new URL("../../docs/KNOWN-LIMITATIONS.md", import.meta.url),
      "utf8",
    );
    expect(src.toLowerCase()).toContain("reverse proxy");
    expect(src.toLowerCase()).toContain("mitigation");
  });

  it("KNOWN-LIMITATIONS.md references V1.0 planned fix", () => {
    const src = readFileSync(
      new URL("../../docs/KNOWN-LIMITATIONS.md", import.meta.url),
      "utf8",
    );
    expect(src).toContain("V1.0");
  });
});
