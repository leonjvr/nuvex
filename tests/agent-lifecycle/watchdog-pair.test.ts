/**
 * V1.1 — WatchdogPair unit tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  WatchdogPair,
  NULL_NOTIFIER,
  type NotificationService,
  type RestartAction,
} from "../../src/agent-lifecycle/watchdog-pair.js";
import type { AgentDaemonManager } from "../../src/agent-lifecycle/daemon-manager.js";
import type { ProcessSupervisor } from "../../src/agent-lifecycle/supervisor/process-supervisor.js";
import type { AgentHealthStatus } from "../../src/agent-lifecycle/supervisor/process-supervisor.js";
import type { DaemonStatus } from "../../src/agent-lifecycle/types.js";
import type { WatchdogAgentConfig } from "../../src/agent-lifecycle/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WATCHDOG_A = "it-admin";
const WATCHDOG_B = "guide";

const DEFAULT_CONFIG: Required<WatchdogAgentConfig> = {
  watchdog_a:                 WATCHDOG_A,
  watchdog_b:                 WATCHDOG_B,
  heartbeat_interval_ms:      10_000,
  missed_heartbeat_threshold: 3,
  grace_period_ms:            15_000,
  restart_budget_per_hour:    10,
};

function makeStatus(agentId: string): DaemonStatus {
  return {
    agent_id:        agentId,
    running:         true,
    tasks_completed: 0,
    tasks_failed:    0,
    last_task_at:    null,
    started_at:      new Date().toISOString(),
    hourly_cost_usd: 0,
  };
}

function makeHealth(
  state: AgentHealthStatus["state"] = "HEALTHY",
): AgentHealthStatus {
  return {
    agent_id:          "agent-x",
    state,
    last_heartbeat:    null,
    consecutive_missed: 0,
    total_crashes:     0,
    restart_attempts:  0,
    circuit_open:      state === "CIRCUIT_OPEN",
    circuit_opened_at: null,
  };
}

function makeSupervisor(
  healthMap: Record<string, AgentHealthStatus["state"]> = {},
): ProcessSupervisor {
  return {
    recordHeartbeat: vi.fn(),
    getAgentStatus:  vi.fn().mockImplementation((id: string) => {
      const state = healthMap[id] ?? "HEALTHY";
      return makeHealth(state);
    }),
  } as unknown as ProcessSupervisor;
}

function makeDaemonManager(
  agentIds:       string[],
  restartSuccess: boolean = true,
): AgentDaemonManager {
  return {
    getAllStatuses: vi.fn().mockReturnValue(agentIds.map(makeStatus)),
    restartAgent:  vi.fn().mockResolvedValue(restartSuccess),
    getStatus:     vi.fn(),
  } as unknown as AgentDaemonManager;
}

function makeNotifier(): NotificationService {
  return { notify: vi.fn().mockResolvedValue(undefined) };
}

function makeWatchdog(opts: {
  agents?:        string[];
  healthMap?:     Record<string, AgentHealthStatus["state"]>;
  config?:        Partial<WatchdogAgentConfig>;
  notifier?:      NotificationService;
  restartSuccess?: boolean;
} = {}) {
  const {
    agents        = ["agent-1", WATCHDOG_A, WATCHDOG_B],
    healthMap     = {},
    config        = {},
    notifier      = NULL_NOTIFIER,
    restartSuccess = true,
  } = opts;

  const mgr        = makeDaemonManager(agents, restartSuccess);
  const supervisor = makeSupervisor(healthMap);

  const wp = new WatchdogPair(
    { ...DEFAULT_CONFIG, ...config },
    mgr,
    supervisor,
    notifier,
  );

  return { wp, mgr, supervisor, notifier };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("WatchdogPair", () => {
  describe("performHealthCheck()", () => {
    it("returns zero unhealthy when all agents are healthy", async () => {
      const { wp } = makeWatchdog({ agents: ["agent-1", "agent-2"] });
      const result = await wp.performHealthCheck(WATCHDOG_A);
      expect(result.unhealthy).toBe(0);
      expect(result.actions).toHaveLength(0);
    });

    it("detects UNHEALTHY agent and restarts it", async () => {
      const { wp, mgr } = makeWatchdog({
        agents:    ["agent-1"],
        healthMap: { "agent-1": "UNHEALTHY" },
      });

      const result = await wp.performHealthCheck(WATCHDOG_A);

      expect(result.unhealthy).toBe(1);
      expect(result.actions).toHaveLength(1);
      expect(result.actions[0]!.action).toBe("restarted");
      expect(result.actions[0]!.agent_id).toBe("agent-1");
      expect(result.actions[0]!.restarted_by).toBe(WATCHDOG_A);
      expect(mgr.restartAgent).toHaveBeenCalledWith("agent-1");
    });

    it("detects CRASHED agent and restarts it", async () => {
      const { wp } = makeWatchdog({
        agents:    ["agent-1"],
        healthMap: { "agent-1": "CRASHED" },
      });
      const result = await wp.performHealthCheck(WATCHDOG_A);
      expect(result.actions[0]!.action).toBe("restarted");
    });

    it("detects CIRCUIT_OPEN agent and restarts it", async () => {
      const { wp } = makeWatchdog({
        agents:    ["agent-1"],
        healthMap: { "agent-1": "CIRCUIT_OPEN" },
      });
      const result = await wp.performHealthCheck(WATCHDOG_A);
      expect(result.actions[0]!.action).toBe("restarted");
    });

    it("skips self — watchdog cannot restart itself", async () => {
      const { wp, mgr } = makeWatchdog({
        agents:    [WATCHDOG_A, "agent-1"],
        healthMap: { [WATCHDOG_A]: "UNHEALTHY" },
      });

      const result = await wp.performHealthCheck(WATCHDOG_A);

      // WATCHDOG_A is unhealthy but should be skipped (self)
      // agent-1 is healthy → no action
      expect(result.actions.some((a) => a.agent_id === WATCHDOG_A)).toBe(false);
      expect(mgr.restartAgent).not.toHaveBeenCalledWith(WATCHDOG_A);
    });

    it("includes checked count in result", async () => {
      const { wp } = makeWatchdog({ agents: ["a1", "a2", "a3"] });
      const result = await wp.performHealthCheck(WATCHDOG_A);
      expect(result.checked).toBe(3);
    });
  });

  describe("cross-monitoring: IT-Admin ↔ Guide", () => {
    it("IT-Admin restarts Guide when Guide is UNHEALTHY", async () => {
      const { wp, mgr } = makeWatchdog({
        agents:    [WATCHDOG_B, "agent-1"],
        healthMap: { [WATCHDOG_B]: "UNHEALTHY" },
      });

      const result = await wp.performHealthCheck(WATCHDOG_A);

      const action = result.actions.find((a) => a.agent_id === WATCHDOG_B);
      expect(action?.action).toBe("restarted");
      expect(action?.restarted_by).toBe(WATCHDOG_A);
      expect(mgr.restartAgent).toHaveBeenCalledWith(WATCHDOG_B);
    });

    it("Guide restarts IT-Admin when IT-Admin is UNHEALTHY", async () => {
      const { wp, mgr } = makeWatchdog({
        agents:    [WATCHDOG_A, "agent-1"],
        healthMap: { [WATCHDOG_A]: "UNHEALTHY" },
      });

      const result = await wp.performHealthCheck(WATCHDOG_B);

      const action = result.actions.find((a) => a.agent_id === WATCHDOG_A);
      expect(action?.action).toBe("restarted");
      expect(action?.restarted_by).toBe(WATCHDOG_B);
      expect(mgr.restartAgent).toHaveBeenCalledWith(WATCHDOG_A);
    });
  });

  describe("grace period", () => {
    it("secondary watchdog skips restart during grace period", async () => {
      const { wp, mgr } = makeWatchdog({
        agents:    ["agent-1"],
        healthMap: { "agent-1": "UNHEALTHY" },
        config:    { grace_period_ms: 999_999 }, // very long grace period
      });

      // Primary (WATCHDOG_A) claims the restart
      await wp.performHealthCheck(WATCHDOG_A);
      expect(mgr.restartAgent).toHaveBeenCalledTimes(1);

      // Secondary (WATCHDOG_B) should skip — grace period not elapsed
      const result = await wp.performHealthCheck(WATCHDOG_B);
      const action = result.actions.find((a) => a.agent_id === "agent-1");
      expect(action?.action).toBe("skipped_grace_period");
      // restartAgent still only called once (from primary)
      expect(mgr.restartAgent).toHaveBeenCalledTimes(1);
    });

    it("secondary watchdog acts after grace period expires", async () => {
      const { wp, mgr } = makeWatchdog({
        agents:    ["agent-1"],
        healthMap: { "agent-1": "UNHEALTHY" },
        config:    { grace_period_ms: 0 }, // instant expiry
      });

      // Primary claims the restart
      await wp.performHealthCheck(WATCHDOG_A);

      // Secondary acts immediately (grace=0 → already expired)
      await wp.performHealthCheck(WATCHDOG_B);
      // Both should have restarted
      expect(mgr.restartAgent).toHaveBeenCalledTimes(2);
    });
  });

  describe("restart budget", () => {
    it("respects restart_budget_per_hour limit", async () => {
      const notifier = makeNotifier();
      const { wp, mgr } = makeWatchdog({
        agents:    ["agent-1", "agent-2", "agent-3"],
        healthMap: { "agent-1": "UNHEALTHY", "agent-2": "UNHEALTHY", "agent-3": "UNHEALTHY" },
        config:    { restart_budget_per_hour: 2 },
        notifier,
      });

      const result = await wp.performHealthCheck(WATCHDOG_A);
      const restarted = result.actions.filter((a) => a.action === "restarted");
      const skipped   = result.actions.filter((a) => a.action === "skipped_budget");

      expect(restarted).toHaveLength(2);
      expect(skipped).toHaveLength(1);
      expect(mgr.restartAgent).toHaveBeenCalledTimes(2);
    });

    it("notifies human when budget is exceeded", async () => {
      const notifier = makeNotifier();
      const { wp } = makeWatchdog({
        agents:    ["a1", "a2"],
        healthMap: { a1: "UNHEALTHY", a2: "UNHEALTHY" },
        config:    { restart_budget_per_hour: 1 },
        notifier,
      });

      await wp.performHealthCheck(WATCHDOG_A);

      expect(notifier.notify).toHaveBeenCalledWith(
        expect.stringContaining("WATCHDOG_ESCALATION"),
        "critical",
      );
    });

    it("resets budget count after one hour (restartCount stays within window)", async () => {
      const { wp } = makeWatchdog({
        agents:    ["agent-1"],
        healthMap: { "agent-1": "UNHEALTHY" },
      });

      await wp.performHealthCheck(WATCHDOG_A);
      expect(wp.restartCount).toBe(1);
    });
  });

  describe("isHandling() / gracePeriodExpired()", () => {
    it("isHandling returns false for unknown agent", () => {
      const { wp } = makeWatchdog();
      expect(wp.isHandling(WATCHDOG_A, "unknown")).toBe(false);
    });

    it("isHandling returns true after restart claim", async () => {
      const { wp } = makeWatchdog({
        agents:    ["agent-1"],
        healthMap: { "agent-1": "UNHEALTHY" },
      });
      await wp.performHealthCheck(WATCHDOG_A);
      expect(wp.isHandling(WATCHDOG_A, "agent-1")).toBe(true);
    });

    it("isHandling returns false for the other watchdog", async () => {
      const { wp } = makeWatchdog({
        agents:    ["agent-1"],
        healthMap: { "agent-1": "UNHEALTHY" },
      });
      await wp.performHealthCheck(WATCHDOG_A);
      expect(wp.isHandling(WATCHDOG_B, "agent-1")).toBe(false);
    });

    it("gracePeriodExpired returns true for unknown agent", () => {
      const { wp } = makeWatchdog();
      expect(wp.gracePeriodExpired("unknown")).toBe(true);
    });

    it("gracePeriodExpired returns false immediately after claim", async () => {
      const { wp } = makeWatchdog({
        agents:    ["agent-1"],
        healthMap: { "agent-1": "UNHEALTHY" },
        config:    { grace_period_ms: 999_999 },
      });
      await wp.performHealthCheck(WATCHDOG_A);
      expect(wp.gracePeriodExpired("agent-1")).toBe(false);
    });
  });

  describe("cleanupHandlingMap()", () => {
    it("removes handling entries for recovered agents", async () => {
      const { wp } = makeWatchdog({
        agents:    ["agent-1"],
        healthMap: { "agent-1": "UNHEALTHY" },
      });
      await wp.performHealthCheck(WATCHDOG_A);
      expect(wp.isHandling(WATCHDOG_A, "agent-1")).toBe(true);

      wp.cleanupHandlingMap(["agent-1"]);
      expect(wp.isHandling(WATCHDOG_A, "agent-1")).toBe(false);
    });

    it("leaves entries for still-unhealthy agents", async () => {
      const { wp } = makeWatchdog({
        agents:    ["agent-1", "agent-2"],
        healthMap: { "agent-1": "UNHEALTHY", "agent-2": "UNHEALTHY" },
      });
      await wp.performHealthCheck(WATCHDOG_A);

      wp.cleanupHandlingMap(["agent-2"]);   // agent-2 recovered
      expect(wp.isHandling(WATCHDOG_A, "agent-1")).toBe(true);  // still tracked
      expect(wp.isHandling(WATCHDOG_A, "agent-2")).toBe(false); // cleaned up
    });
  });

  describe("notification on restart", () => {
    it("notifies on every restart action", async () => {
      const notifier = makeNotifier();
      const { wp } = makeWatchdog({
        agents:    ["agent-1"],
        healthMap: { "agent-1": "UNHEALTHY" },
        notifier,
      });

      await wp.performHealthCheck(WATCHDOG_A);

      expect(notifier.notify).toHaveBeenCalledWith(
        expect.stringContaining("WATCHDOG_RESTART"),
        "warning",
      );
    });

    it("does not notify on skipped_grace_period (no alert needed)", async () => {
      const notifier = makeNotifier();
      const { wp } = makeWatchdog({
        agents:    ["agent-1"],
        healthMap: { "agent-1": "UNHEALTHY" },
        config:    { grace_period_ms: 999_999 },
        notifier,
      });

      await wp.performHealthCheck(WATCHDOG_A); // primary claims
      vi.mocked(notifier.notify).mockClear();

      await wp.performHealthCheck(WATCHDOG_B); // secondary skips
      // No notification for a skip
      expect(notifier.notify).not.toHaveBeenCalled();
    });
  });
});
