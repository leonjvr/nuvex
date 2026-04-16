// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — V1.1: `sidjua messaging` commands
 *
 * CLI subcommands for messaging gateway management.
 *   sidjua messaging adapters             — list discovered adapter plugins
 *   sidjua messaging status               — show all instance statuses
 *   sidjua messaging status <instance-id> — show status of a specific instance
 *   sidjua messaging start <instance-id>  — start an instance
 *   sidjua messaging stop <instance-id>   — stop an instance
 *   sidjua messaging reload               — reload governance/messaging.yaml
 *   sidjua messaging map <instance-id> <platform-user-id> <sidjua-user-id> [role]
 *   sidjua messaging unmap <instance-id> <platform-user-id>
 *   sidjua messaging mappings [instance-id]
 *
 * Control operations route through IPC to the running orchestrator.
 */

import { existsSync } from "node:fs";
import { join }       from "node:path";
import type { Command } from "commander";
import { sendIpc }    from "../ipc-client.js";
import type { CLIRequest } from "../../orchestrator/orchestrator.js";
import { createLogger } from "../../core/logger.js";

const logger = createLogger("messaging-cmd");


async function getSocketPath(workDir: string): Promise<string | null> {
  const socketPath = join(workDir, ".system", "orchestrator.sock");
  return existsSync(socketPath) ? socketPath : null;
}

async function ipcRequest(
  workDir: string,
  command: CLIRequest["command"],
  payload: Record<string, unknown> = {},
): Promise<{ success: boolean; data: Record<string, unknown>; error?: string }> {
  const socketPath = await getSocketPath(workDir);
  if (socketPath === null) {
    return { success: false, data: {}, error: "Orchestrator not running (socket not found)" };
  }
  return sendIpc(socketPath, { command, payload, request_id: crypto.randomUUID() });
}


