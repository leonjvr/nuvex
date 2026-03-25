/**
 * Unit tests: ProcessSupervisor
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ProcessSupervisor } from "../../../src/agent-lifecycle/supervisor/process-supervisor.js";
import { Logger } from "../../../src/utils/logger.js";

const silent = Logger.silent();

describe("ProcessSupervisor", () => {
  let supervisor: ProcessSupervisor;

  beforeEach(() => {
    supervisor = new ProcessSupervisor(silent);
  });

  it("registerAgent creates an UNKNOWN status entry", () => {
    supervisor.registerAgent("agent-a");
    const status = supervisor.getAgentStatus("agent-a");
    expect(status).toBeDefined();
    expect(status?.state).toBe("UNKNOWN");
    expect(status?.circuit_open).toBe(false);
  });

  it("getAgentStatus returns undefined for unregistered agent", () => {
    expect(supervisor.getAgentStatus("ghost")).toBeUndefined();
  });

  it("recordHeartbeat updates last_heartbeat and resets consecutive_missed", () => {
    supervisor.registerAgent("agent-b");
    supervisor.checkHeartbeats(); // simulate one missed
    supervisor.recordHeartbeat("agent-b");
    const status = supervisor.getAgentStatus("agent-b");
    expect(status?.last_heartbeat).not.toBeNull();
    expect(status?.consecutive_missed).toBe(0);
    expect(status?.state).toBe("HEALTHY");
  });

  it("checkHeartbeats increments consecutive_missed", () => {
    supervisor.registerAgent("agent-c");
    supervisor.checkHeartbeats();
    supervisor.checkHeartbeats();
    const status = supervisor.getAgentStatus("agent-c");
    expect(status?.consecutive_missed).toBe(2);
  });

  it("notifyCrash triggers onAgentCrash handler", () => {
    supervisor.registerAgent("agent-d");
    const handler = vi.fn();
    supervisor.onAgentCrash(handler);
    supervisor.notifyCrash("agent-d", 1, null);
    expect(handler).toHaveBeenCalledWith("agent-d", 1, null);
  });

  it("notifyCrash increments total_crashes and restart_attempts", () => {
    supervisor.registerAgent("agent-e");
    supervisor.notifyCrash("agent-e", 1, null);
    supervisor.notifyCrash("agent-e", 1, null);
    const status = supervisor.getAgentStatus("agent-e");
    expect(status?.total_crashes).toBe(2);
    expect(status?.restart_attempts).toBe(2);
  });

  it("circuit breaker opens when crash count exceeds max_crashes_in_window", () => {
    supervisor.registerAgent("agent-f", {
      max_crashes_in_window: 3,
      crash_window_ms: 60_000,
    });
    const circuitHandler = vi.fn();
    supervisor.onCircuitOpen(circuitHandler);

    for (let i = 0; i < 4; i++) {
      supervisor.notifyCrash("agent-f", 1, null);
    }

    const status = supervisor.getAgentStatus("agent-f");
    expect(status?.circuit_open).toBe(true);
    expect(status?.state).toBe("CIRCUIT_OPEN");
    expect(circuitHandler).toHaveBeenCalledWith("agent-f");
  });

  it("getBackoffMs doubles with each restart attempt", () => {
    supervisor.registerAgent("agent-g", { backoff_base_ms: 1_000, backoff_max_ms: 32_000 });

    // No crashes yet: attempt = 0 → 1000 * 2^0 = 1000
    expect(supervisor.getBackoffMs("agent-g")).toBe(1_000);

    supervisor.notifyCrash("agent-g", 0, null); // attempt 1 → 2000
    expect(supervisor.getBackoffMs("agent-g")).toBe(2_000);

    supervisor.notifyCrash("agent-g", 0, null); // attempt 2 → 4000
    expect(supervisor.getBackoffMs("agent-g")).toBe(4_000);
  });

  it("getBackoffMs is capped at backoff_max_ms", () => {
    supervisor.registerAgent("agent-h", { backoff_base_ms: 1_000, backoff_max_ms: 5_000 });
    for (let i = 0; i < 10; i++) {
      supervisor.notifyCrash("agent-h", 0, null);
    }
    expect(supervisor.getBackoffMs("agent-h")).toBe(5_000);
  });

  it("resetCircuit clears circuit state and crash history", () => {
    supervisor.registerAgent("agent-i", { max_crashes_in_window: 2 });
    supervisor.notifyCrash("agent-i", 1, null);
    supervisor.notifyCrash("agent-i", 1, null);
    supervisor.notifyCrash("agent-i", 1, null);

    expect(supervisor.getAgentStatus("agent-i")?.circuit_open).toBe(true);
    supervisor.resetCircuit("agent-i");
    expect(supervisor.getAgentStatus("agent-i")?.circuit_open).toBe(false);
  });

  it("getAllStatuses returns entries for all registered agents", () => {
    supervisor.registerAgent("x1");
    supervisor.registerAgent("x2");
    const all = supervisor.getAllStatuses();
    const ids = all.map((s) => s.agent_id);
    expect(ids).toContain("x1");
    expect(ids).toContain("x2");
  });

  it("unregisterAgent removes the agent", () => {
    supervisor.registerAgent("agent-j");
    supervisor.unregisterAgent("agent-j");
    expect(supervisor.getAgentStatus("agent-j")).toBeUndefined();
  });
});
