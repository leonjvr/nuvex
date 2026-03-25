// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Tests for src/cli/commands/secret.ts
 *
 * Strategy: tests exercise the SqliteSecretsProvider directly (bypassing CLI
 * argument parsing) to validate the underlying logic used by each subcommand.
 * One structural test verifies Commander registration.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join }   from "node:path";
import { openDatabase }         from "../../src/utils/db.js";
import { runMigrations105 }     from "../../src/agent-lifecycle/migration.js";
import { SqliteSecretsProvider } from "../../src/apply/secrets.js";
import { registerSecretCommands } from "../../src/cli/commands/secret.js";
import { Command } from "commander";

// ---------------------------------------------------------------------------
// Workspace setup (shared for all tests — Argon2id only runs once)
// ---------------------------------------------------------------------------

let workDir:  string;
let mainDb:   ReturnType<typeof openDatabase>;
let provider: SqliteSecretsProvider;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "sidjua-secret-cli-test-"));
  await mkdir(join(workDir, ".system"), { recursive: true });

  mainDb = openDatabase(join(workDir, ".system", "sidjua.db"));
  mainDb.pragma("foreign_keys = ON");
  runMigrations105(mainDb);
  // _system_keys is created by applyDatabase (Phase 3), not runMigrations105.
  // Create it directly for the test environment.
  mainDb.exec(`
    CREATE TABLE IF NOT EXISTS _system_keys (
      key_name   TEXT PRIMARY KEY,
      key_value  TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  provider = new SqliteSecretsProvider(mainDb);
  await provider.init({ db_path: join(workDir, ".system", "secrets.db") });
});

afterAll(async () => {
  provider.close();
  mainDb.close();
  await rm(workDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Structural: verify Commander registration
// ---------------------------------------------------------------------------

describe("registerSecretCommands — structure", () => {
  it("registers a 'secret' command on the program", () => {
    const prog = new Command();
    registerSecretCommands(prog);
    const cmd = prog.commands.find((c) => c.name() === "secret");
    expect(cmd).toBeDefined();
  });

  it("registers all 7 subcommands under 'secret'", () => {
    const prog = new Command();
    registerSecretCommands(prog);
    const secretCmd = prog.commands.find((c) => c.name() === "secret")!;
    const names = secretCmd.commands.map((c) => c.name());
    expect(names).toContain("set");
    expect(names).toContain("get");
    expect(names).toContain("list");
    expect(names).toContain("delete");
    expect(names).toContain("info");
    expect(names).toContain("rotate");
    expect(names).toContain("namespaces");
  });
});

// ---------------------------------------------------------------------------
// set / get round-trip
// ---------------------------------------------------------------------------

describe("secret set + get", () => {
  it("can set and retrieve a secret", async () => {
    await provider.set("global", "TEST_KEY", "my-secret-value");
    const value = await provider.get("global", "TEST_KEY");
    expect(value).toBe("my-secret-value");
  });

  it("returns null for a non-existent key", async () => {
    const value = await provider.get("global", "NONEXISTENT");
    expect(value).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

describe("secret list", () => {
  it("lists keys in a namespace", async () => {
    await provider.set("divisions/eng", "KEY_A", "val-a");
    await provider.set("divisions/eng", "KEY_B", "val-b");
    const keys = await provider.list("divisions/eng");
    expect(keys).toContain("KEY_A");
    expect(keys).toContain("KEY_B");
  });

  it("returns empty array for namespace with no keys", async () => {
    const keys = await provider.list("divisions/empty");
    expect(keys).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------

describe("secret delete", () => {
  it("deletes a key and it becomes null on get", async () => {
    await provider.set("global", "TO_DELETE", "gone");
    await provider.delete("global", "TO_DELETE");
    const value = await provider.get("global", "TO_DELETE");
    expect(value).toBeNull();
  });

  // BUG-5 regression: delete on a non-existent key must return null from get (provider
  // layer is a no-op DELETE; the CLI layer is responsible for the existence check).
  it("get returns null for a key that was never set (BUG-5 prerequisite)", async () => {
    const value = await provider.get("global", "NONEXISTENT_DELETE_TARGET");
    expect(value).toBeNull();
  });

  it("delete on a non-existent key silently no-ops at provider level (SQL DELETE 0 rows)", async () => {
    // provider.delete itself is a no-op DELETE — the CLI wrapper is what checks existence.
    // This test verifies the provider does not throw for a missing key.
    await expect(provider.delete("global", "NEVER_EXISTS")).resolves.toBeUndefined();
    const value = await provider.get("global", "NEVER_EXISTS");
    expect(value).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// info / getMetadata
// ---------------------------------------------------------------------------

describe("secret info", () => {
  it("returns metadata for an existing key", async () => {
    await provider.set("global", "META_KEY", "value");
    const meta = await provider.getMetadata("global", "META_KEY");
    expect(meta.version).toBeGreaterThanOrEqual(1);
    expect(meta.created_at).toBeTruthy();
    expect(meta.updated_at).toBeTruthy();
    expect(typeof meta.rotation_age_days).toBe("number");
  });

  it("returns null for a non-existent key", async () => {
    const result = await provider.getMetadata("global", "NO_SUCH_KEY");
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// rotate
// ---------------------------------------------------------------------------

describe("secret rotate", () => {
  it("rotates a secret to a new value and increments version", async () => {
    await provider.set("global", "ROTATE_KEY", "old-value");
    const before = await provider.getMetadata("global", "ROTATE_KEY");

    await provider.rotate("global", "ROTATE_KEY", "new-value");

    const value  = await provider.get("global", "ROTATE_KEY");
    const after  = await provider.getMetadata("global", "ROTATE_KEY");

    expect(value).toBe("new-value");
    expect(after.version).toBe(before.version + 1);
  });
});

// ---------------------------------------------------------------------------
// namespaces (direct DB query simulation)
// ---------------------------------------------------------------------------

describe("secret namespaces", () => {
  it("distinct namespaces are queryable from secrets.db", () => {
    const secretsDb = openDatabase(join(workDir, ".system", "secrets.db"));
    try {
      const rows = secretsDb
        .prepare<[], { namespace: string }>(
          "SELECT DISTINCT namespace FROM secrets ORDER BY namespace",
        )
        .all() as { namespace: string }[];
      const namespaces = rows.map((r) => r.namespace);
      // We've written to "global" and "divisions/eng" above
      expect(namespaces).toContain("global");
    } finally {
      secretsDb.close();
    }
  });
});
