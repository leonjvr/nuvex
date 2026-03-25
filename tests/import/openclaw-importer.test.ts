// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir }  from "node:os";
import { join }    from "node:path";
import { openDatabase } from "../../src/utils/db.js";
import { runMigrations105 } from "../../src/agent-lifecycle/migration.js";
import { AgentRegistry }    from "../../src/agent-lifecycle/agent-registry.js";
import { importOpenClaw, deriveAgentId } from "../../src/import/openclaw-importer.js";
import type { OpenClawImportOptions }    from "../../src/import/openclaw-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeWorkDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "sidjua-import-test-"));
  await mkdir(join(dir, ".system"), { recursive: true });

  // Initialise a minimal DB with Phase 10.5 tables so AgentRegistry works
  const db = openDatabase(join(dir, ".system", "sidjua.db"));
  db.pragma("foreign_keys = ON");
  runMigrations105(db);
  db.close();

  return dir;
}

async function writeConfig(dir: string, config: object): Promise<string> {
  const path = join(dir, "openclaw.json");
  await writeFile(path, JSON.stringify(config), "utf-8");
  return path;
}

function baseOptions(workDir: string, configPath: string): OpenClawImportOptions {
  return {
    configPath,
    workDir,
    dryRun:    false,
    noSecrets: true,   // skip fs writes for credentials in unit tests
    budgetUsd: 50.00,
    tier:      3,
    division:  "general",
  };
}

// ---------------------------------------------------------------------------
// deriveAgentId
// ---------------------------------------------------------------------------

describe("deriveAgentId", () => {
  it("lowercases and kebab-cases the name", () => {
    expect(deriveAgentId("Clawd V2")).toBe("clawd-v2");
  });

  it("removes leading/trailing hyphens", () => {
    expect(deriveAgentId("  My Bot  ")).toBe("my-bot");
  });

  it("collapses multiple special chars to single hyphen", () => {
    expect(deriveAgentId("hello!!! world")).toBe("hello-world");
  });

  it("returns fallback for empty string", () => {
    expect(deriveAgentId("")).toBe("imported-agent");
  });

  it("truncates long names to 48 chars", () => {
    const long = "a".repeat(60);
    expect(deriveAgentId(long).length).toBeLessThanOrEqual(48);
  });
});

// ---------------------------------------------------------------------------
// importOpenClaw — dry run
// ---------------------------------------------------------------------------

