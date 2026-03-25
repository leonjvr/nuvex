/**
 * Integration test: Circuit breaker activation and manual reset.
 */

import { describe, it, expect, vi } from "vitest";
import { ProcessSupervisor } from "../../../src/agent-lifecycle/supervisor/process-supervisor.js";
import { Logger } from "../../../src/utils/logger.js";

describe("Circuit breaker activation (integration)", () => {
  it("6 crashes in window → circuit opens → status CIRCUIT_OPEN", () => {
    const supervisor = new ProcessSupervisor(Logger.silent());
    supervisor.registerAgent("agent-cb", {
      max_crashes_in_window: 5,
      crash_window_ms: 60_000,
    });

    const circuitHandler = vi.fn();
    supervisor.onCircuitOpen(circuitHandler);

    for (let i = 0; i < 6; i++) {
      supervisor.notifyCrash("agent-cb", 1, null);
    }

    const status = supervisor.getAgentStatus("agent-cb");
    expect(status?.circuit_open).toBe(true);
    expect(status?.state).toBe("CIRCUIT_OPEN");
    expect(circuitHandler).toHaveBeenCalledTimes(1);
    expect(circuitHandler).toHaveBeenCalledWith("agent-cb");
  });

  it("manual reset after circuit opens clears circuit state", () => {
    const supervisor = new ProcessSupervisor(Logger.silent());
    supervisor.registerAgent("agent-reset", { max_crashes_in_window: 2 });

    for (let i = 0; i < 3; i++) {
      supervisor.notifyCrash("agent-reset", 1, null);
    }

    expect(supervisor.getAgentStatus("agent-reset")?.circuit_open).toBe(true);

    supervisor.resetCircuit("agent-reset");
    const status = supervisor.getAgentStatus("agent-reset");
    expect(status?.circuit_open).toBe(false);
    expect(status?.circuit_opened_at).toBeNull();
  });
});
