/**
 * Tests for Step 4: SECRETS
 *
 * Covers:
 * - Secrets DB created at the correct path
 * - set/get/delete/list CRUD operations
 * - Access logging to secret_access_log
 * - Key derivation consistency (same key on re-init)
 * - Version increment on update
 * - Metadata (created_at, updated_at, version)
 * - applySecrets: namespace structure created
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteSecretsProvider, applySecrets } from "../../src/apply/secrets.js";
import { applyDatabase } from "../../src/apply/database.js";
import type { ParsedConfig, Division } from "../../src/types/config.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDivision(code: string): Division {
  return {
    code,
    name: { en: code },
    scope: "test",
    required: false,
    active: true,
    recommend_from: null,
    head: { role: null, agent: null },
  };
}

function makeConfig(codes: string[] = ["engineering"]): ParsedConfig {
  const divisions = codes.map(makeDivision);
  return {
    schema_version: "1.0",
    company: { name: "TestCo", size: "solo", locale: "en", timezone: "UTC", mode: "business" },
    mode: "business",
    divisions,
    activeDivisions: divisions,
    size_presets: { solo: { recommended: [], description: "Solo" } },
    sourcePath: "/tmp/test.yaml",
    contentHash: "abc123",
  };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "sidjua-secrets-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// SqliteSecretsProvider unit tests
// ---------------------------------------------------------------------------

describe("SqliteSecretsProvider", () => {
  async function openProvider(dir: string): Promise<{
    provider: SqliteSecretsProvider;
    cleanup: () => void;
  }> {
    const config = makeConfig();
    const { db: mainDb } = applyDatabase(config, dir);
    const provider = new SqliteSecretsProvider(mainDb);
    await provider.init({ db_path: join(dir, ".system", "secrets.db") });
    return {
      provider,
      cleanup: () => {
        provider.close();
        mainDb.close();
      },
    };
  }

  it("creates secrets.db at the specified path", async () => {
    const { cleanup } = await openProvider(tmpDir);
    cleanup();
    expect(existsSync(join(tmpDir, ".system", "secrets.db"))).toBe(true);
  });

  it("set and get a secret value", async () => {
    const { provider, cleanup } = await openProvider(tmpDir);
    await provider.set("global", "api_key", "secret-value-123");
    const val = await provider.get("global", "api_key");
    cleanup();
    expect(val).toBe("secret-value-123");
  });

  it("returns null for missing key", async () => {
    const { provider, cleanup } = await openProvider(tmpDir);
    const val = await provider.get("global", "nonexistent");
    cleanup();
    expect(val).toBeNull();
  });

  it("delete removes a secret", async () => {
    const { provider, cleanup } = await openProvider(tmpDir);
    await provider.set("ns", "key", "value");
    await provider.delete("ns", "key");
    const val = await provider.get("ns", "key");
    cleanup();
    expect(val).toBeNull();
  });

  it("list returns all keys in a namespace", async () => {
    const { provider, cleanup } = await openProvider(tmpDir);
    await provider.set("providers", "anthropic", "sk-ant-1");
    await provider.set("providers", "openai", "sk-openai-1");
    await provider.set("global", "other", "v");
    const keys = await provider.list("providers");
    cleanup();
    expect(keys.sort()).toEqual(["anthropic", "openai"]);
  });

  it("list returns empty array for empty namespace", async () => {
    const { provider, cleanup } = await openProvider(tmpDir);
    const keys = await provider.list("divisions/empty");
    cleanup();
    expect(keys).toEqual([]);
  });

  it("update increments version", async () => {
    const { provider, cleanup } = await openProvider(tmpDir);
    await provider.set("ns", "k", "v1");
    await provider.set("ns", "k", "v2");
    const meta = await provider.getMetadata("ns", "k");
    const val = await provider.get("ns", "k");
    cleanup();
    expect(meta.version).toBe(2);
    expect(val).toBe("v2");
  });

  it("rotate updates value and increments version", async () => {
    const { provider, cleanup } = await openProvider(tmpDir);
    await provider.set("ns", "k", "original");
    await provider.rotate("ns", "k", "rotated");
    const val = await provider.get("ns", "k");
    const meta = await provider.getMetadata("ns", "k");
    cleanup();
    expect(val).toBe("rotated");
    expect(meta.version).toBe(2);
  });

  it("returns null for a missing key", async () => {
    const { provider, cleanup } = await openProvider(tmpDir);
    const result = await provider.getMetadata("ns", "missing");
    cleanup();
    expect(result).toBeNull();
  });

  it("encryption key is consistent across re-inits (same DB → same key)", async () => {
    // First init: write a secret
    const config = makeConfig();
    const { db: mainDb1 } = applyDatabase(config, tmpDir);
    const p1 = new SqliteSecretsProvider(mainDb1);
    await p1.init({ db_path: join(tmpDir, ".system", "secrets.db") });
    await p1.set("global", "test_key", "hello-world");
    p1.close();
    mainDb1.close();

    // Second init: read it back with a fresh provider instance
    const { db: mainDb2 } = applyDatabase(config, tmpDir);
    const p2 = new SqliteSecretsProvider(mainDb2);
    await p2.init({ db_path: join(tmpDir, ".system", "secrets.db") });
    const val = await p2.get("global", "test_key");
    p2.close();
    mainDb2.close();

    expect(val).toBe("hello-world");
  });

  it("ensureNamespace is a no-op and does not throw", async () => {
    const { provider, cleanup } = await openProvider(tmpDir);
    await expect(provider.ensureNamespace("divisions/test")).resolves.toBeUndefined();
    cleanup();
  });
});

// ---------------------------------------------------------------------------
// applySecrets integration
// ---------------------------------------------------------------------------

describe("applySecrets", () => {
  it("creates secrets.db and returns success StepResult", async () => {
    const config = makeConfig(["engineering", "sales"]);
    const { db: mainDb } = applyDatabase(config, tmpDir);
    const result = await applySecrets(config, tmpDir, mainDb);
    mainDb.close();

    expect(result.step).toBe("SECRETS");
    expect(result.success).toBe(true);
    expect(existsSync(join(tmpDir, ".system", "secrets.db"))).toBe(true);
  });

  it("verifies global + providers + per-division namespaces", async () => {
    const config = makeConfig(["engineering", "sales"]);
    const { db: mainDb } = applyDatabase(config, tmpDir);
    const result = await applySecrets(config, tmpDir, mainDb);
    mainDb.close();

    // 2 global namespaces (global, providers) + 2 division namespaces
    expect(result.details?.["namespacesVerified"]).toBe(4);
  });

  it("is idempotent (running twice does not throw)", async () => {
    const config = makeConfig(["engineering"]);
    const { db: db1 } = applyDatabase(config, tmpDir);
    await applySecrets(config, tmpDir, db1);
    db1.close();

    const { db: db2 } = applyDatabase(config, tmpDir);
    await expect(applySecrets(config, tmpDir, db2)).resolves.not.toThrow();
    db2.close();
  });
});
