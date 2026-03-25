// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Tests for src/cli/commands/version.ts — structural tests.
 */

import { describe, it, expect } from "vitest";
import { Command } from "commander";
import { registerVersionCommands } from "../../../src/cli/commands/version.js";

describe("registerVersionCommands — structural", () => {
  it("registers a 'version' command on the program", () => {
    const program = new Command();
    program.exitOverride();
    registerVersionCommands(program);
    const cmd = program.commands.find((c) => c.name() === "version");
    expect(cmd).toBeDefined();
  });

  it("version command has --json option", () => {
    const program = new Command();
    program.exitOverride();
    registerVersionCommands(program);
    const cmd = program.commands.find((c) => c.name() === "version")!;
    const optionNames = cmd.options.map((o) => o.long);
    expect(optionNames).toContain("--json");
  });

  it("version command has a meaningful description", () => {
    const program = new Command();
    program.exitOverride();
    registerVersionCommands(program);
    const cmd = program.commands.find((c) => c.name() === "version")!;
    expect(cmd.description().length).toBeGreaterThan(5);
  });
});
