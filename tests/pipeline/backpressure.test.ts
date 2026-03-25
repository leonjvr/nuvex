/**
 * Tests for src/pipeline/backpressure.ts
 *
 * Covers:
 * - Unknown agent returns "redirect"
 * - utilization < 0.8 → "accept"
 * - utilization >= 0.8 and < 1.0 → "queue"
 * - utilization >= 1.0 → "redirect"
 * - queue_pressure > 0.8 → "redirect" even if utilization < 0.8
 * - onTaskAccepted increments active, decrements queued
 * - onTaskCompleted decrements active (floor at 0)
 * - onTaskFailed decrements active (floor at 0)
 * - getOverloadedAgents, getIdleAgents, acceptingCount, atCapacityCount
 */

import { describe, it, expect, beforeEach } from "vitest";
import { BackpressureMonitor } from "../../src/pipeline/backpressure.js";
import { DEFAULT_PIPELINE_CONFIG } from "../../src/pipeline/types.js";
import type { PipelineConfig } from "../../src/pipeline/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCfg(overrides: Partial<PipelineConfig> = {}): PipelineConfig {
  return { ...DEFAULT_PIPELINE_CONFIG, ...overrides };
}

function makeMonitor(overrides: Partial<PipelineConfig> = {}): BackpressureMonitor {
  return new BackpressureMonitor(makeCfg(overrides));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("BackpressureMonitor", () => {
  describe("unknown agent", () => {
    it("returns redirect and conservative defaults for unregistered agent", () => {
      const monitor = makeMonitor();
      const status = monitor.getStatus("unknown-agent");
      expect(status.recommendation).toBe("redirect");
      expect(status.capacity).toBe(0);
      expect(status.utilization).toBe(1.0);
      expect(status.queue_pressure).toBe(1.0);
      expect(status.accepting).toBe(false);
    });

    it("shouldAccept returns redirect for unregistered agent", () => {
      const monitor = makeMonitor();
      expect(monitor.shouldAccept("unknown-agent")).toBe("redirect");
    });
  });

  describe("utilization-based recommendations", () => {
    it("utilization < 0.8 → accept", () => {
      const monitor = makeMonitor();
      monitor.registerAgent("agent-1", 10); // capacity 10
      // active = 0 → utilization = 0.0 → accept
      expect(monitor.shouldAccept("agent-1")).toBe("accept");
    });

    it("utilization at exactly 0.75 → accept", () => {
      const monitor = makeMonitor();
      monitor.registerAgent("agent-1", 4); // capacity 4
      monitor.initFromCounts("agent-1", 3, 0); // active=3 → util=0.75
      expect(monitor.shouldAccept("agent-1")).toBe("accept");
    });

    it("utilization >= 0.8 and < 1.0 → queue", () => {
      const monitor = makeMonitor();
      monitor.registerAgent("agent-1", 5); // capacity 5
      monitor.initFromCounts("agent-1", 4, 0); // active=4 → util=0.80
      expect(monitor.shouldAccept("agent-1")).toBe("queue");
    });

    it("utilization >= 1.0 → redirect", () => {
      const monitor = makeMonitor();
      monitor.registerAgent("agent-1", 4); // capacity 4
      monitor.initFromCounts("agent-1", 4, 0); // active=4 → util=1.0
      expect(monitor.shouldAccept("agent-1")).toBe("redirect");
    });

    it("zero-capacity agent always redirects", () => {
      const monitor = makeMonitor();
      monitor.registerAgent("agent-1", 0); // edge case
      expect(monitor.shouldAccept("agent-1")).toBe("redirect");
    });
  });

  describe("queue pressure override", () => {
    it("queue_pressure > 0.8 → redirect even if utilization < 0.8", () => {
      const monitor = makeMonitor({ max_queue_size_per_agent: 50 });
      monitor.registerAgent("agent-1", 100); // huge capacity → utilization very low
      monitor.initFromCounts("agent-1", 0, 42); // queued=42 → qp=42/50=0.84 > 0.8
      expect(monitor.shouldAccept("agent-1")).toBe("redirect");
    });

    it("queue_pressure exactly at 0.8 → not redirect (> not >=)", () => {
      const monitor = makeMonitor({ max_queue_size_per_agent: 50 });
      monitor.registerAgent("agent-1", 100);
      monitor.initFromCounts("agent-1", 0, 40); // queued=40 → qp=40/50=0.8 (NOT > 0.8)
      // utilization = 0/100 = 0.0 → "accept"
      expect(monitor.shouldAccept("agent-1")).toBe("accept");
    });
  });

  describe("capacity updates", () => {
    let monitor: BackpressureMonitor;

    beforeEach(() => {
      monitor = makeMonitor();
      monitor.registerAgent("agent-1", 4);
    });

    it("onTaskAccepted increments active and decrements queued", () => {
      monitor.initFromCounts("agent-1", 1, 2); // active=1, queued=2
      monitor.onTaskAccepted("agent-1");
      const s = monitor.getStatus("agent-1");
      expect(s.active).toBe(2);  // incremented
      expect(s.queued).toBe(1);  // decremented
    });

    it("onTaskAccepted caps active at capacity", () => {
      monitor.initFromCounts("agent-1", 4, 0); // at capacity
      monitor.onTaskAccepted("agent-1");
      expect(monitor.getStatus("agent-1").active).toBe(4); // capped
    });

    it("onTaskQueued increments queued", () => {
      monitor.onTaskQueued("agent-1");
      expect(monitor.getStatus("agent-1").queued).toBe(1);
    });

    it("onTaskCompleted decrements active", () => {
      monitor.initFromCounts("agent-1", 3, 0);
      monitor.onTaskCompleted("agent-1");
      expect(monitor.getStatus("agent-1").active).toBe(2);
    });

    it("onTaskCompleted floors active at 0", () => {
      monitor.initFromCounts("agent-1", 0, 0);
      monitor.onTaskCompleted("agent-1"); // should not go negative
      expect(monitor.getStatus("agent-1").active).toBe(0);
    });

    it("onTaskFailed decrements active", () => {
      monitor.initFromCounts("agent-1", 2, 0);
      monitor.onTaskFailed("agent-1");
      expect(monitor.getStatus("agent-1").active).toBe(1);
    });

    it("operations on unknown agent are no-ops (no throw)", () => {
      expect(() => monitor.onTaskAccepted("ghost")).not.toThrow();
      expect(() => monitor.onTaskCompleted("ghost")).not.toThrow();
      expect(() => monitor.onTaskFailed("ghost")).not.toThrow();
      expect(() => monitor.onTaskQueued("ghost")).not.toThrow();
    });
  });

  describe("aggregate queries", () => {
    let monitor: BackpressureMonitor;

    beforeEach(() => {
      monitor = makeMonitor();
      monitor.registerAgent("agent-idle",     4);
      monitor.registerAgent("agent-busy",     4);
      monitor.registerAgent("agent-overload", 4);
      monitor.initFromCounts("agent-idle",     0, 0); // idle
      monitor.initFromCounts("agent-busy",     3, 0); // busy (util=0.75 → accept)
      monitor.initFromCounts("agent-overload", 4, 0); // full (util=1.0 → redirect)
    });

    it("agentCount returns total registered agents", () => {
      expect(monitor.agentCount()).toBe(3);
    });

    it("acceptingCount returns agents with utilization < 1.0", () => {
      expect(monitor.acceptingCount()).toBe(2); // idle + busy
    });

    it("atCapacityCount returns agents with utilization >= 1.0", () => {
      expect(monitor.atCapacityCount()).toBe(1); // overload only
    });

    it("getOverloadedAgents returns overloaded agent IDs", () => {
      const overloaded = monitor.getOverloadedAgents();
      expect(overloaded).toContain("agent-overload");
      expect(overloaded).not.toContain("agent-idle");
      expect(overloaded).not.toContain("agent-busy");
    });

    it("getIdleAgents returns agents with active=0 and queued=0", () => {
      const idle = monitor.getIdleAgents();
      expect(idle).toContain("agent-idle");
      expect(idle).not.toContain("agent-busy");
      expect(idle).not.toContain("agent-overload");
    });

    it("getIdleAgents filters by tier when agentTiers and tier are provided", () => {
      const tiers = new Map([
        ["agent-idle", 1],
        ["agent-busy", 2],
        ["agent-overload", 2],
      ]);

      // Only tier-1 idle agents
      const tier1Idle = monitor.getIdleAgents(tiers, 1);
      expect(tier1Idle).toContain("agent-idle");
      expect(tier1Idle).toHaveLength(1);

      // Tier-2 idle: none (busy and overload are not idle)
      const tier2Idle = monitor.getIdleAgents(tiers, 2);
      expect(tier2Idle).toHaveLength(0);
    });

    it("registerAgent is idempotent (second call does not reset counts)", () => {
      monitor.initFromCounts("agent-busy", 3, 0); // set active
      monitor.registerAgent("agent-busy", 4);      // second registration → no-op
      expect(monitor.getStatus("agent-busy").active).toBe(3); // unchanged
    });
  });

  describe("initFromCounts", () => {
    it("sets active and queued from DB recovery data", () => {
      const monitor = makeMonitor();
      monitor.registerAgent("agent-1", 10);
      monitor.initFromCounts("agent-1", 6, 3);
      const s = monitor.getStatus("agent-1");
      expect(s.active).toBe(6);
      expect(s.queued).toBe(3);
      expect(s.utilization).toBeCloseTo(0.6);
    });

    it("no-op for unregistered agent", () => {
      const monitor = makeMonitor();
      expect(() => monitor.initFromCounts("ghost", 5, 2)).not.toThrow();
    });
  });
});
