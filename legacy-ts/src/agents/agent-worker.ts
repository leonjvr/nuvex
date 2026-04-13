// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 8: Agent Worker (subprocess entry point)
 *
 * This file runs in the child process spawned by AgentProcess.spawn().
 * It receives configuration via IPC INIT message, initializes AgentLoop,
 * and manages the heartbeat interval.
 *
 * IPC message flow:
 *   Parent → us:  INIT, PAUSE, RESUME, SHUTDOWN, CHECKPOINT_REQUEST, STATUS_REQUEST
 *   Us → parent:  HEARTBEAT, HEARTBEAT_ACK, CHECKPOINT_SAVED, STATUS_RESPONSE, COST_UPDATE
 *
 * NOTE: This file is the compiled subprocess entry point.
 * In production: dist/agents/agent-worker.js
 * In tests: either mocked or replaced with echo-worker.mjs fixture.
 */

// This is a standalone entry point — no top-level exports.
// It only executes side effects when run as main process.

import type { AgentIPCMessage, AgentDefinition, Checkpoint } from "./types.js";


let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let definition: AgentDefinition | null = null;
let isRunning = false;


process.on("message", async (raw: unknown) => {
  const msg = raw as AgentIPCMessage;

  switch (msg.type) {
    case "INIT":
      await handleInit(msg.definition, msg.checkpoint);
      break;

    case "PAUSE":
      // The AgentLoop handles pause internally via its own message listener
      // Here we just acknowledge it's received
      break;

    case "RESUME":
      // Same: AgentLoop handles internally
      break;

    case "SHUTDOWN": {
      const graceful = msg.graceful;
      if (graceful) {
        // Signal loop to stop gracefully (it will finish current task)
        isRunning = false;
        // Give it a moment to finish
        await sleep(1000);
      }
      if (heartbeatTimer !== null) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      process.exit(0);
      break;
    }

    case "CHECKPOINT_REQUEST":
      // The AgentLoop handles this; we acknowledge
      sendToParent({ type: "CHECKPOINT_SAVED", version: 1 });
      break;

    case "STATUS_REQUEST":
      // Send current state back to parent
      // In a full implementation, AgentLoop would provide the state
      sendToParent({
        type: "STATUS_RESPONSE",
        state: {
          agent_id: definition?.id ?? "unknown",
          status: isRunning ? "WORKING" : "IDLE",
          pid: process.pid,
          started_at: new Date().toISOString(),
          last_heartbeat: new Date().toISOString(),
          last_checkpoint: null,
          active_tasks: [],
          waiting_tasks: [],
          queued_tasks: 0,
          total_tokens_used: 0,
          total_cost_usd: 0,
          restart_count: 0,
          current_hour_cost: 0,
          hour_start: new Date().toISOString(),
          error_log: [],
        },
      });
      break;

    case "HEARTBEAT":
      sendToParent({ type: "HEARTBEAT_ACK" });
      break;

    case "HYGIENE_REQUEST":
      // In a full implementation, the AgentLoop.handleHygieneRequest(msg.config) is called here
      // and the result is sent back as HYGIENE_RESULT.
      // Phase 9 Orchestrator wires up MemoryManager + AgentLoop for full hygiene support.
      break;

    default:
      break;
  }
});


async function handleInit(def: AgentDefinition, _checkpoint?: Checkpoint): Promise<void> {
  definition = def;
  isRunning = true;

  // Start heartbeat
  const intervalMs = def.heartbeat_interval_ms;
  heartbeatTimer = setInterval(() => {
    sendToParent({ type: "HEARTBEAT" });
  }, intervalMs);

  // Send initial heartbeat immediately
  sendToParent({ type: "HEARTBEAT" });

  // In a full implementation, we would initialize AgentLoop here:
  //
  // const loop = new AgentLoop(def, providers, logger);
  // await loop.start();
  //
  // For V1, the subprocess architecture is defined but full dependency
  // injection (database paths, provider keys, etc.) requires Phase 9
  // Orchestrator to wire everything together. Phase 8 establishes the
  // IPC protocol and subprocess isolation contract.
  //
  // Integration tests for subprocess use echo-worker.mjs fixture.

  // Keep alive
  await keepAlive();
}


function sendToParent(msg: AgentIPCMessage): void {
  if (process.send !== undefined) {
    process.send(msg);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** Keep the process alive until SHUTDOWN is received. */
function keepAlive(): Promise<void> {
  return new Promise<void>((resolve) => {
    const check = setInterval(() => {
      if (!isRunning) {
        clearInterval(check);
        resolve();
      }
    }, 500);
  });
}


process.on("uncaughtException", (err) => {
  process.stderr.write(`[agent-worker] Uncaught exception: ${err.message}\n`);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  process.stderr.write(`[agent-worker] Unhandled rejection: ${String(reason)}\n`);
  process.exit(1);
});
