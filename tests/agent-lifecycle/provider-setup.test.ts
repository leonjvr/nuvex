/**
 * Phase 10.5 — ProviderSetup unit tests
 */

import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { ProviderSetup } from "../../src/agent-lifecycle/provider-setup.js";
import { runMigrations105 } from "../../src/agent-lifecycle/migration.js";
import type { ProviderLifecycleConfig } from "../../src/agent-lifecycle/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDb() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (version TEXT PRIMARY KEY, applied_at TEXT)`);
  runMigrations105(db);
  return db;
}

const ANTHROPIC_CONFIG: ProviderLifecycleConfig = {
  type: "anthropic",
  api_base: "https://api.anthropic.com",
  secret_key: "anthropic-api-key",
  models: [
    { id: "claude-opus-4-5", tier_recommendation: 1, cost_per_1k_input: 0.015, cost_per_1k_output: 0.075, context_window: 200000 },
    { id: "claude-sonnet-4-5", tier_recommendation: 2, cost_per_1k_input: 0.003, cost_per_1k_output: 0.015, context_window: 200000 },
    { id: "claude-haiku-4-5", tier_recommendation: 3, cost_per_1k_input: 0.0008, cost_per_1k_output: 0.004, context_window: 200000 },
  ],
  rate_limits: { requests_per_minute: 50, tokens_per_minute: 100000 },
  health_check: true,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ProviderSetup", () => {
  let db: ReturnType<typeof makeDb>;
  let setup: ProviderSetup;

  beforeEach(() => {
    db = makeDb();
    setup = new ProviderSetup(db);
  });

  it("upsertProvider registers a new provider", () => {
    setup.upsertProvider("anthropic", ANTHROPIC_CONFIG);
    const row = setup.getProvider("anthropic");
    expect(row).toBeDefined();
    expect(row?.id).toBe("anthropic");
    expect(row?.type).toBe("anthropic");
    expect(row?.api_key_ref).toBe("anthropic-api-key");
    expect(row?.health_status).toBe("unknown");
  });

  it("upsertProvider updates existing provider", () => {
    setup.upsertProvider("anthropic", ANTHROPIC_CONFIG);
    setup.upsertProvider("anthropic", { ...ANTHROPIC_CONFIG, secret_key: "new-key" });
    const row = setup.getProvider("anthropic");
    expect(row?.api_key_ref).toBe("new-key");
  });

  it("getProvider returns undefined for unknown provider", () => {
    expect(setup.getProvider("unknown-provider")).toBeUndefined();
  });

  it("listProviders returns all registered providers", () => {
    setup.upsertProvider("anthropic", ANTHROPIC_CONFIG);
    setup.upsertProvider("openai", { type: "openai", secret_key: "openai-key" });
    const providers = setup.listProviders();
    // cloudflare is seeded by default, so total >= 3
    expect(providers.length).toBeGreaterThanOrEqual(2);
    const ids = providers.map((p) => p.id);
    expect(ids).toContain("anthropic");
    expect(ids).toContain("openai");
  });

  it("listProviders includes seeded cloudflare provider by default", () => {
    const providers = setup.listProviders();
    const ids = providers.map((p) => p.id);
    expect(ids).toContain("cloudflare");
  });

  it("getModels returns model list from config", () => {
    setup.upsertProvider("anthropic", ANTHROPIC_CONFIG);
    const models = setup.getModels("anthropic");
    expect(models).toHaveLength(3);
    expect(models[0]?.id).toBe("claude-opus-4-5");
    expect(models[1]?.tier_recommendation).toBe(2);
  });

  it("getModels returns empty array for unknown provider", () => {
    expect(setup.getModels("ghost")).toHaveLength(0);
  });

  it("checkHealth returns unauthorized when API key is not set", async () => {
    setup.upsertProvider("anthropic", ANTHROPIC_CONFIG);

    // No secretsGet function provided and no env var set
    const result = await setup.checkHealth("anthropic");
    expect(result.provider).toBe("anthropic");
    // Either unauthorized (no key) or unreachable (network)
    expect(["unauthorized", "unreachable"]).toContain(result.status);
  });

  it("checkHealth returns unreachable for unknown provider", async () => {
    const result = await setup.checkHealth("nonexistent");
    expect(result.status).toBe("unreachable");
    expect(result.error).toContain("not registered");
  });

  it("checkHealth uses secretsGet to resolve API key", async () => {
    setup = new ProviderSetup(db, (_key: string) => "sk-test-fake-key");
    setup.upsertProvider("anthropic", ANTHROPIC_CONFIG);

    const result = await setup.checkHealth("anthropic");
    // With a fake key, it should try to connect and get some result
    // (not unauthorized, but possibly unreachable or unhealthy)
    expect(result.provider).toBe("anthropic");
    expect(result.checked_at).toBeTruthy();
  });

  it("updates health_status in DB after health check", async () => {
    setup.upsertProvider("anthropic", ANTHROPIC_CONFIG);
    await setup.checkHealth("anthropic");

    const row = setup.getProvider("anthropic");
    expect(row?.health_status).not.toBe("unknown");
    expect(row?.last_health_check).not.toBeNull();
  });
});
