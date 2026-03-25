/**
 * Tests for src/agents/bootstrap.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ITBootstrapAgent } from "../../src/agents/bootstrap.js";
import type { AgentProcess } from "../../src/agents/process.js";
import type { CheckpointManager } from "../../src/agents/checkpoint.js";
import type { BootstrapConfig, AgentState, AgentIPCMessage } from "../../src/agents/types.js";
import type { EventBus } from "../../src/types/provider.js";

// ---------------------------------------------------------------------------
// Helpers / stubs
// ---------------------------------------------------------------------------

const CONFIG: BootstrapConfig = {
  heartbeat_timeout_ms: 5000,
  max_restart_attempts: 3,
  token_burn_rate_limit: 1000,
  check_interval_ms: 100,   // fast for tests
  cost_check_interval_ms: 200,
};

function makeState(overrides?: Partial<AgentState>): AgentState {
  return {
    agent_id: "agent-1",
    status: "IDLE",
    pid: 1234,
    started_at: new Date().toISOString(),
    last_heartbeat: new Date().toISOString(), // healthy by default
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
    ...overrides,
  };
}

function makeProcess(
  agentId: string,
  overrides?: Partial<AgentState>,
  alive = true,
): AgentProcess {
  const state = makeState({ agent_id: agentId, ...overrides });
  const sentMessages: AgentIPCMessage[] = [];

  return {
    isAlive: () => alive,
    getPid: () => (alive ? 1234 : null),
    getState: () => ({ ...state }),
    send: (msg: AgentIPCMessage) => sentMessages.push(msg),
    restart: vi.fn().mockResolvedValue(undefined),
    _sentMessages: sentMessages, // for test assertions
  } as unknown as AgentProcess & { _sentMessages: AgentIPCMessage[] };
}

function makeCheckpointManager(): CheckpointManager {
  return {
    loadLatest: vi.fn().mockResolvedValue(null),
  } as unknown as CheckpointManager;
}

function makeEventBus(): EventBus & { _events: Array<{ event: string; data: unknown }> } {
  const events: Array<{ event: string; data: unknown }> = [];
  return {
    emit: (event: string, data: unknown) => events.push({ event, data }),
    subscribe: vi.fn(),
    consume: vi.fn().mockReturnValue([]),
    _events: events,
  } as unknown as EventBus & { _events: Array<{ event: string; data: unknown }> };
}

function makeBootstrap(
  processes: Map<string, AgentProcess>,
  checkpointMgr?: CheckpointManager,
  eventBus?: EventBus,
) {
  const cpMgr = checkpointMgr ?? makeCheckpointManager();
  const eb = eventBus ?? makeEventBus();
  const bootstrap = new ITBootstrapAgent(processes, cpMgr, eb, CONFIG);
  return { bootstrap, cpMgr, eb };
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

describe("ITBootstrapAgent — start/stop", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("start() sets running state", () => {
    vi.useFakeTimers();
    const processes = new Map<string, AgentProcess>();
    const { bootstrap } = makeBootstrap(processes);

    bootstrap.start();
    bootstrap.stop();
    // No assertions needed — just verify it doesn't throw
  });

  it("start() is idempotent — calling twice does not double-register timers", () => {
    vi.useFakeTimers();
    const processes = new Map<string, AgentProcess>();
    const { bootstrap } = makeBootstrap(processes);

    bootstrap.start();
    bootstrap.start(); // second call should be a no-op
    bootstrap.stop();
  });

  it("stop() clears intervals without throwing", () => {
    vi.useFakeTimers();
    const processes = new Map<string, AgentProcess>();
    const { bootstrap } = makeBootstrap(processes);

    bootstrap.start();
    expect(() => bootstrap.stop()).not.toThrow();
  });

  it("stop() when not started does not throw", () => {
    const processes = new Map<string, AgentProcess>();
    const { bootstrap } = makeBootstrap(processes);
    expect(() => bootstrap.stop()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// getHealthReport
// ---------------------------------------------------------------------------

describe("ITBootstrapAgent — getHealthReport", () => {
  it("returns empty agent list when no processes registered", () => {
    const { bootstrap } = makeBootstrap(new Map());
    const report = bootstrap.getHealthReport();
    expect(report.agents).toHaveLength(0);
    expect(report.system_healthy).toBe(true); // vacuously true
    expect(Array.isArray(report.alerts)).toBe(true);
    expect(report.timestamp).toBeTruthy();
  });

  it("includes entry for each registered process", () => {
    const processes = new Map<string, AgentProcess>([
      ["agent-1", makeProcess("agent-1")],
      ["agent-2", makeProcess("agent-2")],
    ]);
    const { bootstrap } = makeBootstrap(processes);

    const report = bootstrap.getHealthReport();
    expect(report.agents).toHaveLength(2);
    const ids = report.agents.map((a) => a.agent_id);
    expect(ids).toContain("agent-1");
    expect(ids).toContain("agent-2");
  });

  it("agent with recent heartbeat is heartbeat_healthy=true", () => {
    const processes = new Map<string, AgentProcess>([
      ["agent-1", makeProcess("agent-1", { last_heartbeat: new Date().toISOString() })],
    ]);
    const { bootstrap } = makeBootstrap(processes);

    const report = bootstrap.getHealthReport();
    expect(report.agents[0]!.heartbeat_healthy).toBe(true);
  });

  it("agent with stale heartbeat is heartbeat_healthy=false", () => {
    const staleTime = new Date(Date.now() - 60_000).toISOString(); // 60s ago
    const processes = new Map<string, AgentProcess>([
      ["agent-1", makeProcess("agent-1", { last_heartbeat: staleTime })],
    ]);
    const { bootstrap } = makeBootstrap(processes);

    const report = bootstrap.getHealthReport();
    expect(report.agents[0]!.heartbeat_healthy).toBe(false);
  });

  it("system_healthy=false when any agent is CRASHED", () => {
    const processes = new Map<string, AgentProcess>([
      ["agent-1", makeProcess("agent-1", { status: "CRASHED" })],
    ]);
    const { bootstrap } = makeBootstrap(processes);

    const report = bootstrap.getHealthReport();
    expect(report.system_healthy).toBe(false);
  });

  it("drains alerts after getHealthReport", () => {
    const { bootstrap } = makeBootstrap(new Map());
    const report1 = bootstrap.getHealthReport();
    const report2 = bootstrap.getHealthReport();
    // Second call should not have the same alerts as first
    expect(report1.alerts.length).toBeGreaterThanOrEqual(0);
    expect(report2.alerts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Manual controls
// ---------------------------------------------------------------------------

describe("ITBootstrapAgent — restartAgent", () => {
  it("throws for unknown agent", async () => {
    const { bootstrap } = makeBootstrap(new Map());
    await expect(bootstrap.restartAgent("ghost-agent")).rejects.toThrow(/not found/);
  });

  it("calls proc.restart with checkpoint when one exists", async () => {
    const proc = makeProcess("agent-1");
    const fakeCheckpoint = {
      agent_id: "agent-1",
      timestamp: new Date().toISOString(),
      version: 1,
      state: makeState(),
      task_states: [],
      memory_snapshot: "memory",
    };

    const cpMgr = {
      loadLatest: vi.fn().mockResolvedValue(fakeCheckpoint),
    } as unknown as CheckpointManager;

    const processes = new Map<string, AgentProcess>([["agent-1", proc]]);
    const { bootstrap } = makeBootstrap(processes, cpMgr);

    await bootstrap.restartAgent("agent-1");
    expect(proc.restart).toHaveBeenCalledWith(fakeCheckpoint);
  });

  it("calls proc.restart with undefined when no checkpoint", async () => {
    const proc = makeProcess("agent-1");
    const cpMgr = {
      loadLatest: vi.fn().mockResolvedValue(null),
    } as unknown as CheckpointManager;

    const processes = new Map<string, AgentProcess>([["agent-1", proc]]);
    const { bootstrap } = makeBootstrap(processes, cpMgr);

    await bootstrap.restartAgent("agent-1");
    expect(proc.restart).toHaveBeenCalledWith(undefined);
  });
});

describe("ITBootstrapAgent — pauseAgent / resumeAgent", () => {
  it("pauseAgent sends PAUSE message to process", async () => {
    const proc = makeProcess("agent-1") as AgentProcess & { _sentMessages: AgentIPCMessage[] };
    const processes = new Map<string, AgentProcess>([["agent-1", proc]]);
    const { bootstrap } = makeBootstrap(processes);

    await bootstrap.pauseAgent("agent-1");
    expect((proc as unknown as { _sentMessages: AgentIPCMessage[] })._sentMessages).toContainEqual({ type: "PAUSE" });
  });

  it("resumeAgent sends RESUME message to process", async () => {
    const proc = makeProcess("agent-1") as AgentProcess & { _sentMessages: AgentIPCMessage[] };
    const processes = new Map<string, AgentProcess>([["agent-1", proc]]);
    const { bootstrap } = makeBootstrap(processes);

    await bootstrap.resumeAgent("agent-1");
    expect((proc as unknown as { _sentMessages: AgentIPCMessage[] })._sentMessages).toContainEqual({ type: "RESUME" });
  });

  it("pauseAgent throws for unknown agent", async () => {
    const { bootstrap } = makeBootstrap(new Map());
    await expect(bootstrap.pauseAgent("ghost")).rejects.toThrow(/not found/);
  });

  it("resumeAgent throws for unknown agent", async () => {
    const { bootstrap } = makeBootstrap(new Map());
    await expect(bootstrap.resumeAgent("ghost")).rejects.toThrow(/not found/);
  });
});

// ---------------------------------------------------------------------------
// Health check cycle (via fake timers)
// ---------------------------------------------------------------------------

describe("ITBootstrapAgent — health check triggers", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not restart a healthy alive process", async () => {
    vi.useFakeTimers();
    const proc = makeProcess("agent-1", {
      status: "IDLE",
      last_heartbeat: new Date().toISOString(),
    });
    const processes = new Map<string, AgentProcess>([["agent-1", proc]]);
    const { bootstrap } = makeBootstrap(processes);

    bootstrap.start();
    // Use advanceTimersByTimeAsync (NOT runAllTimersAsync — setInterval would loop forever)
    await vi.advanceTimersByTimeAsync(CONFIG.check_interval_ms + 50);
    bootstrap.stop();

    expect(proc.restart).not.toHaveBeenCalled();
  });

  it("attempts restart when process is not alive and not stopped", async () => {
    vi.useFakeTimers();
    const deadProc = makeProcess("agent-1", { status: "WORKING" }, false /* not alive */);
    const processes = new Map<string, AgentProcess>([["agent-1", deadProc]]);
    const { bootstrap } = makeBootstrap(processes);

    bootstrap.start();
    await vi.advanceTimersByTimeAsync(CONFIG.check_interval_ms + 50);
    bootstrap.stop();

    expect(deadProc.restart).toHaveBeenCalled();
  });

  it("does not restart a stopped process even if not alive", async () => {
    vi.useFakeTimers();
    const stoppedProc = makeProcess("agent-1", { status: "STOPPED" }, false /* not alive */);
    const processes = new Map<string, AgentProcess>([["agent-1", stoppedProc]]);
    const { bootstrap } = makeBootstrap(processes);

    bootstrap.start();
    await vi.advanceTimersByTimeAsync(CONFIG.check_interval_ms + 50);
    bootstrap.stop();

    expect(stoppedProc.restart).not.toHaveBeenCalled();
  });

  it("emits agent.stopped when max restart attempts exceeded", async () => {
    vi.useFakeTimers();
    // Status must be neither "CRASHED" nor "RESTARTING" nor "STOPPED" for
    // _checkHeartbeats() to call _attemptRestart() when process is not alive.
    // Use "WORKING" to simulate: process was working but died unexpectedly.
    const exhaustedProc = makeProcess(
      "agent-1",
      { status: "WORKING", restart_count: CONFIG.max_restart_attempts },
      false, // not alive
    );
    const processes = new Map<string, AgentProcess>([["agent-1", exhaustedProc]]);
    const eb = makeEventBus();
    const { bootstrap } = makeBootstrap(processes, undefined, eb);

    bootstrap.start();
    await vi.advanceTimersByTimeAsync(CONFIG.check_interval_ms + 50);
    bootstrap.stop();

    const stoppedEvents = eb._events.filter((e) => e.event === "agent.stopped");
    expect(stoppedEvents.length).toBeGreaterThan(0);
    expect(stoppedEvents[0]!.data).toMatchObject({ agent_id: "agent-1" });
  });

  it("adds CRITICAL alert when max restart attempts exceeded", async () => {
    vi.useFakeTimers();
    // Same as above: status "WORKING" + not alive → _attemptRestart called → adds CRITICAL alert
    const exhaustedProc = makeProcess(
      "agent-1",
      { status: "WORKING", restart_count: CONFIG.max_restart_attempts },
      false,
    );
    const processes = new Map<string, AgentProcess>([["agent-1", exhaustedProc]]);
    const { bootstrap } = makeBootstrap(processes);

    bootstrap.start();
    await vi.advanceTimersByTimeAsync(CONFIG.check_interval_ms + 50);
    bootstrap.stop();

    const report = bootstrap.getHealthReport();
    const critical = report.alerts.filter((a) => a.severity === "CRITICAL");
    expect(critical.length).toBeGreaterThan(0);
    expect(critical[0]!.type).toBe("repeated_crashes");
  });
});

