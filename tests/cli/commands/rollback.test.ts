// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Tests for src/cli/commands/rollback.ts — structural tests.
 */

import { describe, it, expect } from "vitest";
import { Command } from "commander";
import { registerRollbackCommands } from "../../../src/cli/commands/rollback.js";

describe("registerRollbackCommands — structural", () => {
  it("registers a 'rollback' command on the program", () => {
    const program = new Command();
    program.exitOverride();
    registerRollbackCommands(program);
    const cmd = program.commands.find((c) => c.name() === "rollback");
    expect(cmd).toBeDefined();
  });

  it("rollback command has --to, --yes, --force-unlock, --list options", () => {
    const program = new Command();
    program.exitOverride();
    registerRollbackCommands(program);
    const cmd = program.commands.find((c) => c.name() === "rollback")!;
    const optionNames = cmd.options.map((o) => o.long);
    expect(optionNames).toContain("--to");
    expect(optionNames).toContain("--yes");
    expect(optionNames).toContain("--force-unlock");
    expect(optionNames).toContain("--list");
  });

  it("rollback command has a meaningful description", () => {
    const program = new Command();
    program.exitOverride();
    registerRollbackCommands(program);
    const cmd = program.commands.find((c) => c.name() === "rollback")!;
    expect(cmd.description().toLowerCase()).toContain("rollback");
  });
});
