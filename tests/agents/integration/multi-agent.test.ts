/**
 * Integration: Multi-agent
 *
 * Tests multiple agent subprocesses running concurrently.
 * Verifies each process is independent and heartbeats don't cross-pollinate.
 */

import { describe, it, expect, afterEach } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { AgentProcess } from "../../../src/agents/process.js";
import { HeartbeatMonitor } from "../../../src/agents/heartbeat.js";
import type { AgentDefinition, AgentIPCMessage } from "../../../src/agents/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ECHO_WORKER = join(__dirname, "../../fixtures/workers/echo-worker.mjs");

function makeDef(id: string): AgentDefinition {
  return {
    id,
    name: `Agent ${id}`,
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
    heartbeat_interval_ms: 300,
    max_retries: 3,
    metadata: {},
  };
}

const OPTS = {
  cwd: process.cwd(),
  env: {},
  maxMemoryMB: 128,
  workerPath: ECHO_WORKER,
};

const spawned: AgentProcess[] = [];

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function waitForMsg(proc: AgentProcess, type: string, ms = 3000): Promise<AgentIPCMessage> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timeout waiting for ${type}`)), ms);
    proc.onMessage((msg) => {
      if (msg.type === type) { clearTimeout(t); resolve(msg); }
    });
  });
}

afterEach(async () => {
  for (const p of spawned) {
    if (p.isAlive()) await p.shutdown(false);
  }
  spawned.length = 0;
});

describe("Multi-agent — concurrent processes", () => {
  it("spawns 3 agents concurrently and all are alive", async () => {
    const agents = ["agent-alpha", "agent-beta", "agent-gamma"];
    const procs = agents.map((id) => {
      const p = new AgentProcess(makeDef(id), OPTS);
      spawned.push(p);
      return p;
    });

    // Spawn all concurrently
    await Promise.all(procs.map((p) => p.spawn()));
    await sleep(300);

    for (const proc of procs) {
      expect(proc.isAlive()).toBe(true);
      expect(proc.getPid()).not.toBeNull();
    }
  });

  it("each agent has a distinct PID", async () => {
    const agents = ["pid-agent-1", "pid-agent-2"];
    const procs = agents.map((id) => {
      const p = new AgentProcess(makeDef(id), OPTS);
      spawned.push(p);
      return p;
    });

    await Promise.all(procs.map((p) => p.spawn()));
    await sleep(200);

    const pids = procs.map((p) => p.getPid());
    expect(pids[0]).not.toBe(pids[1]);
    expect(pids.every((pid) => pid !== null)).toBe(true);
  });

  it("heartbeat monitor tracks all agents independently", async () => {
    const monitor = new HeartbeatMonitor({ timeout_ms: 10_000 });
    const agents = ["hb-agent-1", "hb-agent-2", "hb-agent-3"];
    const procs = agents.map((id) => {
      const p = new AgentProcess(makeDef(id), OPTS, monitor);
      spawned.push(p);
      return p;
    });

    await Promise.all(procs.map((p) => p.spawn()));
    await sleep(500);

    for (const id of agents) {
      expect(monitor.isHealthy(id)).toBe(true);
    }

    expect(monitor.getRegisteredAgents()).toHaveLength(3);
  });

  it("shutting down one agent does not affect others", async () => {
    const agents = ["kill-1", "kill-2", "kill-3"];
    const procs = agents.map((id) => {
      const p = new AgentProcess(makeDef(id), OPTS);
      spawned.push(p);
      return p;
    });

    await Promise.all(procs.map((p) => p.spawn()));
    await sleep(200);

    // Shutdown first agent
    await procs[0]!.shutdown(true);
    await sleep(200);

    expect(procs[0]!.isAlive()).toBe(false);
    expect(procs[1]!.isAlive()).toBe(true);
    expect(procs[2]!.isAlive()).toBe(true);
  });

  it("agents have correct IDs in their state", async () => {
    const agents = ["id-check-1", "id-check-2"];
    const procs = agents.map((id) => {
      const p = new AgentProcess(makeDef(id), OPTS);
      spawned.push(p);
      return p;
    });

    await Promise.all(procs.map((p) => p.spawn()));
    await sleep(200);

    // Request status from each
    const statusPromises = procs.map((proc) => waitForMsg(proc, "STATUS_RESPONSE"));
    for (const proc of procs) {
      proc.send({ type: "STATUS_REQUEST" });
    }

    const statuses = await Promise.all(statusPromises);
    const ids = statuses.map((s) => {
      if (s.type !== "STATUS_RESPONSE") return null;
      return s.state.agent_id;
    });

    expect(ids).toContain("id-check-1");
    expect(ids).toContain("id-check-2");
  });

  it("messages from one agent do not appear in another agent's callbacks", async () => {
    const proc1 = new AgentProcess(makeDef("isolated-1"), OPTS);
    const proc2 = new AgentProcess(makeDef("isolated-2"), OPTS);
    spawned.push(proc1, proc2);

    const msgs1: AgentIPCMessage[] = [];
    const msgs2: AgentIPCMessage[] = [];

    await proc1.spawn();
    await proc2.spawn();
    await sleep(200);

    proc1.onMessage((m) => msgs1.push(m));
    proc2.onMessage((m) => msgs2.push(m));

    // Only send to proc2
    proc2.send({ type: "STATUS_REQUEST" });
    await sleep(300);

    // proc1 should NOT receive proc2's STATUS_RESPONSE
    const proc1HasStatusResponse = msgs1.some((m) => m.type === "STATUS_RESPONSE");
    expect(proc1HasStatusResponse).toBe(false);

    // proc2 should have received STATUS_RESPONSE
    const proc2HasStatusResponse = msgs2.some((m) => m.type === "STATUS_RESPONSE");
    expect(proc2HasStatusResponse).toBe(true);
  });
});
