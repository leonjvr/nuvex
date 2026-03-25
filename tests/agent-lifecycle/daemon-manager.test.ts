/**
 * V1.1 — AgentDaemonManager unit tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { stringify as yamlStringify } from "yaml";
import { AgentDaemonManager } from "../../src/agent-lifecycle/daemon-manager.js";
import type { AgentRegistry } from "../../src/agent-lifecycle/agent-registry.js";
import type { TaskQueue } from "../../src/tasks/queue.js";
import type { BudgetTracker } from "../../src/agent-lifecycle/budget-tracker.js";
import type { ProcessSupervisor } from "../../src/agent-lifecycle/supervisor/process-supervisor.js";
import type { AgentDaemonConfig, AgentLifecycleDefinition, DaemonGovernance } from "../../src/agent-lifecycle/types.js";
import type { AgentDefinitionRow } from "../../src/agent-lifecycle/types.js";
import type { SleepFn } from "../../src/agent-lifecycle/agent-daemon.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fastSleep: SleepFn = () => Promise.resolve();

function makeRow(id: string, def: Partial<AgentLifecycleDefinition> = {}): AgentDefinitionRow {
  const full: AgentLifecycleDefinition = {
    id,
    name:         id,
    tier:         1,
    division:     "eng",
    provider:     "anthropic",
    model:        "claude-haiku-4-5",
    skill:        "skills/generic.md",
    capabilities: [],
    ...def,
  };
  return {
    id,
    name:         full.name,
    tier:         full.tier,
    division:     full.division,
    provider:     full.provider,
    model:        full.model,
    skill_path:   full.skill,
    config_yaml:  yamlStringify(full),
    config_hash:  "abc123",
    status:       "stopped",
    created_at:   new Date().toISOString(),
    created_by:   "test",
    updated_at:   new Date().toISOString(),
  } as AgentDefinitionRow;
}

function makeRegistry(rows: AgentDefinitionRow[]): AgentRegistry {
  const rowMap = new Map(rows.map((r) => [r.id, r]));
  return {
    list:    vi.fn().mockReturnValue(rows),
    getById: vi.fn().mockImplementation((id: string) => rowMap.get(id)),
  } as unknown as AgentRegistry;
}

function makeQueue(): TaskQueue {
  return { dequeue: vi.fn().mockReturnValue(null) } as unknown as TaskQueue;
}

function makeBudget(): BudgetTracker {
  return {
    getAgentMonthlySpend: vi.fn().mockReturnValue(0),
    getAgentDailySpend:   vi.fn().mockReturnValue(0),
  } as unknown as BudgetTracker;
}

function makeSupervisor(): ProcessSupervisor {
  return {
    recordHeartbeat: vi.fn(),
    getAgentStatus:  vi.fn().mockReturnValue({ circuit_open: false }),
  } as unknown as ProcessSupervisor;
}

function makeManager(opts: {
  registry?:   AgentRegistry;
  governance?: DaemonGovernance;
} = {}) {
  return new AgentDaemonManager(
    opts.registry ?? makeRegistry([]),
    makeQueue(),
    makeBudget(),
    makeSupervisor(),
    vi.fn().mockResolvedValue(0),
    opts.governance ?? {},
    fastSleep,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AgentDaemonManager", () => {
  describe("startAll()", () => {
    it("starts daemons for agents with polling daemon config", () => {
      const row = makeRow("agent-poll", { daemon: { mode: "polling", poll_interval_ms: 50 } });
      const mgr = makeManager({ registry: makeRegistry([row]) });

      const count = mgr.startAll();
      expect(count).toBe(1);
      expect(mgr.activeCount).toBe(1);

      void mgr.stopAll();
    });

    it("skips agents with no daemon config", () => {
      const row = makeRow("agent-no-daemon");
      const mgr = makeManager({ registry: makeRegistry([row]) });

      const count = mgr.startAll();
      expect(count).toBe(0);
      expect(mgr.activeCount).toBe(0);
    });

    it("skips agents with mode === 'on-demand'", () => {
      const row = makeRow("agent-od", { daemon: { mode: "on-demand" } });
      const mgr = makeManager({ registry: makeRegistry([row]) });

      const count = mgr.startAll();
      expect(count).toBe(0);
      expect(mgr.activeCount).toBe(0);
    });

    it("skips already-running daemons on second startAll()", () => {
      const row = makeRow("agent-poll", { daemon: { mode: "polling" } });
      const mgr = makeManager({ registry: makeRegistry([row]) });

      mgr.startAll();
      const second = mgr.startAll();

      expect(second).toBe(0);
      expect(mgr.activeCount).toBe(1);

      void mgr.stopAll();
    });

    it("starts only polling/event agents, skips on-demand", () => {
      const rows = [
        makeRow("a-poll", { daemon: { mode: "polling" } }),
        makeRow("a-od",   { daemon: { mode: "on-demand" } }),
        makeRow("a-none"),
      ];
      const mgr = makeManager({ registry: makeRegistry(rows) });

      const count = mgr.startAll();
      expect(count).toBe(1);

      void mgr.stopAll();
    });

    it("returns 0 and logs warning when agent YAML is invalid", () => {
      // Craft a row with broken YAML
      const row: AgentDefinitionRow = {
        ...makeRow("broken"),
        config_yaml: "{ unclosed: [",
      } as AgentDefinitionRow;
      const mgr = makeManager({ registry: makeRegistry([row]) });

      const count = mgr.startAll();
      expect(count).toBe(0);
    });
  });

  describe("stopAll()", () => {
    it("stops all daemons and clears the map", async () => {
      const rows = [
        makeRow("a1", { daemon: { mode: "polling" } }),
        makeRow("a2", { daemon: { mode: "polling" } }),
      ];
      const mgr = makeManager({ registry: makeRegistry(rows) });

      mgr.startAll();
      expect(mgr.activeCount).toBe(2);

      await mgr.stopAll();
      expect(mgr.activeCount).toBe(0);
    });
  });

  describe("startAgent()", () => {
    it("starts a daemon for a specific agent by ID", () => {
      const row = makeRow("agent-a", { daemon: { mode: "polling" } });
      const mgr = makeManager({ registry: makeRegistry([row]) });

      const ok = mgr.startAgent("agent-a");
      expect(ok).toBe(true);
      expect(mgr.activeCount).toBe(1);

      void mgr.stopAll();
    });

    it("returns false if daemon is already running", () => {
      const row = makeRow("agent-a", { daemon: { mode: "polling" } });
      const mgr = makeManager({ registry: makeRegistry([row]) });

      mgr.startAgent("agent-a");
      const second = mgr.startAgent("agent-a");
      expect(second).toBe(false);
      expect(mgr.activeCount).toBe(1);

      void mgr.stopAll();
    });

    it("returns false if agent is not in registry", () => {
      const mgr = makeManager({ registry: makeRegistry([]) });
      const ok = mgr.startAgent("nonexistent");
      expect(ok).toBe(false);
    });

    it("accepts an explicit daemonConfig override", () => {
      const mgr = makeManager({ registry: makeRegistry([]) });
      const config: AgentDaemonConfig = { mode: "polling", poll_interval_ms: 100 };
      const ok = mgr.startAgent("new-agent", config);
      expect(ok).toBe(true);
      expect(mgr.activeCount).toBe(1);

      void mgr.stopAll();
    });

    it("can start an on-demand agent explicitly (no auto-start filter)", () => {
      const row = makeRow("agent-od", { daemon: { mode: "on-demand" } });
      const mgr = makeManager({ registry: makeRegistry([row]) });

      // startAll skips it — but startAgent can still activate it
      mgr.startAll();
      expect(mgr.activeCount).toBe(0);

      const ok = mgr.startAgent("agent-od");
      expect(ok).toBe(true);
      expect(mgr.activeCount).toBe(1);

      void mgr.stopAll();
    });
  });

  describe("stopAgent()", () => {
    it("stops and removes a running daemon", async () => {
      const row = makeRow("agent-a", { daemon: { mode: "polling" } });
      const mgr = makeManager({ registry: makeRegistry([row]) });

      mgr.startAgent("agent-a");
      const ok = await mgr.stopAgent("agent-a");

      expect(ok).toBe(true);
      expect(mgr.activeCount).toBe(0);
    });

    it("returns false if daemon is not running", async () => {
      const mgr = makeManager();
      const ok = await mgr.stopAgent("nonexistent");
      expect(ok).toBe(false);
    });
  });

  describe("getStatus() / getAllStatuses()", () => {
    it("getStatus() returns undefined for unknown agent", () => {
      const mgr = makeManager();
      expect(mgr.getStatus("unknown")).toBeUndefined();
    });

    it("getStatus() returns DaemonStatus for running agent", () => {
      const row = makeRow("agent-a", { daemon: { mode: "polling" } });
      const mgr = makeManager({ registry: makeRegistry([row]) });

      mgr.startAgent("agent-a");
      const status = mgr.getStatus("agent-a");

      expect(status).toBeDefined();
      expect(status!.agent_id).toBe("agent-a");
      expect(status!.running).toBe(true);

      void mgr.stopAll();
    });

    it("getAllStatuses() returns one entry per running daemon", () => {
      const rows = [
        makeRow("a1", { daemon: { mode: "polling" } }),
        makeRow("a2", { daemon: { mode: "polling" } }),
      ];
      const mgr = makeManager({ registry: makeRegistry(rows) });

      mgr.startAll();
      const statuses = mgr.getAllStatuses();
      expect(statuses).toHaveLength(2);
      const ids = statuses.map((s) => s.agent_id).sort();
      expect(ids).toEqual(["a1", "a2"]);

      void mgr.stopAll();
    });

    it("getAllStatuses() returns empty array when no daemons running", () => {
      const mgr = makeManager();
      expect(mgr.getAllStatuses()).toEqual([]);
    });
  });

  describe("activeCount", () => {
    it("reflects current number of running daemons", () => {
      const rows = [
        makeRow("a1", { daemon: { mode: "polling" } }),
        makeRow("a2", { daemon: { mode: "polling" } }),
        makeRow("a3", { daemon: { mode: "polling" } }),
      ];
      const mgr = makeManager({ registry: makeRegistry(rows) });

      expect(mgr.activeCount).toBe(0);
      mgr.startAll();
      expect(mgr.activeCount).toBe(3);

      void mgr.stopAll();
    });
  });
});