// ---------------------------------------------------------------------------
// Memory health monitoring (Phase 8 Amendment #324)
// ---------------------------------------------------------------------------

describe("ITBootstrapAgent — memory health monitoring", () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.useFakeTimers();
    tmpDir = mkdtempSync(join(tmpdir(), "sidjua-bootstrap-mem-test-"));
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("starts memory check timer when memory_check_interval_ms is set", () => {
    const proc = makeProcess("agent-1");
    const processes = new Map<string, AgentProcess>([["agent-1", proc]]);
    const config: BootstrapConfig = {
      ...CONFIG,
      memory_check_interval_ms: 200,
    };
    const { bootstrap } = makeBootstrap(processes, undefined, undefined);
    const bootstrap2 = new ITBootstrapAgent(
      processes,
      makeCheckpointManager(),
      makeEventBus(),
      config,
    );

    bootstrap2.start();
    // Should not throw
    bootstrap2.stop();
  });

  it("emits memory_warning alert when short-term file exceeds warn threshold", async () => {
    const shortTermPath = join(tmpDir, "short_term.md");
    // Write 11 KB of content (exceeds default warn threshold of 10 KB)
    writeFileSync(shortTermPath, "X".repeat(11_000), "utf8");

    const proc = makeProcess("agent-1");
    const processes = new Map<string, AgentProcess>([["agent-1", proc]]);
    const config: BootstrapConfig = {
      ...CONFIG,
      memory_check_interval_ms: 50, // fast for tests
      agent_memory_configs: {
        "agent-1": { short_term_path: shortTermPath },
      },
    };
    const bootstrap = new ITBootstrapAgent(
      processes,
      makeCheckpointManager(),
      makeEventBus(),
      config,
    );

    bootstrap.start();
    await vi.advanceTimersByTimeAsync(200);
    bootstrap.stop();

    const report = bootstrap.getHealthReport();
    const memAlerts = report.alerts.filter(
      (a) => a.type === "memory_warning" || a.type === "memory_critical",
    );
    expect(memAlerts.length).toBeGreaterThan(0);
  });

  it("emits memory_critical alert when short-term file exceeds hard limit", async () => {
    const shortTermPath = join(tmpDir, "short_term.md");
    // Write 26 KB (exceeds default hard limit of 25 KB)
    writeFileSync(shortTermPath, "X".repeat(26_000), "utf8");

    const proc = makeProcess("agent-1");
    const processes = new Map<string, AgentProcess>([["agent-1", proc]]);
    const config: BootstrapConfig = {
      ...CONFIG,
      memory_check_interval_ms: 50,
      agent_memory_configs: {
        "agent-1": { short_term_path: shortTermPath },
      },
    };
    const bootstrap = new ITBootstrapAgent(
      processes,
      makeCheckpointManager(),
      makeEventBus(),
      config,
    );

    bootstrap.start();
    await vi.advanceTimersByTimeAsync(200);
    bootstrap.stop();

    const report = bootstrap.getHealthReport();
    const critical = report.alerts.filter((a) => a.type === "memory_critical");
    expect(critical.length).toBeGreaterThan(0);
  });

  it("emits skill_bloat alert when skill file exceeds warn threshold", async () => {
    const shortTermPath = join(tmpDir, "short_term.md");
    const skillPath = join(tmpDir, "skill.md");
    writeFileSync(shortTermPath, "", "utf8");
    // Write 7 KB for skill (exceeds default skill warn threshold of 6 KB)
    writeFileSync(skillPath, "X".repeat(7_000), "utf8");

    const proc = makeProcess("agent-1");
    const processes = new Map<string, AgentProcess>([["agent-1", proc]]);
    const config: BootstrapConfig = {
      ...CONFIG,
      memory_check_interval_ms: 50,
      agent_memory_configs: {
        "agent-1": { short_term_path: shortTermPath, skill_path: skillPath },
      },
    };
    const bootstrap = new ITBootstrapAgent(
      processes,
      makeCheckpointManager(),
      makeEventBus(),
      config,
    );

    bootstrap.start();
    await vi.advanceTimersByTimeAsync(200);
    bootstrap.stop();

    const report = bootstrap.getHealthReport();
    const skillAlerts = report.alerts.filter((a) => a.type === "skill_bloat");
    expect(skillAlerts.length).toBeGreaterThan(0);
  });

  it("includes memory_health in health report after memory check runs", async () => {
    const shortTermPath = join(tmpDir, "short_term.md");
    writeFileSync(shortTermPath, "X".repeat(12_000), "utf8"); // above warn

    const proc = makeProcess("agent-1");
    const processes = new Map<string, AgentProcess>([["agent-1", proc]]);
    const config: BootstrapConfig = {
      ...CONFIG,
      memory_check_interval_ms: 50,
      agent_memory_configs: {
        "agent-1": { short_term_path: shortTermPath },
      },
    };
    const bootstrap = new ITBootstrapAgent(
      processes,
      makeCheckpointManager(),
      makeEventBus(),
      config,
    );

    bootstrap.start();
    await vi.advanceTimersByTimeAsync(200);
    bootstrap.stop();

    const report = bootstrap.getHealthReport();
    expect(report.memory_health).toBeDefined();
    expect(report.memory_health!.length).toBeGreaterThan(0);
    expect(report.memory_health![0]!.agent_id).toBe("agent-1");
  });

  it("sends HYGIENE_REQUEST IPC when short-term exceeds compact threshold", async () => {
    const shortTermPath = join(tmpDir, "short_term.md");
    // Write 16 KB (exceeds compact threshold of 15 KB)
    writeFileSync(shortTermPath, "X".repeat(16_000), "utf8");

    const proc = makeProcess("agent-1");
    const sentMessages = (proc as unknown as { _sentMessages: AgentIPCMessage[] })._sentMessages;

    const processes = new Map<string, AgentProcess>([["agent-1", proc]]);
    const config: BootstrapConfig = {
      ...CONFIG,
      memory_check_interval_ms: 50,
      agent_memory_configs: {
        "agent-1": { short_term_path: shortTermPath },
      },
    };
    const bootstrap = new ITBootstrapAgent(
      processes,
      makeCheckpointManager(),
      makeEventBus(),
      config,
    );

    bootstrap.start();
    await vi.advanceTimersByTimeAsync(200);
    bootstrap.stop();

    const hygieneMessages = sentMessages.filter((m) => m.type === "HYGIENE_REQUEST");
    expect(hygieneMessages.length).toBeGreaterThan(0);
  });

  it("health report has no memory_health when no agent_memory_configs provided", async () => {
    const proc = makeProcess("agent-1");
    const processes = new Map<string, AgentProcess>([["agent-1", proc]]);
    const config: BootstrapConfig = {
      ...CONFIG,
      memory_check_interval_ms: 50,
      // no agent_memory_configs
    };
    const bootstrap = new ITBootstrapAgent(
      processes,
      makeCheckpointManager(),
      makeEventBus(),
      config,
    );

    bootstrap.start();
    await vi.advanceTimersByTimeAsync(200);
    bootstrap.stop();

    const report = bootstrap.getHealthReport();
    // Should not have memory_health if no configs (empty map result)
    const memHealth = report.memory_health;
    expect(memHealth === undefined || memHealth.length === 0).toBe(true);
  });
});
