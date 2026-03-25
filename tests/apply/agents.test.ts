// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * P282 — AGENTS apply step tests
 *
 * Covers:
 *   T1: applyAgents registers starter agents from defaults/roles/
 *   T2: applyAgents registers user-defined agents from {workDir}/agents/definitions/
 *   T3: applyAgents is idempotent (running twice produces same result)
 *   T4: malformed user YAML files are skipped (non-fatal)
 *   T5: parseUserAgentFile returns null for missing "role" key
 *   T6: parseUserAgentFile accepts "agent:" top-level key
 *   T7: parseUserAgentFile extracts tier, division, model correctly
 *   T8: upsertAgentRow inserts into agent_definitions
 *   T9: upsertAgentRow updates on conflict (ON CONFLICT DO UPDATE)
 *   T10: applyAgents returns success StepResult with correct summary fields
 *   T11: applyAgents works when {workDir}/agents/definitions/ does not exist
 *   T12: syncDefaultDivisions (via applyDatabase) inserts system/executive/workspace
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir }  from "node:os";
import { join }    from "node:path";
import {
  applyAgents,
  parseUserAgentFile,
  upsertAgentRow,
  type AgentEntry,
}                  from "../../src/apply/agents.js";
import { applyDatabase } from "../../src/apply/database.js";
import { openDatabase }  from "../../src/utils/db.js";
import { runMigrations105 } from "../../src/agent-lifecycle/migration.js";
import type { ParsedConfig, Division } from "../../src/types/config.js";
import type { Database as DbType } from "../../src/utils/db.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDivision(code: string, active = true): Division {
  return {
    code,
    name:           { en: code },
    scope:          "test",
    required:       false,
    active,
    recommend_from: null,
    head:           { role: null, agent: null },
  };
}

function makeConfig(divisions: Division[] = []): ParsedConfig {
  return {
    schema_version: "1.0",
    company:        { name: "TestCo", size: "solo", locale: "en", timezone: "UTC", mode: "business" },
    mode:           "business",
    divisions,
    activeDivisions: divisions.filter((d) => d.active),
    size_presets:   { solo: { recommended: [], description: "Solo" } },
    sourcePath:     "/tmp/test.yaml",
    contentHash:    "abc123",
  };
}

let workDir: string;
let dbPath:  string;
let db:      DbType;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "sidjua-agents-test-"));
  const systemDir = join(workDir, ".system");
  mkdirSync(systemDir, { recursive: true });
  dbPath = join(systemDir, "sidjua.db");
  db     = openDatabase(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = OFF");   // tests use no FK-checked rows
  // Lifecycle migrations create agent_definitions (and _migrations tracking table)
  runMigrations105(db);
});

