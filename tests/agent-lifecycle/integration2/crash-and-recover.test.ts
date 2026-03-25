/**
 * Integration test: Mock AgentProcess crash → supervisor calls onAgentCrash handler.
 */

import { describe, it, expect, vi } from "vitest";
import { ProcessSupervisor } from "../../../src/agent-lifecycle/supervisor/process-supervisor.js";
import { Logger } from "../../../src/utils/logger.js";

describe("Crash and recover (integration)", () => {
  it("notifyCrash → onAgentCrash handler → handler receives correct args", () => {
    const supervisor = new ProcessSupervisor(Logger.silent());
    supervisor.registerAgent("agent-crash-test");

    const crashHandler = vi.fn();
    supervisor.onAgentCrash(crashHandler);

    // Simulate orchestrator calling notifyCrash from agentProcess.onExit callback
    supervisor.notifyCrash("agent-crash-test", 137, "SIGKILL");

    expect(crashHandler).toHaveBeenCalledTimes(1);
    expect(crashHandler).toHaveBeenCalledWith("agent-crash-test", 137, "SIGKILL");

    const status = supervisor.getAgentStatus("agent-crash-test");
    expect(status?.total_crashes).toBe(1);
  });

  it("crash → backoff → restart increments restart_attempts correctly", () => {
    const supervisor = new ProcessSupervisor(Logger.silent());
    supervisor.registerAgent("agent-backoff", {
      backoff_base_ms: 500,
      backoff_max_ms: 10_000,
    });

    supervisor.notifyCrash("agent-backoff", 1, null);
    expect(supervisor.getBackoffMs("agent-backoff")).toBe(1_000); // 500 * 2^1

    supervisor.notifyCrash("agent-backoff", 1, null);
    expect(supervisor.getBackoffMs("agent-backoff")).toBe(2_000); // 500 * 2^2

    supervisor.notifyCrash("agent-backoff", 1, null);
    expect(supervisor.getBackoffMs("agent-backoff")).toBe(4_000); // 500 * 2^3
  });
});
