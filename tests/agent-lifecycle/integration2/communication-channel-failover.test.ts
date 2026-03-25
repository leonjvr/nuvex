/**
 * Integration test: Channel send when process is dead does not throw.
 */

import { describe, it, expect, vi } from "vitest";
import { LocalIPCChannel } from "../../../src/agent-lifecycle/communication/local-ipc-channel.js";
import type { AgentIPCMessage } from "../../../src/agents/types.js";
import { Logger } from "../../../src/utils/logger.js";

function makeDeadProcess() {
  return {
    isAlive: () => false,
    send: vi.fn(),
    onMessage: vi.fn(),
    onExit: vi.fn(),
  };
}

describe("Communication channel failover (integration)", () => {
  it("send to dead process does not throw and is a no-op at channel level", () => {
    const proc = makeDeadProcess();
    const channel = new LocalIPCChannel(proc as never, "orchestrator", "agent-dead", Logger.silent());

    expect(() => {
      channel.send({
        id: "test-1",
        type: "heartbeat",
        from: "orchestrator",
        to: "agent-dead",
        timestamp: new Date().toISOString(),
        payload: {},
      });
    }).not.toThrow();
  });

  it("isHealthy() returns false when process is dead", () => {
    const proc = makeDeadProcess();
    const channel = new LocalIPCChannel(proc as never, "orchestrator", "agent-dead", Logger.silent());
    expect(channel.isHealthy()).toBe(false);
  });

  it("closed channel does not forward messages to subscribers", () => {
    const messageCallbacks: Array<(msg: AgentIPCMessage) => void> = [];
    const proc = {
      isAlive: () => true,
      send: vi.fn(),
      onMessage: (cb: (msg: AgentIPCMessage) => void) => { messageCallbacks.push(cb); },
      onExit: vi.fn(),
      _emit: (msg: AgentIPCMessage) => messageCallbacks.forEach((cb) => cb(msg)),
    };

    const channel = new LocalIPCChannel(proc as never, "orchestrator", "agent-1", Logger.silent());

    const received: unknown[] = [];
    channel.subscribe((env) => received.push(env));

    channel.close();
    proc._emit({ type: "HEARTBEAT" });

    expect(received).toHaveLength(0);
  });
});
