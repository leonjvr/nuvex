// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 10: `sidjua stop-orchestrator` command
 *
 * Graceful orchestrator shutdown via IPC or SIGTERM.
 */

import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { sendIpc } from "../ipc-client.js";
import { isProcessAlive } from "../utils/process.js";
import { createLogger } from "../../core/logger.js";

const logger = createLogger("stop-orchestrator");


export interface StopOrchestratorOptions {
  workDir: string;
  force:   boolean;
  timeout: number;
}


export async function runStopOrchestratorCommand(
  opts: StopOrchestratorOptions,
): Promise<number> {
  const systemDir = join(opts.workDir, ".system");
  const pidFile   = join(systemDir, "orchestrator.pid");
  const sockFile  = join(systemDir, "orchestrator.sock");

  if (!existsSync(pidFile)) {
    process.stderr.write("✗ Orchestrator not running.\n");
    return 1;
  }

  const pidText = readFileSync(pidFile, "utf8").trim();
  const pid     = parseInt(pidText, 10);

  if (isNaN(pid)) {
    process.stderr.write("✗ Invalid PID file.\n");
    return 1;
  }

  if (!isProcessAlive(pid)) {
    process.stderr.write("✗ Orchestrator not running (stale PID file).\n");
    try { unlinkSync(pidFile); } catch (e: unknown) { // cleanup-ignore: unlink of stale PID file is best-effort — file may already be removed
      void e; // cleanup-ignore
    }
    return 1;
  }

  process.stdout.write("▸ Stopping orchestrator...\n");

  if (opts.force) {
    // SIGKILL — immediate termination
    try {
      process.kill(pid, "SIGKILL");
      process.stdout.write("✓ Orchestrator killed.\n");
    } catch (err) {
      process.stderr.write(`✗ Failed to kill process: ${String(err)}\n`);
      return 1;
    }
  } else {
    // Graceful: IPC stop request → wait for process to exit
    process.stdout.write(`▸ Draining in-flight tasks (timeout: ${opts.timeout}s)...\n`);

    if (existsSync(sockFile)) {
      try {
        const resp = await sendIpc(sockFile, {
          command:    "stop",
          payload:    { timeout: opts.timeout },
          request_id: crypto.randomUUID(),
        });

        if (!resp.success) {
          process.stderr.write(`✗ IPC error: ${resp.error ?? "unknown"}\n`);
        }
      } catch (e: unknown) {
        logger.warn("stop-orchestrator", "IPC socket not available — falling back to SIGTERM", { metadata: { error: e instanceof Error ? e.message : String(e) } });
        // Socket not available — fall back to SIGTERM
        try { process.kill(pid, "SIGTERM"); } catch (e2: unknown) { // cleanup-ignore: SIGTERM send to already-dead process is best-effort
          void e2; // cleanup-ignore
        }
      }
    } else {
      // No socket — send SIGTERM
      try { process.kill(pid, "SIGTERM"); } catch (e: unknown) { // cleanup-ignore: SIGTERM send failure is best-effort — process may already be gone
        void e; // cleanup-ignore
      }
    }

    // Wait for process to exit
    const deadline = Date.now() + opts.timeout * 1000;
    while (Date.now() < deadline) {
      await sleep(200);
      if (!isProcessAlive(pid)) {
        // Process exited
        break;
      }
    }
  }

  // Re-check: only report success and clean up if process actually exited
  if (isProcessAlive(pid)) {
    process.stderr.write("✗ Orchestrator still running after timeout.\n");
    process.stderr.write("  Use 'sidjua shutdown --force' or kill manually.\n");
    // Do NOT delete PID/socket files — process is still running
    return 1;
  }

  // Clean up PID and socket files
  try { unlinkSync(pidFile);  } catch (e: unknown) { // cleanup-ignore: PID file removal is best-effort cleanup — file may already be removed
    void e; // cleanup-ignore
  }
  try { unlinkSync(sockFile); } catch (e: unknown) { // cleanup-ignore: socket file removal is best-effort cleanup — file may already be removed
    void e; // cleanup-ignore
  }

  process.stdout.write("✓ Orchestrator stopped.\n");
  return 0;
}


function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
