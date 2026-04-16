// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — `sidjua import` Commands
 *
 * Subcommands:
 *   sidjua import openclaw   — Migrate an OpenClaw agent to SIDJUA
 *
 * Key message: "Keep your agents, add governance."
 */

import { resolve }              from "node:path";
import { statSync, existsSync } from "node:fs";
import type { Command }         from "commander";
import {
  importOpenClaw,
  DEFAULT_OPENCLAW_CONFIG,
  deriveAgentId,
}                               from "../../import/openclaw-importer.js";
import { maskSecret }           from "../../import/openclaw-credential-migrator.js";
import { importedEnvPath }      from "../../import/openclaw-credential-migrator.js";
import type { OpenClawImportOptions, ImportResult } from "../../import/openclaw-types.js";


export function registerImportCommands(program: Command): void {
  const importCmd = program
    .command("import")
    .description("Import agents from other platforms (OpenClaw, Moltbot, ...)");

  importCmd
    .command("openclaw")
    .description("Import an OpenClaw agent with automatic SIDJUA governance")
    .option("--config <path>",        "Path to openclaw.json",                     DEFAULT_OPENCLAW_CONFIG)
    .option("--skills <path>",        "Path to OpenClaw skills directory")
    .option("--dry-run",              "Preview import without making changes",       false)
    .option("--no-secrets",           "Skip API key migration")
    .option("--budget <amount>",      "Monthly budget limit in USD",                "50.00")
    .option("--division <name>",      "Assign agent to division",                   "general")
    .option("--tier <n>",             "Set agent tier (1–3)",                       "3")
    .option("--name <name>",          "Override agent name")
    .option("--model <spec>",         "Override model (e.g. anthropic/claude-sonnet-4-5)")
    .option("--work-dir <path>",      "Workspace directory",                        process.cwd())
    .action(async (opts: {
      config:    string;
      skills?:   string;
      dryRun:    boolean;
      noSecrets: boolean;
      budget:    string;
      division:  string;
      tier:      string;
      name?:     string;
      model?:    string;
      workDir:   string;
    }) => {
      const configPath = resolve(opts.config);
      if (!existsSync(configPath)) {
        process.stderr.write(`✗ Config file not found: ${opts.config}\n`);
        process.exit(1);
      }
      const MAX_CONFIG_SIZE = 1 * 1024 * 1024; // 1 MB
      if (statSync(configPath).size > MAX_CONFIG_SIZE) {
        process.stderr.write(`✗ Config file exceeds 1 MB limit\n`);
        process.exit(1);
      }
      const importOpts: OpenClawImportOptions = {
        configPath,
        workDir:    resolve(opts.workDir),
        dryRun:     opts.dryRun,
        noSecrets:  opts.noSecrets,
        budgetUsd:  parseFloat(opts.budget) || 50.00,
        tier:       parseInt(opts.tier, 10) || 3,
        division:   opts.division,
      };
      if (opts.skills)  importOpts.skillsPath   = resolve(opts.skills);
      if (opts.name)    importOpts.nameOverride  = opts.name;
      if (opts.model)   importOpts.modelOverride = opts.model;
      const exitCode = await runOpenClawImport(importOpts);
      process.exit(exitCode);
    });
}


export async function runOpenClawImport(options: OpenClawImportOptions): Promise<number> {
  process.stderr.write(
    "\n⚠️  WARNING: Back up your OpenClaw data before importing!\n" +
    "    This is a one-way copy into Sidjua. We are not responsible for\n" +
    "    data loss if you delete your OpenClaw installation afterward.\n\n",
  );
  process.stderr.write(
    "⚠️  BETA NOTICE: The OpenClaw importer has not been tested against a real\n" +
    "    OpenClaw installation. If you encounter issues, please open an issue on\n" +
    "    the SIDJUA GitHub repository.\n\n",
  );

  try {
    out("🔍 Scanning OpenClaw installation...\n");
    out(`   Config: ${options.configPath}\n`);

    if (options.dryRun) {
      out("   Mode:   dry-run (no changes will be made)\n");
    }

    out("\n");

    const result = await importOpenClaw(options);
    printResult(result, options);
    return 0;
  } catch (err) {
    process.stderr.write(`\nImport failed: ${String(err)}\n`);
    return 1;
  }
}


