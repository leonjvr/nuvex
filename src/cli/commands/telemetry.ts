// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — `sidjua telemetry` CLI commands
 *
 * Subcommands:
 *   status   — show current mode, installation ID, buffer stats
 *   enable   — set mode to 'auto'
 *   disable  — set mode to 'off'
 *   flush    — drain pending buffer to server
 *   reset    — clear buffer + regenerate installation ID (--confirm required)
 */

import { resolve }                          from "node:path";
import { randomUUID }                       from "node:crypto";
import type { Command }                     from "commander";
import {
  loadTelemetryConfig,
  saveTelemetryConfig,
  getTelemetryReporter,
  TelemetryReporter,
} from "../../core/telemetry/telemetry-reporter.js";
import { openTelemetryBuffer }              from "../../core/telemetry/telemetry-buffer.js";
import { SIDJUA_VERSION }                   from "../../version.js";


export function registerTelemetryCommands(program: Command): void {
  const tel = program
    .command("telemetry")
    .description("Error telemetry reporting management");

  // ── status ────────────────────────────────────────────────────────────────

  tel
    .command("status")
    .description("Show telemetry mode, installation ID, and buffer statistics")
    .option("--work-dir <path>", "Working directory", process.cwd())
    .option("--json",            "Output in JSON format", false)
    .action(async (opts: { workDir: string; json: boolean }) => {
      const exitCode = await runStatusCommand(opts.workDir, opts.json);
      process.exit(exitCode);
    });

  // ── enable ────────────────────────────────────────────────────────────────

  tel
    .command("enable")
    .description("Enable automatic error reporting (mode: auto)")
    .option("--work-dir <path>", "Working directory", process.cwd())
    .action(async (opts: { workDir: string }) => {
      const exitCode = await runEnableCommand(opts.workDir);
      process.exit(exitCode);
    });

  // ── disable ───────────────────────────────────────────────────────────────

  tel
    .command("disable")
    .description("Disable error reporting (mode: off). Pending events are kept locally.")
    .option("--work-dir <path>", "Working directory", process.cwd())
    .action(async (opts: { workDir: string }) => {
      const exitCode = await runDisableCommand(opts.workDir);
      process.exit(exitCode);
    });

  // ── flush ─────────────────────────────────────────────────────────────────

  tel
    .command("flush")
    .description("Manually send all pending buffered events to the server")
    .option("--work-dir <path>", "Working directory", process.cwd())
    .option("--json",            "Output in JSON format", false)
    .action(async (opts: { workDir: string; json: boolean }) => {
      const exitCode = await runFlushCommand(opts.workDir, opts.json);
      process.exit(exitCode);
    });

  // ── reset ─────────────────────────────────────────────────────────────────

  tel
    .command("reset")
    .description("Clear local event buffer and regenerate installation ID")
    .option("--work-dir <path>", "Working directory", process.cwd())
    .option("--confirm",         "Required: confirm destructive reset", false)
    .action(async (opts: { workDir: string; confirm: boolean }) => {
      const exitCode = await runResetCommand(opts.workDir, opts.confirm);
      process.exit(exitCode);
    });
}


export async function runStatusCommand(workDir: string, json: boolean): Promise<number> {
  try {
    const absWorkDir = resolve(workDir);
    const config     = await loadTelemetryConfig(absWorkDir);
    const buffer     = openTelemetryBuffer(absWorkDir);
    const stats      = buffer.getStats();
    buffer.close();

    if (json) {
      process.stdout.write(JSON.stringify({
        mode:             config.mode,
        installationId:   config.installationId,
        primaryEndpoint:  config.primaryEndpoint,
        fallbackEndpoint: config.fallbackEndpoint,
        buffer:           stats,
      }, null, 2) + "\n");
    } else {
      process.stdout.write(
        `Telemetry status\n` +
        `  Mode:              ${config.mode}\n` +
        `  Installation ID:   ${config.installationId}\n` +
        `  Primary endpoint:  ${config.primaryEndpoint}\n` +
        `  Fallback endpoint: ${config.fallbackEndpoint}\n` +
        `  Buffer:\n` +
        `    Pending: ${stats.pending}\n` +
        `    Sent:    ${stats.sent}\n` +
        `    Total:   ${stats.total}\n`,
      );
    }
    return 0;
  } catch (err) {
    process.stderr.write(`Error: ${String(err)}\n`);
    return 1;
  }
}

