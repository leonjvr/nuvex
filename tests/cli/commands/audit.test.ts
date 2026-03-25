// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Tests for src/cli/commands/audit.ts — structural + registration tests
 */

import { describe, it, expect } from "vitest";

describe("registerAuditCommands — structural", () => {
  it("registerAuditCommands registers 'audit' command", async () => {
    const { Command } = await import("commander");
    const { registerAuditCommands } = await import(
      "../../../src/cli/commands/audit.js"
    );
    const program = new Command();
    program.exitOverride();
    registerAuditCommands(program);
    const cmd = program.commands.find((c) => c.name() === "audit");
    expect(cmd).toBeDefined();
  });

  it("audit has 'report', 'violations', 'agents', 'summary', 'export' subcommands", async () => {
    const { Command } = await import("commander");
    const { registerAuditCommands } = await import(
      "../../../src/cli/commands/audit.js"
    );
    const program = new Command();
    program.exitOverride();
    registerAuditCommands(program);

    const auditCmd = program.commands.find((c) => c.name() === "audit")!;
    const subnames = auditCmd.commands.map((c) => c.name());
    expect(subnames).toContain("report");
    expect(subnames).toContain("violations");
    expect(subnames).toContain("agents");
    expect(subnames).toContain("summary");
    expect(subnames).toContain("export");
  });

  it("audit report has --division, --agent, --since, --until, --json options", async () => {
    const { Command } = await import("commander");
    const { registerAuditCommands } = await import(
      "../../../src/cli/commands/audit.js"
    );
    const program = new Command();
    program.exitOverride();
    registerAuditCommands(program);

    const auditCmd  = program.commands.find((c) => c.name() === "audit")!;
    const reportCmd = auditCmd.commands.find((c) => c.name() === "report")!;
    const opts      = reportCmd.options.map((o) => o.long);

    expect(opts).toContain("--division");
    expect(opts).toContain("--agent");
    expect(opts).toContain("--since");
    expect(opts).toContain("--until");
    expect(opts).toContain("--json");
  });

  it("audit violations has --severity option", async () => {
    const { Command } = await import("commander");
    const { registerAuditCommands } = await import(
      "../../../src/cli/commands/audit.js"
    );
    const program = new Command();
    program.exitOverride();
    registerAuditCommands(program);

    const auditCmd = program.commands.find((c) => c.name() === "audit")!;
    const violCmd  = auditCmd.commands.find((c) => c.name() === "violations")!;
    const opts     = violCmd.options.map((o) => o.long);
    expect(opts).toContain("--severity");
  });

  it("audit export has required --format option", async () => {
    const { Command } = await import("commander");
    const { registerAuditCommands } = await import(
      "../../../src/cli/commands/audit.js"
    );
    const program = new Command();
    program.exitOverride();
    registerAuditCommands(program);

    const auditCmd  = program.commands.find((c) => c.name() === "audit")!;
    const exportCmd = auditCmd.commands.find((c) => c.name() === "export")!;
    const opts      = exportCmd.options.map((o) => o.long);
    expect(opts).toContain("--format");
    expect(opts).toContain("--output");
  });

  it("audit export has --division, --agent, --since, --until filter options", async () => {
    const { Command } = await import("commander");
    const { registerAuditCommands } = await import(
      "../../../src/cli/commands/audit.js"
    );
    const program = new Command();
    program.exitOverride();
    registerAuditCommands(program);

    const auditCmd  = program.commands.find((c) => c.name() === "audit")!;
    const exportCmd = auditCmd.commands.find((c) => c.name() === "export")!;
    const opts      = exportCmd.options.map((o) => o.long);
    expect(opts).toContain("--division");
    expect(opts).toContain("--agent");
    expect(opts).toContain("--since");
    expect(opts).toContain("--until");
  });

  it("audit summary has --since, --until, --json options", async () => {
    const { Command } = await import("commander");
    const { registerAuditCommands } = await import(
      "../../../src/cli/commands/audit.js"
    );
    const program = new Command();
    program.exitOverride();
    registerAuditCommands(program);

    const auditCmd  = program.commands.find((c) => c.name() === "audit")!;
    const sumCmd    = auditCmd.commands.find((c) => c.name() === "summary")!;
    const opts      = sumCmd.options.map((o) => o.long);
    expect(opts).toContain("--since");
    expect(opts).toContain("--until");
    expect(opts).toContain("--json");
  });

  it("all subcommands have --work-dir option", async () => {
    const { Command } = await import("commander");
    const { registerAuditCommands } = await import(
      "../../../src/cli/commands/audit.js"
    );
    const program = new Command();
    program.exitOverride();
    registerAuditCommands(program);

    const auditCmd = program.commands.find((c) => c.name() === "audit")!;
    for (const sub of auditCmd.commands) {
      const opts = sub.options.map((o) => o.long);
      expect(opts, `${sub.name()} should have --work-dir`).toContain("--work-dir");
    }
  });

  it("audit agents has --division, --agent, --since, --until, --json options", async () => {
    const { Command } = await import("commander");
    const { registerAuditCommands } = await import(
      "../../../src/cli/commands/audit.js"
    );
    const program = new Command();
    program.exitOverride();
    registerAuditCommands(program);

    const auditCmd  = program.commands.find((c) => c.name() === "audit")!;
    const agentsCmd = auditCmd.commands.find((c) => c.name() === "agents")!;
    const opts      = agentsCmd.options.map((o) => o.long);
    expect(opts).toContain("--division");
    expect(opts).toContain("--agent");
    expect(opts).toContain("--since");
    expect(opts).toContain("--until");
    expect(opts).toContain("--json");
  });
});
