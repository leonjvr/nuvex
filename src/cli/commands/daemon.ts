// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — V1.1: `sidjua daemon` commands
 *
 * CLI subcommands for daemon lifecycle management.
 *   sidjua daemon status [agent-id]  — show daemon status (all or specific agent)
 *   sidjua daemon start <agent-id>   — start daemon loop for an agent
 *   sidjua daemon stop <agent-id>    — stop daemon loop for an agent
 *   sidjua daemon restart <agent-id> — restart daemon loop for an agent
 *
 * All control operations route through IPC to the running orchestrator.
 * Status uses IPC when orchestrator is reachable, falls back to a "not running"
 * report when the socket is unavailable.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import { sendIpc } from "../ipc-client.js";
import { createLogger } from "../../core/logger.js";
import type { DaemonStatus } from "../../agent-lifecycle/types.js";

const logger = createLogger("daemon-cmd");


export interface DaemonCommandOptions {
  workDir: string;
  json:    boolean;
}


/**
 * Register all `sidjua daemon` subcommands on the given Commander program.
 */
export function registerDaemonCommands(program: Command): void {
  const daemonCmd = program
    .command("daemon")
    .description("Manage agent daemon loops");

  // ── sidjua daemon status [agent-id] ──────────────────────────────────────

  daemonCmd
    .command("status [agent-id]")
    .description("Show daemon loop status (all agents or a specific one)")
    .option("--work-dir <path>", "Working directory", process.cwd())
    .option("--json",             "Output as JSON",    false)
    .action(async (agentId: string | undefined, opts: DaemonCommandOptions) => {
      const exitCode = await runDaemonStatusCommand({
        workDir: opts.workDir,
        json:    opts.json,
        ...(agentId !== undefined ? { agentId } : {}),
      });
      process.exit(exitCode);
    });

  // ── sidjua daemon start <agent-id> ───────────────────────────────────────

  daemonCmd
    .command("start <agent-id>")
    .description("Start the daemon loop for a specific agent")
    .option("--work-dir <path>", "Working directory", process.cwd())
    .action(async (agentId: string, opts: { workDir: string }) => {
      const exitCode = await runDaemonControlCommand("daemon_start", agentId, opts.workDir);
      process.exit(exitCode);
    });

  // ── sidjua daemon stop <agent-id> ────────────────────────────────────────

  daemonCmd
    .command("stop <agent-id>")
    .description("Stop the daemon loop for a specific agent")
    .option("--work-dir <path>", "Working directory", process.cwd())
    .action(async (agentId: string, opts: { workDir: string }) => {
      const exitCode = await runDaemonControlCommand("daemon_stop", agentId, opts.workDir);
      process.exit(exitCode);
    });

  // ── sidjua daemon restart <agent-id> ─────────────────────────────────────

  daemonCmd
    .command("restart <agent-id>")
    .description("Restart the daemon loop for a specific agent")
    .option("--work-dir <path>", "Working directory", process.cwd())
    .action(async (agentId: string, opts: { workDir: string }) => {
      const exitCode = await runDaemonControlCommand("daemon_restart", agentId, opts.workDir);
      process.exit(exitCode);
    });
}


/**
 * Display daemon status for all agents or a specific agent.
 */
export async function runDaemonStatusCommand(opts: {
  agentId?:  string;
  workDir:   string;
  json:      boolean;
}): Promise<number> {
  const sockFile = join(opts.workDir, ".system", "orchestrator.sock");

  if (!existsSync(sockFile)) {
    if (opts.json) {
      process.stdout.write(JSON.stringify({ daemons: [], orchestrator: "not_running" }) + "\n");
    } else {
      process.stderr.write("Orchestrator not running — no daemon status available.\n");
    }
    return 1;
  }

  try {
    const resp = await sendIpc(sockFile, {
      command:    "daemon_status",
      payload:    opts.agentId !== undefined ? { agent_id: opts.agentId } : {},
      request_id: crypto.randomUUID(),
    });

    if (!resp.success) {
      process.stderr.write(`Error: ${resp.error ?? "unknown"}\n`);
      return 1;
    }

    const daemons = resp.data["daemons"] as DaemonStatus[];

    if (opts.json) {
      process.stdout.write(JSON.stringify({ daemons }) + "\n");
      return 0;
    }

    if (daemons.length === 0) {
      process.stdout.write("No daemon loops running.\n");
      return 0;
    }

    process.stdout.write("DAEMON STATUS\n");
    process.stdout.write(
      "AGENT".padEnd(28) +
      "RUNNING".padEnd(10) +
      "COMPLETED".padEnd(12) +
      "FAILED".padEnd(10) +
      "HOURLY_COST\n",
    );
    process.stdout.write("─".repeat(74) + "\n");

    for (const d of daemons) {
      const running = d.running ? "yes" : "no";
      process.stdout.write(
        d.agent_id.padEnd(28) +
        running.padEnd(10) +
        String(d.tasks_completed).padEnd(12) +
        String(d.tasks_failed).padEnd(10) +
        `$${d.hourly_cost_usd.toFixed(4)}\n`,
      );
    }

    return 0;
  } catch (e: unknown) {
    logger.warn("daemon-cmd", "IPC call failed for daemon status", {
      metadata: { error: e instanceof Error ? e.message : String(e) },
    });
    process.stderr.write(`Error communicating with orchestrator: ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
}

/**
 * Send a daemon control command (start/stop/restart) via IPC.
 */
export async function runDaemonControlCommand(
  command: "daemon_start" | "daemon_stop" | "daemon_restart",
  agentId: string,
  workDir: string,
): Promise<number> {
  const sockFile = join(workDir, ".system", "orchestrator.sock");

  if (!existsSync(sockFile)) {
    process.stderr.write("Orchestrator not running.\n");
    return 1;
  }

  const verb = command === "daemon_start"
    ? "Starting"
    : command === "daemon_stop"
    ? "Stopping"
    : "Restarting";

  process.stdout.write(`▸ ${verb} daemon for agent: ${agentId}\n`);

  try {
    const resp = await sendIpc(sockFile, {
      command,
      payload:    { agent_id: agentId },
      request_id: crypto.randomUUID(),
    });

    if (!resp.success) {
      process.stderr.write(`✗ ${resp.error ?? "unknown error"}\n`);
      return 1;
    }

    const action = resp.data["action"] as string | undefined ?? "ok";
    process.stdout.write(`✓ ${action}\n`);
    return 0;
  } catch (e: unknown) {
    logger.warn("daemon-cmd", "IPC control command failed", {
      metadata: { command, agent_id: agentId, error: e instanceof Error ? e.message : String(e) },
    });
    process.stderr.write(`✗ ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
}