export async function runEnableCommand(workDir: string): Promise<number> {
  try {
    const absWorkDir = resolve(workDir);
    const config     = await loadTelemetryConfig(absWorkDir);

    if (config.mode === 'auto') {
      process.stdout.write("Telemetry is already enabled (mode: auto).\n");
      return 0;
    }

    await saveTelemetryConfig(absWorkDir, { ...config, mode: 'auto' });

    // Update singleton if running
    getTelemetryReporter()?.updateConfig({ mode: 'auto' });

    process.stdout.write(
      "Telemetry enabled. Error reports will be sent automatically.\n" +
      "Run `sidjua telemetry disable` to opt out at any time.\n",
    );
    return 0;
  } catch (err) {
    process.stderr.write(`Error: ${String(err)}\n`);
    return 1;
  }
}

export async function runDisableCommand(workDir: string): Promise<number> {
  try {
    const absWorkDir = resolve(workDir);
    const config     = await loadTelemetryConfig(absWorkDir);

    if (config.mode === 'off') {
      process.stdout.write("Telemetry is already disabled (mode: off).\n");
      return 0;
    }

    await saveTelemetryConfig(absWorkDir, { ...config, mode: 'off' });

    // Update singleton if running
    getTelemetryReporter()?.updateConfig({ mode: 'off' });

    process.stdout.write(
      "Telemetry disabled. No error reports will be sent.\n" +
      "Pending events remain in the local buffer (run `sidjua telemetry flush` to clear).\n",
    );
    return 0;
  } catch (err) {
    process.stderr.write(`Error: ${String(err)}\n`);
    return 1;
  }
}

export async function runFlushCommand(workDir: string, json: boolean): Promise<number> {
  try {
    const absWorkDir = resolve(workDir);
    const config     = await loadTelemetryConfig(absWorkDir);

    // Get or create a reporter for the flush
    let reporter = getTelemetryReporter();
    let owned    = false;
    if (reporter === null) {
      reporter = new TelemetryReporter(config, absWorkDir, SIDJUA_VERSION);
      owned    = true;
    }

    const buffer     = reporter.getBuffer();
    const pending    = buffer.getPending(100);
    const pendingCnt = pending.length;

    if (pendingCnt === 0) {
      if (json) {
        process.stdout.write(JSON.stringify({ pending: 0, sent: 0, failed: 0 }) + "\n");
      } else {
        process.stdout.write("No pending events to flush.\n");
      }
      if (owned) buffer.close();
      return 0;
    }

    if (!json) {
      process.stdout.write(`Sending ${pendingCnt} pending event(s)...\n`);
    }

    const { sent, failed } = await reporter.drain();

    if (json) {
      process.stdout.write(JSON.stringify({ pending: pendingCnt, sent, failed }) + "\n");
    } else {
      process.stdout.write(`${sent} sent, ${failed} failed.\n`);
    }

    if (owned) buffer.close();
    return failed === 0 ? 0 : 1;
  } catch (err) {
    process.stderr.write(`Error: ${String(err)}\n`);
    return 1;
  }
}

export async function runResetCommand(workDir: string, confirm: boolean): Promise<number> {
  if (!confirm) {
    process.stderr.write(
      "Error: --confirm flag required for destructive reset.\n" +
      "Usage: sidjua telemetry reset --confirm\n",
    );
    return 1;
  }

  try {
    const absWorkDir = resolve(workDir);
    const config     = await loadTelemetryConfig(absWorkDir);

    // Clear buffer
    const buffer = openTelemetryBuffer(absWorkDir);
    buffer.clear();
    buffer.close();

    // Regenerate installation ID
    const newId = randomUUID();
    await saveTelemetryConfig(absWorkDir, { ...config, installationId: newId });

    // Update singleton if running
    getTelemetryReporter()?.updateConfig({ installationId: newId });

    process.stdout.write(
      `Telemetry reset complete.\n` +
      `  New installation ID: ${newId}\n` +
      `  Local buffer cleared.\n`,
    );
    return 0;
  } catch (err) {
    process.stderr.write(`Error: ${String(err)}\n`);
    return 1;
  }
}
