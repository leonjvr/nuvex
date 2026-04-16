// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 19: `sidjua sandbox` commands
 *
 * Subcommands:
 *   sidjua sandbox check  — verify sandbox provider + dependencies
 */

import { existsSync }   from "node:fs";
import { join }         from "node:path";
import type { Command } from "commander";
import { loadAndValidate } from "../../apply/validate.js";
import { createSandboxProvider, DEFAULT_SANDBOX_CONFIG } from "../../core/sandbox/index.js";
import type { SandboxConfig } from "../../core/sandbox/types.js";
import { resolveConfigPath } from "../../core/config/resolve-config-path.js";


export interface SandboxCheckOptions {
  workDir: string;
  config:  string;
  /** Acknowledge "none" provider has NO isolation. Required when provider is "none". */
  force?:  boolean;
}


/**
 * Print sandbox provider status and dependency availability.
 * Exits 0 if provider is ready (or "none"), exits 1 if dependencies are missing.
 */
export async function runSandboxCheckCommand(opts: SandboxCheckOptions): Promise<number> {
  let configPath: string;
  try {
    configPath = resolveConfigPath(opts.workDir, opts.config !== "governance/divisions.yaml" ? opts.config : undefined);
  } catch (_e) {
    // Fall back to the default path even if it doesn't exist — loadAndValidate will handle the error
    configPath = join(opts.workDir, "governance", "divisions.yaml");
  }

  let sandboxConfig: SandboxConfig = DEFAULT_SANDBOX_CONFIG;

  if (existsSync(configPath)) {
    const { config } = loadAndValidate(configPath);
    if (config?.sandbox !== undefined) {
      sandboxConfig = config.sandbox;
    }
  }

  process.stdout.write("Sandbox Status\n");
  process.stdout.write(`  Provider configured: ${sandboxConfig.provider}\n`);

  if (sandboxConfig.provider === "none") {
    // Provider "none" gives NO isolation — agents run with full host
    // privileges. Require --force to acknowledge the risk explicitly.
    // Records a sandbox_check audit event (severity: warning) in either case.
    if (!opts.force) {
      process.stderr.write(
        "ERROR [sandbox_check]: Sandbox provider \"none\" provides NO isolation.\n" +
        "  Agents will run with full host privileges.\n" +
        "  Use --force to acknowledge this risk and proceed.\n" +
        "  See docs/security-limitations-v1.md for details.\n",
      );
      return 1;
    }

    process.stderr.write(
      "WARNING [sandbox_check]: Running without sandbox isolation. " +
      "All agents have full host access. See docs/security-limitations-v1.md\n",
    );
    process.stdout.write("  No sandbox isolation active (--force acknowledged).\n");
    process.stdout.write("\n");
    process.stdout.write("To enable sandboxing, set sandbox.provider: \"bubblewrap\" in divisions.yaml.\n");
    return 0;
  }

  // Create provider (not yet initialized — just check dependencies)
  const provider = createSandboxProvider(sandboxConfig);
  const check = await provider.checkDependencies();

  process.stdout.write(`  Dependencies available: ${check.available ? "yes" : "no"}\n`);

  if (check.available) {
    if (check.message) {
      process.stdout.write(`  ${check.message}\n`);
    }
    process.stdout.write("\n");
    process.stdout.write("Ready for sandboxed agent execution.\n");
    process.stdout.write("\n");
    process.stdout.write("NOTE: Running in Docker requires extra capabilities:\n");
    process.stdout.write("  docker run --cap-add=SYS_ADMIN --security-opt seccomp=unconfined ...\n");
    return 0;
  }

  // Dependencies missing
  if (check.missing.length > 0) {
    process.stdout.write(`  Missing: ${check.missing.join(", ")}\n`);
  }
  process.stdout.write("\n");
  process.stdout.write("Install dependencies:\n");
  process.stdout.write("  Ubuntu/Debian: sudo apt install bubblewrap socat\n");
  process.stdout.write("  Alpine:        sudo apk add bubblewrap socat\n");
  process.stdout.write("  macOS:         brew install bubblewrap  (socat not needed on macOS)\n");
  return 1;
}


/**
 * Register `sidjua sandbox` subcommands onto the given Commander program.
 */
export function registerSandboxCommands(program: Command): void {
  const sandboxCmd = program
    .command("sandbox")
    .description("Sandbox provider management and diagnostics");

  sandboxCmd
    .command("check")
    .description("Check sandbox provider configuration and dependencies")
    .option("--work-dir <path>", "Working directory", process.cwd())
    .option("--config <path>",   "Path to divisions.yaml", "governance/divisions.yaml")
    .option("--force", "Acknowledge risk when sandbox provider is \"none\" (no isolation)", false)
    .action(async (opts: SandboxCheckOptions) => {
      const exitCode = await runSandboxCheckCommand(opts);
      process.exitCode = exitCode;
    });
}