describe("importOpenClaw dry run", () => {
  let workDir:    string;
  let configPath: string;

  beforeEach(async () => {
    workDir    = await makeWorkDir();
    configPath = await writeConfig(workDir, {
      identity: { name: "Clawd" },
      agent:    { model: { primary: "anthropic/claude-sonnet-4-5" } },
    });
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("returns correct agent metadata in dry-run mode", async () => {
    const opts = { ...baseOptions(workDir, configPath), dryRun: true };
    const result = await importOpenClaw(opts);
    expect(result.agent.id).toBe("clawd");
    expect(result.agent.name).toBe("Clawd");
    expect(result.agent.provider).toBe("anthropic");
    expect(result.agent.model).toBe("claude-sonnet-4-5");
    expect(result.agent.tier).toBe(3);
    expect(result.agent.division).toBe("general");
  });

  it("applies governance defaults in dry-run mode", async () => {
    const opts = { ...baseOptions(workDir, configPath), dryRun: true };
    const result = await importOpenClaw(opts);
    expect(result.governance.preActionEnforcement).toBe(true);
    expect(result.governance.auditTrail).toBe(true);
    expect(result.governance.budgetPerTask).toBe(1.00);
    expect(result.governance.budgetMonthly).toBe(50.00);
  });

  it("creates NO files in dry-run mode", async () => {
    const opts = { ...baseOptions(workDir, configPath), dryRun: true };
    await importOpenClaw(opts);
    const { existsSync } = await import("node:fs");
    expect(existsSync(join(workDir, ".system", "imported-agents"))).toBe(false);
  });

  it("does NOT register agent in DB in dry-run mode", async () => {
    const opts = { ...baseOptions(workDir, configPath), dryRun: true };
    await importOpenClaw(opts);

    const db = openDatabase(join(workDir, ".system", "sidjua.db"));
    runMigrations105(db);
    const registry = new AgentRegistry(db);
    expect(registry.getById("clawd")).toBeUndefined();
    db.close();
  });
});

// ---------------------------------------------------------------------------
// importOpenClaw — real import
// ---------------------------------------------------------------------------

describe("importOpenClaw real import", () => {
  let workDir:    string;
  let configPath: string;

  beforeEach(async () => {
    workDir    = await makeWorkDir();
    configPath = await writeConfig(workDir, {
      identity: { name: "TestBot" },
      agent:    { model: { primary: "openai/gpt-4.1" } },
    });
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("creates agent in DB", async () => {
    const opts = baseOptions(workDir, configPath);
    const result = await importOpenClaw(opts);

    const db = openDatabase(join(workDir, ".system", "sidjua.db"));
    runMigrations105(db);
    const registry = new AgentRegistry(db);
    const agent = registry.getById(result.agent.id);
    expect(agent).toBeDefined();
    expect(agent?.name).toBe("TestBot");
    expect(agent?.provider).toBe("openai");
    db.close();
  });

  it("writes skill file to disk", async () => {
    const opts = baseOptions(workDir, configPath);
    const result = await importOpenClaw(opts);

    const { existsSync } = await import("node:fs");
    const skillPath = join(workDir, ".system", "imported-agents", result.agent.id, "main.skill.md");
    expect(existsSync(skillPath)).toBe(true);
    const content = await readFile(skillPath, "utf-8");
    expect(content).toContain("TestBot");
  });

  it("applies custom --budget", async () => {
    const opts = { ...baseOptions(workDir, configPath), budgetUsd: 100.00 };
    const result = await importOpenClaw(opts);
    expect(result.governance.budgetMonthly).toBe(100.00);
  });

  it("applies custom --tier", async () => {
    const opts = { ...baseOptions(workDir, configPath), tier: 2 };
    const result = await importOpenClaw(opts);
    expect(result.agent.tier).toBe(2);
  });

  it("applies custom --division", async () => {
    const opts = { ...baseOptions(workDir, configPath), division: "engineering" };
    const result = await importOpenClaw(opts);
    expect(result.agent.division).toBe("engineering");
  });

  it("applies --name override", async () => {
    const opts = { ...baseOptions(workDir, configPath), nameOverride: "my-custom-bot" };
    const result = await importOpenClaw(opts);
    expect(result.agent.name).toBe("my-custom-bot");
    expect(result.agent.id).toBe("my-custom-bot");
  });

  it("applies --model override", async () => {
    const opts = { ...baseOptions(workDir, configPath), modelOverride: "anthropic/claude-opus-4-5" };
    const result = await importOpenClaw(opts);
    expect(result.agent.provider).toBe("anthropic");
    expect(result.agent.model).toBe("claude-opus-4-5");
  });
});

// ---------------------------------------------------------------------------
// Agent name collision
// ---------------------------------------------------------------------------

describe("importOpenClaw — name collision", () => {
  let workDir:    string;
  let configPath: string;

  beforeEach(async () => {
    workDir    = await makeWorkDir();
    configPath = await writeConfig(workDir, {
      identity: { name: "CollidingBot" },
      agent:    { model: { primary: "anthropic/claude-sonnet-4-5" } },
    });
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("throws when agent already exists", async () => {
    const opts = baseOptions(workDir, configPath);
    await importOpenClaw(opts); // first import

    await expect(importOpenClaw(opts)).rejects.toThrow("already exists");
  });
});

// ---------------------------------------------------------------------------
// Skill classification from config
// ---------------------------------------------------------------------------

describe("importOpenClaw — skill classification", () => {
  let workDir:    string;
  let configPath: string;

  beforeEach(async () => {
    workDir    = await makeWorkDir();
    configPath = await writeConfig(workDir, {
      identity: { name: "SkillBot" },
      agent:    { model: { primary: "anthropic/claude-sonnet-4-5" } },
      skills:   {
        entries: {
          discord:  { enabled: true },
          weather:  { enabled: true },
          notion:   { enabled: false },
        },
      },
    });
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("identifies discord + notion as module-required", async () => {
    const opts = { ...baseOptions(workDir, configPath), dryRun: true };
    const result = await importOpenClaw(opts);
    const modules = result.skills.moduleRequired.map((m) => m.module);
    expect(modules).toContain("discord");
    expect(modules).toContain("notion");
  });

  it("classifies weather as skipped (config-only, no SKILL.md)", async () => {
    const opts = { ...baseOptions(workDir, configPath), dryRun: true };
    const result = await importOpenClaw(opts);
    // weather in config but no SKILL.md → skipped
    expect(result.skills.skipped).toContain("weather");
  });
});

// ---------------------------------------------------------------------------
// Error cases
// ---------------------------------------------------------------------------

describe("importOpenClaw — error cases", () => {
  it("throws for missing config file", async () => {
    const workDir = await mkdtemp(join(tmpdir(), "sidjua-err-test-"));
    try {
      const opts = { ...baseOptions(workDir, "/nonexistent/path/openclaw.json"), dryRun: true };
      await expect(importOpenClaw(opts)).rejects.toThrow("OpenClaw config not found");
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });

  it("throws for config without model", async () => {
    const workDir    = await mkdtemp(join(tmpdir(), "sidjua-err-test-"));
    const configPath = join(workDir, "openclaw.json");
    await writeFile(configPath, JSON.stringify({ identity: { name: "NoModel" } }), "utf-8");
    try {
      const opts = baseOptions(workDir, configPath);
      await expect(importOpenClaw(opts)).rejects.toThrow("No model configured");
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });
});
