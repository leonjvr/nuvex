// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — V1.0: `sidjua delegation` commands
 *
 * CLI subcommands for inter-agent delegation monitoring.
 *   sidjua delegation status   — show all active (pending) delegations
 *   sidjua delegation history  — show all delegations including completed/failed
 */

import { existsSync }    from "node:fs";
import { join }          from "node:path";
import { randomUUID }    from "node:crypto";
import type { Command }  from "commander";
import { sendIpc }       from "../ipc-client.js";
import type { CLIRequest } from "../../orchestrator/orchestrator.js";
import { msg }           from "../../i18n/index.js";
import { createLogger }  from "../../core/logger.js";

const logger = createLogger("delegation-cmd");


async function getSocketPath(workDir: string): Promise<string | null> {
  const socketPath = join(workDir, ".system", "orchestrator.sock");
  return existsSync(socketPath) ? socketPath : null;
}

async function ipcRequest(
  workDir: string,
  command: CLIRequest["command"],
  payload: Record<string, unknown> = {},
): Promise<unknown> {
  const socketPath = await getSocketPath(workDir);
  if (socketPath === null) {
    process.stdout.write(msg("cli.delegation.err_no_server"));
    process.exit(1);
  }

  const req: CLIRequest = { command, payload, request_id: randomUUID() };
  const response = await sendIpc(socketPath, req);
  return response;
}


function pad(s: string, width: number): string {
  return s.length >= width ? s.slice(0, width) : s + " ".repeat(width - s.length);
}


export function registerDelegationCommands(program: Command): void {
  const delegCmd = program
    .command("delegation")
    .description("Monitor inter-agent delegation");

  // ── status ──────────────────────────────────────────────────────────────

  delegCmd
    .command("status")
    .description("Show active (pending) delegations")
    .option("--work-dir <dir>", "SIDJUA workspace directory", process.env["SIDJUA_WORK_DIR"] ?? process.cwd())
    .action(async (opts: { workDir: string }) => {
      try {
        const result = await ipcRequest(opts.workDir, "delegation_status", {});
        const delegations = (result as { delegations?: unknown[] }).delegations ?? [];

        process.stdout.write(msg("cli.delegation.status_header"));

        if (delegations.length === 0) {
          process.stdout.write(msg("cli.delegation.no_active"));
          process.exit(0);
        }

        process.stdout.write(
          pad("SUBTASK ID", 38) +
          pad("STATUS", 12) +
          pad("SOURCE", 20) +
          pad("TARGET", 20) +
          "DESCRIPTION\n",
        );
        process.stdout.write("─".repeat(110) + "\n");

        for (const d of delegations as Array<Record<string, unknown>>) {
          const subtaskId   = String(d["subtask_id"]   ?? "");
          const status      = String(d["status"]        ?? "");
          const source      = String((d["request"] as Record<string, unknown>)?.["source_agent_id"] ?? "");
          const target      = String((d["request"] as Record<string, unknown>)?.["target_agent_id"] ?? "");
          const description = String((d["request"] as Record<string, unknown>)?.["description"]     ?? "");

          process.stdout.write(
            pad(subtaskId,   38) +
            pad(status,      12) +
            pad(source,      20) +
            pad(target,      20) +
            description.slice(0, 40) + "\n",
          );
        }
      } catch (err: unknown) {
        logger.warn("delegation-cmd", "Status request failed", {
          metadata: { error: err instanceof Error ? err.message : String(err) },
        });
        process.stderr.write(String(err instanceof Error ? err.message : err) + "\n");
        process.exit(1);
      }
    });

  // ── history ─────────────────────────────────────────────────────────────

  delegCmd
    .command("history")
    .description("Show all delegations including completed and failed")
    .option("--work-dir <dir>", "SIDJUA workspace directory", process.env["SIDJUA_WORK_DIR"] ?? process.cwd())
    .option("--limit <n>", "Maximum number of entries to show", "50")
    .action(async (opts: { workDir: string; limit: string }) => {
      try {
        const result      = await ipcRequest(opts.workDir, "delegation_history", {});
        const delegations = (result as { delegations?: unknown[] }).delegations ?? [];
        const limit       = parseInt(opts.limit, 10) || 50;
        const entries     = delegations.slice(-limit);

        process.stdout.write(msg("cli.delegation.history_header"));

        if (entries.length === 0) {
          process.stdout.write(msg("cli.delegation.history_empty"));
          process.exit(0);
        }

        process.stdout.write(
          pad("SUBTASK ID", 38) +
          pad("STATUS", 12) +
          pad("SOURCE", 20) +
          pad("TARGET", 20) +
          "COMPLETED AT\n",
        );
        process.stdout.write("─".repeat(110) + "\n");

        for (const d of entries as Array<Record<string, unknown>>) {
          const subtaskId   = String(d["subtask_id"]   ?? "");
          const status      = String(d["status"]        ?? "");
          const source      = String((d["request"] as Record<string, unknown>)?.["source_agent_id"] ?? "");
          const target      = String((d["request"] as Record<string, unknown>)?.["target_agent_id"] ?? "");
          const completedAt = String(d["completed_at"] ?? "—");

          process.stdout.write(
            pad(subtaskId,   38) +
            pad(status,      12) +
            pad(source,      20) +
            pad(target,      20) +
            completedAt + "\n",
          );
        }
      } catch (err: unknown) {
        logger.warn("delegation-cmd", "History request failed", {
          metadata: { error: err instanceof Error ? err.message : String(err) },
        });
        process.stderr.write(String(err instanceof Error ? err.message : err) + "\n");
        process.exit(1);
      }
    });
}
