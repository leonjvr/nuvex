// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 10: `sidjua pause` command
 *
 * Pause the running orchestrator via IPC.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sendIpc } from "../ipc-client.js";
import { isProcessAlive } from "../utils/process.js";

export interface PauseCommandOptions {
  workDir: string;
}

export async function runPauseCommand(opts: PauseCommandOptions): Promise<number> {
  const systemDir = join(opts.workDir, ".system");
  const pidFile   = join(systemDir, "orchestrator.pid");
  const sockFile  = join(systemDir, "orchestrator.sock");

  if (!existsSync(pidFile)) {
    process.stderr.write("✗ Orchestrator not running. Use 'sidjua start' first.\n");
    return 1;
  }

  const pidText = readFileSync(pidFile, "utf8").trim();
  const pid     = parseInt(pidText, 10);

  if (!isProcessAlive(pid)) {
    process.stderr.write("✗ Orchestrator not running (stale PID file).\n");
    return 1;
  }

  if (!existsSync(sockFile)) {
    process.stderr.write("✗ IPC socket not available.\n");
    return 1;
  }

  process.stdout.write("▸ Pausing orchestrator...\n");

  try {
    const resp = await sendIpc(sockFile, {
      command:    "pause",
      payload:    {},
      request_id: crypto.randomUUID(),
    });

    if (!resp.success) {
      process.stderr.write(`✗ Failed to pause: ${resp.error ?? "unknown"}\n`);
      return 1;
    }

    process.stdout.write("✓ Orchestrator paused. No new tasks accepted.\n");
    return 0;
  } catch (err) {
    process.stderr.write(`✗ IPC error: ${String(err)}\n`);
    return 1;
  }
}
