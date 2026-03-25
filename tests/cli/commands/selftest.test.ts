// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Tests for src/cli/commands/selftest.ts — structural + registration tests
 */

import { describe, it, expect } from "vitest";

describe("registerSelftestCommands — structural", () => {
  it("registers 'selftest' command", async () => {
    const { Command } = await import("commander");
    const { registerSelftestCommands } = await import(
      "../../../src/cli/commands/selftest.js"
    );
    const program = new Command();
    program.exitOverride();
    registerSelftestCommands(program);
    const cmd = program.commands.find((c) => c.name() === "selftest");
    expect(cmd).toBeDefined();
  });

  it("registers 'doctor' alias", async () => {
    const { Command } = await import("commander");
    const { registerSelftestCommands } = await import(
      "../../../src/cli/commands/selftest.js"
    );
    const program = new Command();
    program.exitOverride();
    registerSelftestCommands(program);
    const cmd = program.commands.find((c) => c.name() === "doctor");
    expect(cmd).toBeDefined();
  });

  it("selftest has --json option", async () => {
    const { Command } = await import("commander");
    const { registerSelftestCommands } = await import(
      "../../../src/cli/commands/selftest.js"
    );
    const program = new Command();
    program.exitOverride();
    registerSelftestCommands(program);
    const cmd  = program.commands.find((c) => c.name() === "selftest")!;
    const opts = cmd.options.map((o) => o.long);
    expect(opts).toContain("--json");
  });

  it("selftest has --fix option", async () => {
    const { Command } = await import("commander");
    const { registerSelftestCommands } = await import(
      "../../../src/cli/commands/selftest.js"
    );
    const program = new Command();
    program.exitOverride();
    registerSelftestCommands(program);
    const cmd  = program.commands.find((c) => c.name() === "selftest")!;
    const opts = cmd.options.map((o) => o.long);
    expect(opts).toContain("--fix");
  });

  it("selftest has --verbose option", async () => {
    const { Command } = await import("commander");
    const { registerSelftestCommands } = await import(
      "../../../src/cli/commands/selftest.js"
    );
    const program = new Command();
    program.exitOverride();
    registerSelftestCommands(program);
    const cmd  = program.commands.find((c) => c.name() === "selftest")!;
    const opts = cmd.options.map((o) => o.long);
    expect(opts).toContain("--verbose");
  });

  it("selftest has --category option", async () => {
    const { Command } = await import("commander");
    const { registerSelftestCommands } = await import(
      "../../../src/cli/commands/selftest.js"
    );
    const program = new Command();
    program.exitOverride();
    registerSelftestCommands(program);
    const cmd  = program.commands.find((c) => c.name() === "selftest")!;
    const opts = cmd.options.map((o) => o.long);
    expect(opts).toContain("--category");
  });

  it("selftest has --work-dir option", async () => {
    const { Command } = await import("commander");
    const { registerSelftestCommands } = await import(
      "../../../src/cli/commands/selftest.js"
    );
    const program = new Command();
    program.exitOverride();
    registerSelftestCommands(program);
    const cmd  = program.commands.find((c) => c.name() === "selftest")!;
    const opts = cmd.options.map((o) => o.long);
    expect(opts).toContain("--work-dir");
  });

  it("doctor has the same options as selftest", async () => {
    const { Command } = await import("commander");
    const { registerSelftestCommands } = await import(
      "../../../src/cli/commands/selftest.js"
    );
    const program = new Command();
    program.exitOverride();
    registerSelftestCommands(program);
    const st  = program.commands.find((c) => c.name() === "selftest")!;
    const doc = program.commands.find((c) => c.name() === "doctor")!;
    expect(doc.options.map((o) => o.long)).toEqual(st.options.map((o) => o.long));
  });
});