export function registerMessagingCommands(program: Command): void {
  const messagingCmd = program
    .command("messaging")
    .description("Manage messaging adapter instances");

  // ── sidjua messaging adapters ─────────────────────────────────────────────

  messagingCmd
    .command("adapters")
    .description("List discovered messaging adapter plugins")
    .option("--work-dir <path>", "Working directory", process.cwd())
    .option("--json", "Output as JSON", false)
    .action(async (opts: { workDir: string; json: boolean }) => {
      const res = await ipcRequest(opts.workDir, "messaging_adapters");
      if (!res.success) {
        logger.warn("messaging-cmd", res.error ?? "Unknown error", { metadata: {} });
        process.stdout.write(`Error: ${res.error ?? "Unknown error"}\n`);
        process.exit(1);
      }
      if (opts.json) {
        process.stdout.write(JSON.stringify(res.data, null, 2) + "\n");
      } else {
        const adapters = (res.data["adapters"] as Array<{ name: string; channel: string; capabilities: string[] }>) ?? [];
        if (adapters.length === 0) {
          process.stdout.write("No adapter plugins discovered.\n");
        } else {
          process.stdout.write("Discovered adapters:\n");
          for (const a of adapters) {
            process.stdout.write(`  ${a.name} (${a.channel}) — ${a.capabilities.join(", ")}\n`);
          }
        }
      }
      process.exit(0);
    });

  // ── sidjua messaging status [instance-id] ────────────────────────────────

  messagingCmd
    .command("status [instance-id]")
    .description("Show messaging instance status")
    .option("--work-dir <path>", "Working directory", process.cwd())
    .option("--json", "Output as JSON", false)
    .action(async (instanceId: string | undefined, opts: { workDir: string; json: boolean }) => {
      const payload = instanceId !== undefined ? { instance_id: instanceId } : {};
      const res = await ipcRequest(opts.workDir, "messaging_status", payload);
      if (!res.success) {
        process.stdout.write(`Error: ${res.error ?? "Unknown error"}\n`);
        process.exit(1);
      }
      if (opts.json) {
        process.stdout.write(JSON.stringify(res.data, null, 2) + "\n");
      } else {
        const instances = (res.data["instances"] as Array<{ instanceId: string; channel: string; healthy: boolean }>) ?? [];
        if (instances.length === 0) {
          process.stdout.write("No messaging instances running.\n");
        } else {
          for (const inst of instances) {
            const health = inst.healthy ? "healthy" : "unhealthy";
            process.stdout.write(`  ${inst.instanceId} [${inst.channel}] — ${health}\n`);
          }
        }
      }
      process.exit(0);
    });

  // ── sidjua messaging start <instance-id> ─────────────────────────────────

  messagingCmd
    .command("start <instance-id>")
    .description("Start a messaging adapter instance")
    .option("--work-dir <path>", "Working directory", process.cwd())
    .action(async (instanceId: string, opts: { workDir: string }) => {
      const res = await ipcRequest(opts.workDir, "messaging_start", { instance_id: instanceId });
      if (!res.success) {
        process.stdout.write(`Error: ${res.error ?? "Unknown error"}\n`);
        process.exit(1);
      }
      process.stdout.write(`Instance '${instanceId}' started.\n`);
      process.exit(0);
    });

  // ── sidjua messaging stop <instance-id> ──────────────────────────────────

  messagingCmd
    .command("stop <instance-id>")
    .description("Stop a messaging adapter instance")
    .option("--work-dir <path>", "Working directory", process.cwd())
    .action(async (instanceId: string, opts: { workDir: string }) => {
      const res = await ipcRequest(opts.workDir, "messaging_stop", { instance_id: instanceId });
      if (!res.success) {
        process.stdout.write(`Error: ${res.error ?? "Unknown error"}\n`);
        process.exit(1);
      }
      process.stdout.write(`Instance '${instanceId}' stopped.\n`);
      process.exit(0);
    });

  // ── sidjua messaging reload ───────────────────────────────────────────────

  messagingCmd
    .command("reload")
    .description("Reload messaging config from governance/messaging.yaml")
    .option("--work-dir <path>", "Working directory", process.cwd())
    .action(async (opts: { workDir: string }) => {
      const res = await ipcRequest(opts.workDir, "messaging_reload");
      if (!res.success) {
        process.stdout.write(`Error: ${res.error ?? "Unknown error"}\n`);
        process.exit(1);
      }
      process.stdout.write("Messaging config reloaded.\n");
      process.exit(0);
    });

  // ── sidjua messaging map <instance-id> <platform-user-id> <sidjua-user-id> [role] ──

  messagingCmd
    .command("map <instance-id> <platform-user-id> <sidjua-user-id> [role]")
    .description("Map a platform user to a SIDJUA user")
    .option("--work-dir <path>", "Working directory", process.cwd())
    .action(async (
      instanceId:  string,
      platformId:  string,
      sidjuaId:    string,
      role:        string | undefined,
      opts:        { workDir: string },
    ) => {
      const res = await ipcRequest(opts.workDir, "messaging_map", {
        instance_id:      instanceId,
        platform_user_id: platformId,
        sidjua_user_id:   sidjuaId,
        role:             role ?? "user",
      });
      if (!res.success) {
        process.stdout.write(`Error: ${res.error ?? "Unknown error"}\n`);
        process.exit(1);
      }
      process.stdout.write(`Mapped ${platformId} → ${sidjuaId} on instance '${instanceId}'.\n`);
      process.exit(0);
    });

  // ── sidjua messaging unmap <instance-id> <platform-user-id> ─────────────

  messagingCmd
    .command("unmap <instance-id> <platform-user-id>")
    .description("Remove a platform user mapping")
    .option("--work-dir <path>", "Working directory", process.cwd())
    .action(async (instanceId: string, platformId: string, opts: { workDir: string }) => {
      const res = await ipcRequest(opts.workDir, "messaging_unmap", {
        instance_id:      instanceId,
        platform_user_id: platformId,
      });
      if (!res.success) {
        process.stdout.write(`Error: ${res.error ?? "Unknown error"}\n`);
        process.exit(1);
      }
      process.stdout.write(`Removed mapping for ${platformId} on instance '${instanceId}'.\n`);
      process.exit(0);
    });

  // ── sidjua messaging mappings [instance-id] ───────────────────────────────

  messagingCmd
    .command("mappings [sidjua-user-id]")
    .description("List user mappings (optionally filter by SIDJUA user ID)")
    .option("--work-dir <path>", "Working directory", process.cwd())
    .option("--json", "Output as JSON", false)
    .action(async (sidjuaId: string | undefined, opts: { workDir: string; json: boolean }) => {
      const payload = sidjuaId !== undefined ? { sidjua_user_id: sidjuaId } : {};
      const res = await ipcRequest(opts.workDir, "messaging_mappings", payload);
      if (!res.success) {
        process.stdout.write(`Error: ${res.error ?? "Unknown error"}\n`);
        process.exit(1);
      }
      if (opts.json) {
        process.stdout.write(JSON.stringify(res.data, null, 2) + "\n");
      } else {
        const mappings = (res.data["mappings"] as Array<{
          instance_id: string; platform_user_id: string; sidjua_user_id: string; role: string;
        }>) ?? [];
        if (mappings.length === 0) {
          process.stdout.write("No mappings found.\n");
        } else {
          for (const m of mappings) {
            process.stdout.write(
              `  ${m.instance_id} / ${m.platform_user_id} → ${m.sidjua_user_id} [${m.role}]\n`,
            );
          }
        }
      }
      process.exit(0);
    });
}