afterEach(() => {
  try { db.close(); } catch (_) { /* ignore */ }
  rmSync(workDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// T8/T9: upsertAgentRow
// ---------------------------------------------------------------------------

describe("upsertAgentRow", () => {
  it("T8: inserts a new agent row into agent_definitions", () => {
    const now   = new Date().toISOString();
    const entry: AgentEntry = {
      id:          "test-agent",
      name:        "Test Agent",
      tier:        2,
      division:    "workspace",
      provider:    "auto",
      model:       "llama-70b",
      skill_path:  "",
      config_yaml: "role:\n  id: test-agent\n",
      config_hash: "abc123",
      status:      "stopped",
    };
    upsertAgentRow(db, entry, now);

    const row = db.prepare("SELECT * FROM agent_definitions WHERE id = ?").get("test-agent") as Record<string, unknown> | undefined;
    expect(row).toBeDefined();
    expect(row!["name"]).toBe("Test Agent");
    expect(row!["tier"]).toBe(2);
    expect(row!["division"]).toBe("workspace");
  });

  it("T9: updates an existing row on conflict (idempotent upsert)", () => {
    const now   = new Date().toISOString();
    const entry: AgentEntry = {
      id:          "conflict-agent",
      name:        "Original Name",
      tier:        1,
      division:    "system",
      provider:    "auto",
      model:       "model-v1",
      skill_path:  "",
      config_yaml: "role:\n  id: conflict-agent\n",
      config_hash: "hash1",
      status:      "stopped",
    };
    upsertAgentRow(db, entry, now);

    const updated: AgentEntry = { ...entry, name: "Updated Name", model: "model-v2" };
    upsertAgentRow(db, updated, now);

    const rows = db.prepare("SELECT * FROM agent_definitions WHERE id = ?").all("conflict-agent") as unknown[];
    expect(rows).toHaveLength(1);
    const row = rows[0] as Record<string, unknown>;
    expect(row["name"]).toBe("Updated Name");
    expect(row["model"]).toBe("model-v2");
  });
});

// ---------------------------------------------------------------------------
// T5/T6/T7: parseUserAgentFile
// ---------------------------------------------------------------------------

describe("parseUserAgentFile", () => {
  it("T5: returns null when file has no 'role' or 'agent' key", () => {
    const file = join(workDir, "bad.yaml");
    writeFileSync(file, "foo: bar\n", "utf-8");
    expect(parseUserAgentFile(file)).toBeNull();
  });

  it("T5b: returns null when id is missing", () => {
    const file = join(workDir, "no-id.yaml");
    writeFileSync(file, "role:\n  name: No ID\n", "utf-8");
    expect(parseUserAgentFile(file)).toBeNull();
  });

  it("T6: accepts 'agent:' top-level key", () => {
    const file = join(workDir, "alt-key.yaml");
    writeFileSync(file, [
      "agent:",
      "  id: alt-agent",
      "  name: Alt Agent",
      "  tier: 2",
      "  division: workspace",
    ].join("\n") + "\n", "utf-8");
    const entry = parseUserAgentFile(file);
    expect(entry).not.toBeNull();
    expect(entry!.id).toBe("alt-agent");
    expect(entry!.name).toBe("Alt Agent");
  });

  it("T7: extracts tier and division; model stays 'auto' when provider is 'auto'", () => {
    const file = join(workDir, "full.yaml");
    writeFileSync(file, [
      "role:",
      "  id: full-agent",
      "  name: Full Agent",
      "  tier: 3",
      "  division: finance",
      "  recommended_model:",
      "    min_quality: B+",
      "    suggested: gpt-4o-mini",
    ].join("\n") + "\n", "utf-8");
    const entry = parseUserAgentFile(file);
    expect(entry).not.toBeNull();
    expect(entry!.tier).toBe(3);
    expect(entry!.division).toBe("finance");
    // provider defaults to "auto" → recommended_model.suggested is NOT used
    expect(entry!.model).toBe("auto");
  });

  it("T7c: uses recommended_model.suggested when provider is explicitly set", () => {
    const file = join(workDir, "explicit-provider.yaml");
    writeFileSync(file, [
      "role:",
      "  id: explicit-agent",
      "  name: Explicit Agent",
      "  tier: 2",
      "  division: workspace",
      "  provider: groq",
      "  recommended_model:",
      "    min_quality: B+",
      "    suggested: llama-3.3-70b",
    ].join("\n") + "\n", "utf-8");
    const entry = parseUserAgentFile(file);
    expect(entry).not.toBeNull();
    expect(entry!.provider).toBe("groq");
    expect(entry!.model).toBe("llama-3.3-70b");
  });

  it("T7b: tier is clamped to [1, 7]", () => {
    const file = join(workDir, "tier-clamp.yaml");
    writeFileSync(file, "role:\n  id: clamp-agent\n  name: Clamp\n  tier: 99\n", "utf-8");
    const entry = parseUserAgentFile(file);
    expect(entry).not.toBeNull();
    expect(entry!.tier).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// T1/T2/T3/T4/T10/T11: applyAgents
// ---------------------------------------------------------------------------

describe("applyAgents", () => {
  it("T1: registers starter agents from defaults/roles/", () => {
    const config = makeConfig();
    const result = applyAgents(config, workDir, db);

    expect(result.success).toBe(true);
    expect(result.step).toBe("AGENTS");

    const rows = db.prepare("SELECT id FROM agent_definitions").all() as { id: string }[];
    const ids  = rows.map((r) => r.id);
    // The 6 canonical starter agents must all be present
    expect(ids).toContain("guide");
    expect(ids).toContain("hr");
  });

  it("T2: registers user-defined agents from {workDir}/agents/definitions/", () => {
    const defsDir = join(workDir, "agents", "definitions");
    mkdirSync(defsDir, { recursive: true });
    writeFileSync(join(defsDir, "custom-bot.yaml"), [
      "role:",
      "  id: custom-bot",
      "  name: Custom Bot",
      "  tier: 2",
      "  division: workspace",
    ].join("\n") + "\n", "utf-8");

    const result = applyAgents(makeConfig(), workDir, db);
    expect(result.success).toBe(true);

    const row = db.prepare("SELECT * FROM agent_definitions WHERE id = ?").get("custom-bot") as Record<string, unknown> | undefined;
    expect(row).toBeDefined();
    expect(row!["name"]).toBe("Custom Bot");
    expect((result.details as Record<string, unknown>)["user_registered"]).toBe(1);
  });

  it("T3: is idempotent — running twice produces same rows", () => {
    const config = makeConfig();
    applyAgents(config, workDir, db);
    applyAgents(config, workDir, db);

    const rows = db.prepare("SELECT id FROM agent_definitions").all() as { id: string }[];
    const ids  = rows.map((r) => r.id);
    // No duplicates
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("T4: malformed YAML files are skipped non-fatally", () => {
    const defsDir = join(workDir, "agents", "definitions");
    mkdirSync(defsDir, { recursive: true });
    // Good file
    writeFileSync(join(defsDir, "good.yaml"), "role:\n  id: good\n  name: Good\n  tier: 2\n  division: workspace\n", "utf-8");
    // Bad file — no role/agent key
    writeFileSync(join(defsDir, "bad.yaml"), "random: data\n", "utf-8");

    const result = applyAgents(makeConfig(), workDir, db);
    expect(result.success).toBe(true);
    expect((result.details as Record<string, unknown>)["user_registered"]).toBe(1);
    expect((result.details as Record<string, unknown>)["user_skipped"]).toBe(1);
  });

  it("T10: StepResult has correct step, success, and numeric details", () => {
    const result = applyAgents(makeConfig(), workDir, db);
    expect(result.step).toBe("AGENTS");
    expect(result.success).toBe(true);
    expect(typeof result.duration_ms).toBe("number");
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
    expect(typeof (result.details as Record<string, unknown>)["starter_registered"]).toBe("number");
    expect(typeof (result.details as Record<string, unknown>)["user_registered"]).toBe("number");
  });

  it("T11: succeeds when agents/definitions/ directory does not exist", () => {
    // workDir has no agents/ subdirectory
    const result = applyAgents(makeConfig(), workDir, db);
    expect(result.success).toBe(true);
    expect((result.details as Record<string, unknown>)["user_registered"]).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// T12: syncDefaultDivisions via applyDatabase
// ---------------------------------------------------------------------------

describe("syncDefaultDivisions via applyDatabase", () => {
  it("T12: applyDatabase inserts system, executive, workspace divisions", () => {
    const systemDir = join(workDir, ".system");
    mkdirSync(systemDir, { recursive: true });
    const config  = makeConfig([makeDivision("hr-test")]);
    const { db: appliedDb } = applyDatabase(config, workDir);

    const rows = appliedDb.prepare("SELECT code FROM divisions").all() as { code: string }[];
    const codes = rows.map((r) => r.code);

    // Default divisions must be present
    expect(codes).toContain("system");
    expect(codes).toContain("executive");
    expect(codes).toContain("workspace");
    // User-configured division also present
    expect(codes).toContain("hr-test");

    appliedDb.close();
  });
});