function out(msg: string): void {
  process.stdout.write(msg);
}

function printResult(result: ImportResult, options: OpenClawImportOptions): void {
  const { agent, skills, credentials, channels, governance } = result;

  out(`Agent: "${agent.name}" (${agent.provider}/${agent.model})\n`);
  out(`ID:    ${agent.id}\n`);
  if (channels.length > 0) {
    out(`Channels: ${channels.map((c) => c.charAt(0).toUpperCase() + c.slice(1)).join(", ")}\n`);
  }
  out("\n");

  if (options.dryRun) {
    out("--- DRY RUN PREVIEW ---\n\n");
  }

  // Agent
  if (options.dryRun) {
    out(`Would create agent "${agent.id}" (T${agent.tier}, division: ${agent.division})\n`);
  } else {
    out(`✓ Agent "${agent.id}" created (T${agent.tier}, division: ${agent.division})\n`);
  }

  // Skills
  if (skills.imported.length > 0) {
    const verb = options.dryRun ? "Would import" : "✓";
    out(`${verb} ${skills.imported.length} skill${skills.imported.length !== 1 ? "s" : ""} imported`);
    out(` (${skills.imported.join(", ")})\n`);
  }

  if (skills.moduleRequired.length > 0) {
    out(`⚠  ${skills.moduleRequired.length} skill${skills.moduleRequired.length !== 1 ? "s" : ""} need modules:\n`);
    for (const { skill, module: mod } of skills.moduleRequired) {
      const available = ["discord"].includes(mod);
      const suffix = available ? "" : " (planned for V1.1)";
      out(`   - ${skill} → sidjua module install ${mod}${suffix}\n`);
    }
  }

  if (skills.skipped.length > 0) {
    out(`   ${skills.skipped.length} skill${skills.skipped.length !== 1 ? "s" : ""} skipped (no SKILL.md found)\n`);
  }

  // Credentials
  if (options.noSecrets) {
    out("   Credential migration skipped (--no-secrets)\n");
  } else if (credentials.migrated.length > 0) {
    const verb = options.dryRun ? "Would migrate" : "✓";
    const providerList = credentials.migrated
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join(", ");
    out(`${verb} ${credentials.migrated.length} API key${credentials.migrated.length !== 1 ? "s" : ""} migrated (${providerList})\n`);
    if (!options.dryRun) {
      out(`   Stored in: ${importedEnvPath(options.workDir)}\n`);
    }
  } else {
    out("   No API keys found to migrate\n");
  }

  if (credentials.skipped.length > 0 && !options.noSecrets) {
    out(`   ${credentials.skipped.length} keys skipped (already configured)\n`);
  }

  // Governance
  out(`${options.dryRun ? "Would apply" : "✓"} Governance applied:\n`);
  out(`   - Pre-action enforcement: ${governance.preActionEnforcement ? "ON" : "OFF"}\n`);
  out(`   - Audit trail: ${governance.auditTrail ? "ON" : "OFF"}\n`);
  out(`   - Budget: $${governance.budgetMonthly.toFixed(2)}/month  $${governance.budgetPerTask.toFixed(2)}/task\n`);

  out("\n");

  if (options.dryRun) {
    out("--- End of dry-run preview. No changes were made. ---\n");
    out(`Run without --dry-run to apply.\n`);
  } else {
    out(`Import complete! Try: sidjua agent show ${agent.id}\n`);
  }
}

// Re-export for testing
export { maskSecret, DEFAULT_OPENCLAW_CONFIG };
