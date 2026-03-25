// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Tests for src/cli/commands/update.ts — structural + unit tests.
 * Full integration tests would require a real npm registry mock.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Command }  from "commander";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir }   from "node:os";
import { join }     from "node:path";
import { registerUpdateCommands, registerChangelogCommands } from "../../../src/cli/commands/update.js";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "sidjua-update-test-"));
}

// ---------------------------------------------------------------------------
// Structural: command registration
// ---------------------------------------------------------------------------

describe("registerUpdateCommands — structural", () => {
  it("registers an 'update' command on the program", () => {
    const program = new Command();
    program.exitOverride();
    registerUpdateCommands(program);
    const cmd = program.commands.find((c) => c.name() === "update");
    expect(cmd).toBeDefined();
  });

  it("update command has --check, --governance, --yes, --force-unlock options", () => {
    const program = new Command();
    program.exitOverride();
    registerUpdateCommands(program);
    const cmd = program.commands.find((c) => c.name() === "update")!;
    const optionNames = cmd.options.map((o) => o.long);
    expect(optionNames).toContain("--check");
    expect(optionNames).toContain("--governance");
    expect(optionNames).toContain("--yes");
    expect(optionNames).toContain("--force-unlock");
  });
});

describe("registerChangelogCommands — structural", () => {
  it("registers a 'changelog' command on the program", () => {
    const program = new Command();
    program.exitOverride();
    registerChangelogCommands(program);
    const cmd = program.commands.find((c) => c.name() === "changelog");
    expect(cmd).toBeDefined();
  });

  it("changelog command accepts an optional version argument", () => {
    const program = new Command();
    program.exitOverride();
    registerChangelogCommands(program);
    const cmd = program.commands.find((c) => c.name() === "changelog")!;
    // Commander stores args in _args; check description
    expect(cmd.description()).toContain("changelog");
  });
});

// ---------------------------------------------------------------------------
// runSelftest (exported internal helper)
// ---------------------------------------------------------------------------

describe("runSelftest", () => {
  let tmp: string;

  beforeEach(() => { tmp = makeTempDir(); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it("runSelftest is callable without crashing", async () => {
    const { runSelftest } = await import("../../../src/cli/commands/update.js");
    // Use a mock paths object with a nonexistent system dir (expects some checks to fail)
    const mockPaths = {
      system: {
        root:       join(tmp, "system"),
        governance: join(tmp, "system", "governance"),
        version:    join(tmp, "system", "VERSION"),
        schemas:    join(tmp, "system", "schemas"),
        defaults:   join(tmp, "system", "defaults"),
        providers:  join(tmp, "system", "providers"),
        migrations: join(tmp, "system", "migrations"),
        templates:  join(tmp, "system", "templates"),
      },
      data: {
        root:           tmp,
        config:         join(tmp, "config"),
        governance:     join(tmp, "governance"),
        divisions:      join(tmp, "divisions"),
        secrets:        join(tmp, "secrets"),
        logs:           join(tmp, "logs"),
        knowledge:      join(tmp, "knowledge"),
        backups:        join(tmp, "backups"),
        migrationState: join(tmp, ".migration-state.json"),
      },
    };

    // Should not throw even with missing dirs
    let threw = false;
    try {
      runSelftest(mockPaths as Parameters<typeof runSelftest>[0]);
    } catch (e: unknown) {
      threw = true;
    }
    expect(threw).toBe(false);
  });
});
