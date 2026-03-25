// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * BUG-2 + BUG-3 regression tests: agent create --quick flag
 *
 * BUG-2: --quick flag must be fully non-interactive when all required flags
 *        are provided — zero prompts.
 * BUG-3: When skill file path is empty/undefined, creation must succeed
 *        without "Skill file not found" error.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { AgentRegistry }       from "../../src/agent-lifecycle/agent-registry.js";
import { AgentValidator }      from "../../src/agent-lifecycle/agent-validator.js";
import { AgentTemplateLoader } from "../../src/agent-lifecycle/agent-template.js";
import { runMigrations105 }    from "../../src/agent-lifecycle/migration.js";
import { tmpdir }              from "node:os";
import { mkdtemp, rm }         from "node:fs/promises";
import { join }                from "node:path";

// ---------------------------------------------------------------------------
// Minimal in-memory DB setup
// ---------------------------------------------------------------------------

function makeDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = OFF");
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (version TEXT PRIMARY KEY, applied_at TEXT);
    CREATE TABLE IF NOT EXISTS divisions (code TEXT PRIMARY KEY, name_en TEXT, active INTEGER DEFAULT 1, scope TEXT);
    CREATE TABLE IF NOT EXISTS cost_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT DEFAULT (datetime('now')),
      division_code TEXT, agent_id TEXT, provider TEXT, model TEXT,
      input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0,
      cost_usd REAL DEFAULT 0, task_id TEXT
    );
    CREATE TABLE IF NOT EXISTS cost_budgets (
      division_code TEXT PRIMARY KEY, monthly_limit_usd REAL, daily_limit_usd REAL,
      alert_threshold_percent REAL DEFAULT 80.0
    );
    CREATE TABLE IF NOT EXISTS provider_configs (
      id TEXT PRIMARY KEY, type TEXT, config_yaml TEXT, api_key_ref TEXT, created_at TEXT
    );
  `);
  runMigrations105(db);
  db.prepare("INSERT OR IGNORE INTO divisions (code, name_en) VALUES (?, ?)").run("default", "Default");
  db.prepare("INSERT OR IGNORE INTO divisions (code, name_en) VALUES (?, ?)").run("engineering", "Engineering");
  db.prepare("INSERT OR IGNORE INTO provider_configs (id, type, config_yaml, api_key_ref, created_at) VALUES (?, ?, ?, ?, datetime('now'))").run(
    "cloudflare", "cloudflare", "type: cloudflare\n", "cf-key",
  );
  return db;
}

// ---------------------------------------------------------------------------
// BUG-2: --quick mode builds definition from flags without interactive prompts
// ---------------------------------------------------------------------------

describe("agent create --quick (BUG-2)", () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "sidjua-quick-test-"));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("templateLoader.expand('custom', overrides) succeeds with id+name+provider+model+division", async () => {
    const loader = new AgentTemplateLoader(join(workDir, "agents", "templates"));
    const def = await loader.expand("custom", {
      id:       "quick-agent",
      name:     "Quick Agent",
      provider: "cloudflare",
      model:    "@cf/meta/llama-4-scout-17b-16e-instruct",
      division: "default",
      tier:     3,
      skill:    "",           // BUG-3: explicit empty string skips default path generation
    });
    expect(def.id).toBe("quick-agent");
    expect(def.provider).toBe("cloudflare");
    expect(def.model).toBe("@cf/meta/llama-4-scout-17b-16e-instruct");
    expect(def.division).toBe("default");
    // skill is preserved as "" — not replaced with agents/skills/quick-agent.md
    expect(def.skill).toBe("");
  });

  it("AgentValidator skips skill check when skill is empty string (BUG-3)", async () => {
    const db        = makeDb();
    const validator = new AgentValidator(db);
    const loader    = new AgentTemplateLoader(join(workDir, "agents", "templates"));

    const def = await loader.expand("custom", {
      id:       "quick-no-skill",
      name:     "Quick No Skill",
      provider: "cloudflare",
      model:    "@cf/meta/llama-4-scout-17b-16e-instruct",
      division: "default",
      tier:     3,
      skill:    "",
    });

    const result = await validator.validate(def, { workDir });
    // Skill validation is skipped when skill is empty — no "Skill file not found" error
    const skillErrors = result.errors.filter((e) => e.toLowerCase().includes("skill"));
    expect(skillErrors).toHaveLength(0);

    db.close();
  });

  it("AgentRegistry.create succeeds when definition has empty skill", async () => {
    const db       = makeDb();
    const registry = new AgentRegistry(db);
    const loader   = new AgentTemplateLoader(join(workDir, "agents", "templates"));

    const def = await loader.expand("custom", {
      id:       "quick-reg-test",
      name:     "Quick Registry Test",
      provider: "cloudflare",
      model:    "@cf/meta/llama-4-scout-17b-16e-instruct",
      division: "default",
      tier:     3,
      skill:    "",
    });

    const row = registry.create(def);
    expect(row.id).toBe("quick-reg-test");
    expect(row.status).toBe("stopped");

    db.close();
  });
});

// ---------------------------------------------------------------------------
// BUG-3: expand() preserves explicit "" skill and does not generate default path
// ---------------------------------------------------------------------------

describe("AgentTemplateLoader.expand — explicit empty skill (BUG-3)", () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "sidjua-skill-test-"));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("skill stays '' when overrides.skill is explicitly ''", async () => {
    const loader = new AgentTemplateLoader(join(workDir, "agents", "templates"));
    const def = await loader.expand("custom", {
      id: "test-empty-skill", name: "Test", provider: "cloudflare",
      model: "@cf/meta/llama-4-scout-17b-16e-instruct", division: "default", tier: 3,
      skill: "",
    });
    expect(def.skill).toBe("");
  });

  it("skill gets default path when overrides.skill is undefined", async () => {
    const loader = new AgentTemplateLoader(join(workDir, "agents", "templates"));
    const def = await loader.expand("custom", {
      id: "test-default-skill", name: "Test", provider: "cloudflare",
      model: "@cf/meta/llama-4-scout-17b-16e-instruct", division: "default", tier: 3,
      // skill: undefined — not provided
    });
    // Default path is generated: agents/skills/{id}.md
    expect(def.skill).toBe("agents/skills/test-default-skill.md");
  });

  it("validator does not error on empty-string skill when file does not exist", async () => {
    const db        = makeDb();
    const validator = new AgentValidator(db);
    const loader    = new AgentTemplateLoader(join(workDir, "agents", "templates"));

    const def = await loader.expand("custom", {
      id: "no-skill-agent", name: "No Skill", provider: "cloudflare",
      model: "@cf/meta/llama-4-scout-17b-16e-instruct", division: "default", tier: 3,
      skill: "",
    });

    const result = await validator.validate(def, { workDir });
    const skillErrors = result.errors.filter((e) => e.toLowerCase().includes("skill"));
    expect(skillErrors).toHaveLength(0);

    db.close();
  });
});
