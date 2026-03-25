// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm }               from "node:fs/promises";
import { tmpdir }  from "node:os";
import { join }    from "node:path";
import { openDatabase }     from "../../src/utils/db.js";
import { runMigrations105 } from "../../src/agent-lifecycle/migration.js";
import { runOpenClawImport } from "../../src/cli/commands/import.js";
import type { OpenClawImportOptions } from "../../src/import/openclaw-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeWorkDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "sidjua-cli-import-test-"));
  await mkdir(join(dir, ".system"), { recursive: true });
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

function baseOpts(workDir: string, configPath: string): OpenClawImportOptions {
  return {
    configPath,
    workDir,
    dryRun:    false,
    noSecrets: true,
    budgetUsd: 50.00,
    tier:      3,
    division:  "general",
  };
}

// ---------------------------------------------------------------------------
// runOpenClawImport
// ---------------------------------------------------------------------------

describe("runOpenClawImport", () => {
  let workDir:    string;
  let configPath: string;

  beforeEach(async () => {
    workDir    = await makeWorkDir();
    configPath = await writeConfig(workDir, {
      identity: { name: "CLIBot" },
      agent:    { model: { primary: "anthropic/claude-sonnet-4-5" } },
    });
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("returns exit code 0 on success", async () => {
    const opts = baseOpts(workDir, configPath);
    const code = await runOpenClawImport(opts);
    expect(code).toBe(0);
  });

  it("returns exit code 0 in dry-run mode", async () => {
    const opts = { ...baseOpts(workDir, configPath), dryRun: true };
    const code = await runOpenClawImport(opts);
    expect(code).toBe(0);
  });

  it("returns exit code 1 for missing config file", async () => {
    const opts = { ...baseOpts(workDir, "/nonexistent/openclaw.json"), dryRun: true };
    const code = await runOpenClawImport(opts);
    expect(code).toBe(1);
  });

  it("returns exit code 1 when config has no model", async () => {
    const noModelPath = join(workDir, "nomodel.json");
    await writeFile(noModelPath, JSON.stringify({ identity: { name: "X" } }), "utf-8");
    const opts = baseOpts(workDir, noModelPath);
    const code = await runOpenClawImport(opts);
    expect(code).toBe(1);
  });

  it("dry-run has zero side effects — no agent in DB", async () => {
    const opts = { ...baseOpts(workDir, configPath), dryRun: true };
    await runOpenClawImport(opts);

    const db = openDatabase(join(workDir, ".system", "sidjua.db"));
    runMigrations105(db);
    const { AgentRegistry } = await import("../../src/agent-lifecycle/agent-registry.js");
    const registry = new AgentRegistry(db);
    expect(registry.getById("clibot")).toBeUndefined();
    db.close();
  });

  it("skips credential migration with --no-secrets", async () => {
    const configWithCreds = await writeConfig(workDir, {
      identity: { name: "CredBot" },
      agent:    { model: { primary: "anthropic/claude-sonnet-4-5" } },
      env:      { ANTHROPIC_API_KEY: "sk-ant-abc" },
    });
    const opts = { ...baseOpts(workDir, configWithCreds), noSecrets: true };
    await runOpenClawImport(opts);

    const { existsSync } = await import("node:fs");
    expect(existsSync(join(workDir, ".sidjua-imported.env"))).toBe(false);
  });
});
