// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — `sidjua shutdown` command
 *
 * Graceful shutdown: drains in-flight tasks, writes agent checkpoints,
 * flushes the WAL, then stops all services. Verifies the process actually
 * exited before reporting success.
 */

import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join }                                  from "node:path";
import { sendIpc }                               from "../ipc-client.js";
import { isProcessAlive }                        from "../utils/process.js";
import { createLogger }                          from "../../core/logger.js";
import { msg }                                   from "../../i18n/index.js";

const logger = createLogger("shutdown");


export interface ShutdownCommandOptions {
  workDir: string;
  timeout: number;
  force:   boolean;
}


/**
 * Gracefully shut down SIDJUA.
 *
 * Returns 0 on clean shutdown, 1 if the process did not exit within timeout.
 */
export async function runShutdownCommand(opts: ShutdownCommandOptions): Promise<number> {
  const systemDir = join(opts.workDir, ".system");
  const pidFile   = join(systemDir, "orchestrator.pid");
  const sockFile  = join(systemDir, "orchestrator.sock");

  // ── Check running ────────────────────────────────────────────────────────

  if (!existsSync(pidFile)) {
    process.stderr.write(msg("cli.shutdown.not_running"));
    return 1;
  }

  const pidText = readFileSync(pidFile, "utf8").trim();
  const pid     = parseInt(pidText, 10);

  if (isNaN(pid) || !isProcessAlive(pid)) {
    process.stderr.write(msg("cli.shutdown.not_running"));
    // Clean up stale PID file
    try { unlinkSync(pidFile); } catch (_e) { /* cleanup-ignore */ }
    return 1;
  }

  // ── Send shutdown IPC ────────────────────────────────────────────────────

  process.stdout.write(msg("cli.shutdown.draining"));

  if (existsSync(sockFile)) {
    try {
      await sendIpc(
        sockFile,
        {
          command:    "shutdown",
          payload:    { drain_timeout: opts.timeout, force: opts.force },
          request_id: crypto.randomUUID(),
        },
        (opts.timeout + 5) * 1000,   // IPC wait slightly longer than drain timeout
      );
    } catch (e: unknown) {
      logger.warn("shutdown", "IPC socket unavailable — falling back to SIGTERM", {
        metadata: { error: e instanceof Error ? e.message : String(e) },
      });
      // Fall back to SIGTERM if socket not reachable
      try { process.kill(pid, "SIGTERM"); } catch (_e) { /* cleanup-ignore */ }
    }
  } else {
    try { process.kill(pid, "SIGTERM"); } catch (_e) { /* cleanup-ignore */ }
  }

  // ── Poll until process exits ─────────────────────────────────────────────

  const deadline = Date.now() + (opts.timeout + 5) * 1000;
  while (Date.now() < deadline) {
    await sleep(200);
    if (!isProcessAlive(pid)) break;
  }

  // ── Verify process actually exited (fix for stale success reporting) ─────

  if (isProcessAlive(pid)) {
    process.stderr.write(msg("cli.shutdown.failed"));
    // Do NOT delete PID/socket — process is still running
    return 1;
  }

  // ── Clean up files ───────────────────────────────────────────────────────

  try { unlinkSync(pidFile);  } catch (_e) { /* cleanup-ignore */ }
  try { unlinkSync(sockFile); } catch (_e) { /* cleanup-ignore */ }

  process.stdout.write(msg("cli.shutdown.complete"));
  return 0;
}


function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
