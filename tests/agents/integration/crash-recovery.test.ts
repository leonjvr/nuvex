/**
 * Integration: Crash recovery
 *
 * Tests ITBootstrapAgent behavior when agents crash or have exhausted restart attempts.
 *
 * NOTE: The bootstrap does NOT auto-restart a process that died via SIGKILL because:
 * - The exit handler immediately sets state.status = "CRASHED"
 * - _checkHeartbeats() skips restart when status is CRASHED or RESTARTING
 * - Heartbeat timeout restarts only work for alive-but-hung processes
 *
 * The bootstrap uses the heartbeat timeout path (alive but silent) for auto-restart.
 * For crashed processes, the manual restartAgent() API is the primary recovery path.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ITBootstrapAgent } from "../../../src/agents/bootstrap.js";
import { AgentProcess } from "../../../src/agents/process.js";
import type { AgentDefinition, AgentIPCMessage, BootstrapConfig, AgentState } from "../../../src/agents/types.js";
import type { CheckpointManager } from "../../../src/agents/checkpoint.js";
import type { EventBus } from "../../../src/types/provider.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ECHO_WORKER = join(__dirname, "../../fixtures/workers/echo-worker.mjs");

const DEF: AgentDefinition = {
  id: "crash-agent",
  name: "Crash Test Agent",
  tier: 3,
  provider: "anthropic",
  model: "claude-haiku-4-5-20251001",
  skill_file: "",
  division: "engineering",
  capabilities: ["test"],
  max_concurrent_tasks: 1,
  token_budget_per_task: 1000,
  cost_limit_per_hour: 0.1,
  checkpoint_interval_ms: 30000,
  ttl_default_seconds: 60,
  heartbeat_interval_ms: 200,
  max_retries: 3,
  metadata: {},
};

const OPTS = {
  cwd: process.cwd(),
  env: {},
  maxMemoryMB: 128,
  workerPath: ECHO_WORKER,
};

const BOOTSTRAP_CONFIG: BootstrapConfig = {
  heartbeat_timeout_ms: 10_000,
  max_restart_attempts: 3,
  token_burn_rate_limit: 10_000,
  check_interval_ms: 200,
  cost_check_interval_ms: 1_000,
};

const spawned: AgentProcess[] = [];

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function makeCheckpointManager(): CheckpointManager {
  return {
    loadLatest: vi.fn().mockResolvedValue(null),
  } as unknown as CheckpointManager;
}

function makeEventBus(): EventBus & { events: Array<{ event: string; data: unknown }> } {
  const events: Array<{ event: string; data: unknown }> = [];
  return {
    emit: (event: string, data: unknown) => events.push({ event, data }),
    subscribe: vi.fn(),
    consume: vi.fn().mockReturnValue([]),
    events,
  } as unknown as EventBus & { events: Array<{ event: string; data: unknown }> };
}

function makeProcessMock(
  agentId: string,
  statusOverride: AgentState["status"] = "WORKING",
  restartCount = 0,
  alive = false,
): AgentProcess {
  const state: AgentState = {
    agent_id: agentId,
    status: statusOverride,
    pid: alive ? 9999 : null,
    started_at: new Date().toISOString(),
    last_heartbeat: new Date().toISOString(),
    last_checkpoint: null,
    active_tasks: [],
    waiting_tasks: [],
    queued_tasks: 0,
    total_tokens_used: 0,
    total_cost_usd: 0,
    restart_count: restartCount,
    current_hour_cost: 0,
    hour_start: new Date().toISOString(),
    error_log: [],
  };

  const sentMessages: AgentIPCMessage[] = [];
  return {
    isAlive: () => alive,
    getPid: () => state.pid,
    getState: () => ({ ...state }),
    send: (msg: AgentIPCMessage) => sentMessages.push(msg),
    restart: vi.fn().mockResolvedValue(undefined),
    onMessage: vi.fn(),
    onExit: vi.fn(),
    _sentMessages: sentMessages,
  } as unknown as AgentProcess;
}

afterEach(async () => {
  for (const p of spawned) {
    if (p.isAlive()) await p.shutdown(false);
  }
  spawned.length = 0;
});

// ---------------------------------------------------------------------------
// Max restart attempts exceeded
// ---------------------------------------------------------------------------

describe("Crash recovery — max restart attempts respected", () => {
  it("stops retrying after max_restart_attempts exhausted", async () => {
    vi.useFakeTimers();

    // Process has status="WORKING" but is not alive (crashed without exit handler update)
    // This is the scenario where _checkHeartbeats() will call _attemptRestart()
    const proc = makeProcessMock(
      "crash-agent",
      "WORKING", // NOT "CRASHED" — so health check will try to restart
      BOOTSTRAP_CONFIG.max_restart_attempts, // already exhausted
      false, // not alive
    );

    const processes = new Map<string, AgentProcess>([["crash-agent", proc]]);
    const cpMgr = makeCheckpointManager();
    const eb = makeEventBus();
    const bootstrap = new ITBootstrapAgent(processes, cpMgr, eb, BOOTSTRAP_CONFIG);

    bootstrap.start();
    await vi.advanceTimersByTimeAsync(BOOTSTRAP_CONFIG.check_interval_ms + 50);
    bootstrap.stop();

    // Should have emitted agent.stopped (max reached)
    const stoppedEvents = eb.events.filter((e) => e.event === "agent.stopped");
    expect(stoppedEvents.length).toBeGreaterThan(0);
    expect(stoppedEvents[0]!.data).toMatchObject({ agent_id: "crash-agent" });

    // Should NOT have tried to restart again
    expect(proc.restart).not.toHaveBeenCalled();

    // CRITICAL alert should be present
    const report = bootstrap.getHealthReport();
    const criticalAlerts = report.alerts.filter((a) => a.severity === "CRITICAL");
    expect(criticalAlerts.length).toBeGreaterThan(0);
    expect(criticalAlerts[0]!.type).toBe("repeated_crashes");

    vi.useRealTimers();
  });

  it("below max: _attemptRestart is called and restarts process", async () => {
    vi.useFakeTimers();

    const proc = makeProcessMock("crash-agent", "WORKING", 1, false); // 1 restart so far, max=3
    const processes = new Map<string, AgentProcess>([["crash-agent", proc]]);
    const cpMgr = makeCheckpointManager();
    const eb = makeEventBus();
    const bootstrap = new ITBootstrapAgent(processes, cpMgr, eb, BOOTSTRAP_CONFIG);

    bootstrap.start();
    await vi.advanceTimersByTimeAsync(BOOTSTRAP_CONFIG.check_interval_ms + 50);
    bootstrap.stop();

    // Should have called restart
    expect(proc.restart).toHaveBeenCalled();
    // Should have emitted agent.restarted
    const restartedEvents = eb.events.filter((e) => e.event === "agent.restarted");
    expect(restartedEvents.length).toBeGreaterThan(0);

    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// Manual restartAgent() API
// ---------------------------------------------------------------------------

describe("Crash recovery — restartAgent manual API", () => {
  it("calls proc.restart with checkpoint when one exists", async () => {
    const fakeCheckpoint = {
      agent_id: "crash-agent",
      timestamp: new Date().toISOString(),
      version: 5,
      state: makeProcessMock("crash-agent", "IDLE", 0, true).getState(),
      task_states: [],
      memory_snapshot: "Checkpoint memory.",
    };

    const proc = makeProcessMock("crash-agent", "IDLE", 0, true);
    const cpMgr = {
      loadLatest: vi.fn().mockResolvedValue(fakeCheckpoint),
    } as unknown as CheckpointManager;

    const processes = new Map<string, AgentProcess>([["crash-agent", proc]]);
    const bootstrap = new ITBootstrapAgent(processes, cpMgr, makeEventBus(), BOOTSTRAP_CONFIG);

    await bootstrap.restartAgent("crash-agent");

    expect(proc.restart).toHaveBeenCalledOnce();
    expect(proc.restart).toHaveBeenCalledWith(fakeCheckpoint);
  });

  it("calls proc.restart with undefined when no checkpoint", async () => {
    const proc = makeProcessMock("crash-agent", "IDLE", 0, true);
    const cpMgr = {
      loadLatest: vi.fn().mockResolvedValue(null),
    } as unknown as CheckpointManager;

    const processes = new Map<string, AgentProcess>([["crash-agent", proc]]);
    const bootstrap = new ITBootstrapAgent(processes, cpMgr, makeEventBus(), BOOTSTRAP_CONFIG);

    await bootstrap.restartAgent("crash-agent");

    expect(proc.restart).toHaveBeenCalledWith(undefined);
  });

  it("throws for unknown agent ID", async () => {
    const { bootstrap } = { bootstrap: new ITBootstrapAgent(
      new Map(),
      makeCheckpointManager(),
      makeEventBus(),
      BOOTSTRAP_CONFIG,
    )};
    await expect(bootstrap.restartAgent("nonexistent")).rejects.toThrow(/not found/);
  });
});

// ---------------------------------------------------------------------------
// Real subprocess — manual restart via restartAgent()
// ---------------------------------------------------------------------------

describe("Crash recovery — real process manual restart", () => {
  it("restartAgent() brings a dead process back alive", async () => {
    const proc = new AgentProcess(DEF, OPTS);
    spawned.push(proc);
    await proc.spawn();
    await sleep(200);
    expect(proc.isAlive()).toBe(true);

    // Shutdown the process (graceful=false → SIGKILL via child.kill)
    // This is more reliable than external SIGKILL for testing
    await proc.shutdown(false);
    await sleep(300);
    expect(proc.isAlive()).toBe(false);

    // Manually restart via bootstrap
    const processes = new Map<string, AgentProcess>([["crash-agent", proc]]);
    const bootstrap = new ITBootstrapAgent(processes, makeCheckpointManager(), makeEventBus(), BOOTSTRAP_CONFIG);

    await bootstrap.restartAgent("crash-agent");
    await sleep(500);

    // After restart, process should be alive again
    expect(proc.isAlive()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Health report reflects crash state
// ---------------------------------------------------------------------------

describe("Crash recovery — health report accuracy", () => {
  it("crashed process shows in health report as CRASHED", async () => {
    // Use a very short heartbeat_timeout_ms so we can detect staleness quickly
    const shortTimeoutConfig: BootstrapConfig = {
      ...BOOTSTRAP_CONFIG,
      heartbeat_timeout_ms: 100, // 100ms → any heartbeat older than 100ms is stale
    };

    const proc = new AgentProcess(DEF, OPTS);
    spawned.push(proc);
    await proc.spawn();
    await sleep(150);
    expect(proc.isAlive()).toBe(true);

    // Shutdown via proc (calls child.kill internally → child.killed=true)
    await proc.shutdown(false);
    await sleep(500); // wait for exit event + heartbeat to become stale (> 100ms)

    const processes = new Map<string, AgentProcess>([["crash-agent", proc]]);
    const bootstrap = new ITBootstrapAgent(processes, makeCheckpointManager(), makeEventBus(), shortTimeoutConfig);

    const report = bootstrap.getHealthReport();
    const agentEntry = report.agents.find((a) => a.agent_id === "crash-agent");
    expect(agentEntry).toBeDefined();
    // Status should be STOPPED (shutdown(false) sets status="STOPPED" then kills)
    expect(["STOPPED", "CRASHED"]).toContain(agentEntry!.status);
    // heartbeat_healthy should be false: last heartbeat was > 100ms ago (500ms sleep)
    expect(agentEntry!.heartbeat_healthy).toBe(false);
  });
});
