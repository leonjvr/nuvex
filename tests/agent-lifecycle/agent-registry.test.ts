/**
 * Phase 10.5 — AgentRegistry unit tests
 */

import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { AgentRegistry } from "../../src/agent-lifecycle/agent-registry.js";
import { runMigrations105 } from "../../src/agent-lifecycle/migration.js";
import type { AgentLifecycleDefinition } from "../../src/agent-lifecycle/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = OFF");  // Skip FK for unit tests
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  runMigrations105(db);
  return db;
}

const DEF: AgentLifecycleDefinition = {
  id: "video-editor",
  name: "Video Editor",
  tier: 3,
  division: "content",
  provider: "anthropic",
  model: "claude-sonnet-4-5",
  skill: "agents/skills/video-editor.md",
  capabilities: ["video-editing", "color-grading"],
  budget: { per_task_usd: 5.00, per_hour_usd: 10.00, per_month_usd: 200.00 },
  created_by: "goetz",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AgentRegistry", () => {
  let db: ReturnType<typeof makeDb>;
  let registry: AgentRegistry;

  beforeEach(() => {
    db = makeDb();
    registry = new AgentRegistry(db);
  });

  it("creates an agent and retrieves it by ID", () => {
    const row = registry.create(DEF);
    expect(row.id).toBe("video-editor");
    expect(row.name).toBe("Video Editor");
    expect(row.tier).toBe(3);
    expect(row.status).toBe("stopped");
    expect(row.created_by).toBe("goetz");
  });

  it("stores full YAML in config_yaml", () => {
    const row = registry.create(DEF);
    expect(row.config_yaml).toContain("video-editor");
    expect(row.config_yaml).toContain("claude-sonnet-4-5");
  });

  it("computes config_hash", () => {
    const row = registry.create(DEF);
    expect(row.config_hash).toHaveLength(16);
    expect(row.config_hash).toMatch(/^[0-9a-f]+$/);
  });

  it("getById returns undefined for nonexistent ID", () => {
    const row = registry.getById("nonexistent");
    expect(row).toBeUndefined();
  });

  it("list returns all agents", () => {
    registry.create(DEF);
    registry.create({ ...DEF, id: "code-worker", division: "engineering" });
    const rows = registry.list();
    expect(rows).toHaveLength(2);
  });

  it("list filters by division", () => {
    registry.create(DEF);
    registry.create({ ...DEF, id: "code-worker", division: "engineering" });
    const rows = registry.list({ division: "content" });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("video-editor");
  });

  it("list filters by tier", () => {
    registry.create(DEF);
    registry.create({ ...DEF, id: "ceo", tier: 1 });
    const rows = registry.list({ tier: 3 });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("video-editor");
  });

  it("list filters by status", () => {
    registry.create(DEF);
    registry.create({ ...DEF, id: "active-agent" });
    registry.setStatus("active-agent", "active");
    const rows = registry.list({ status: "active" });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("active-agent");
  });

  it("update changes model and recomputes hash", () => {
    registry.create(DEF);
    const original = registry.getById("video-editor")!;
    const updated = registry.update("video-editor", { model: "claude-opus-4-5" });
    expect(updated.model).toBe("claude-opus-4-5");
    expect(updated.config_hash).not.toBe(original.config_hash);
  });

  it("update throws for nonexistent agent", () => {
    expect(() => registry.update("ghost", { model: "x" })).toThrow("not found");
  });

  it("setStatus updates status field", () => {
    registry.create(DEF);
    registry.setStatus("video-editor", "active");
    const row = registry.getById("video-editor")!;
    expect(row.status).toBe("active");
  });

  it("delete removes agent", () => {
    registry.create(DEF);
    registry.delete("video-editor");
    expect(registry.getById("video-editor")).toBeUndefined();
  });

  it("delete with keepHistory sets status to deleted", () => {
    registry.create(DEF);
    registry.delete("video-editor", true);
    const row = registry.getById("video-editor");
    expect(row?.status).toBe("deleted");
  });

  it("toRuntimeDefinition maps to Phase 8 AgentDefinition", () => {
    const runtime = registry.toRuntimeDefinition(DEF);
    expect(runtime.id).toBe("video-editor");
    expect(runtime.tier).toBe(3);
    expect(runtime.skill_file).toBe("agents/skills/video-editor.md");
    expect(runtime.token_budget_per_task).toBeGreaterThan(0);
    expect(runtime.cost_limit_per_hour).toBe(10.00);
  });

  it("parseConfigYaml round-trips the definition", () => {
    const row = registry.create(DEF);
    const parsed = registry.parseConfigYaml(row.config_yaml);
    expect(parsed.id).toBe("video-editor");
    expect(parsed.model).toBe("claude-sonnet-4-5");
    expect(parsed.capabilities).toContain("video-editing");
  });
});
