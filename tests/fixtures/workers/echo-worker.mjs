/**
 * SIDJUA — Test echo worker for process.test.ts
 *
 * A minimal ESM JavaScript worker that handles IPC messages from AgentProcess.
 * Used in integration tests that require actual subprocess spawning.
 *
 * Responds to: INIT, SHUTDOWN, STATUS_REQUEST, HEARTBEAT, PAUSE, RESUME
 * Sends: HEARTBEAT (on interval after INIT), STATUS_RESPONSE, HEARTBEAT_ACK
 */

let heartbeatTimer = null;
let agentId = "test-agent";
let startedAt = null;
let status = "IDLE";

process.on("message", async (msg) => {
  if (!msg || typeof msg.type !== "string") return;

  switch (msg.type) {
    case "INIT": {
      agentId = msg.definition?.id ?? "test-agent";
      startedAt = new Date().toISOString();
      status = "IDLE";

      const intervalMs = msg.definition?.heartbeat_interval_ms ?? 2000;

      // Start heartbeat loop
      heartbeatTimer = setInterval(() => {
        process.send({ type: "HEARTBEAT" });
      }, intervalMs);

      // Send immediate heartbeat to signal readiness
      process.send({ type: "HEARTBEAT" });

      // Send status response
      process.send({ type: "STATUS_RESPONSE", state: buildState() });
      break;
    }

    case "SHUTDOWN": {
      if (heartbeatTimer !== null) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      // Small delay to allow graceful cleanup
      if (msg.graceful) {
        await sleep(50);
      }
      process.exit(0);
      break;
    }

    case "STATUS_REQUEST": {
      process.send({ type: "STATUS_RESPONSE", state: buildState() });
      break;
    }

    case "HEARTBEAT": {
      process.send({ type: "HEARTBEAT_ACK" });
      break;
    }

    case "CHECKPOINT_REQUEST": {
      process.send({ type: "CHECKPOINT_SAVED", version: 1 });
      break;
    }

    case "PAUSE": {
      status = "PAUSED";
      break;
    }

    case "RESUME": {
      status = "IDLE";
      break;
    }

    default:
      // Unknown message type — ignore
      break;
  }
});

function buildState() {
  return {
    agent_id: agentId,
    status,
    pid: process.pid,
    started_at: startedAt,
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
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Signal readiness to parent
process.send({ type: "HEARTBEAT" });
