/**
 * Integration: Agent lifecycle
 *
 * Tests full agent subprocess lifecycle using real processes:
 * - Spawn → receive heartbeat → request status → shutdown
 * - Heartbeat monitor tracks health throughout
 * - Checkpoint manager round-trip
 */

import { describe, it, expect, afterEach } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import BetterSQLite3 from "better-sqlite3";
import { AgentProcess } from "../../../src/agents/process.js";
import { HeartbeatMonitor } from "../../../src/agents/heartbeat.js";
import { CheckpointManager } from "../../../src/agents/checkpoint.js";
import type { AgentDefinition, AgentState, AgentIPCMessage, Checkpoint } from "../../../src/agents/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ECHO_WORKER = join(__dirname, "../../fixtures/workers/echo-worker.mjs");

const DEF: AgentDefinition = {
  id: "lifecycle-agent",
  name: "Lifecycle Test Agent",
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

const spawned: AgentProcess[] = [];
let tmpDir: string;
let db: ReturnType<typeof BetterSQLite3>;

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function waitForMsg(proc: AgentProcess, type: string, ms = 3000): Promise<AgentIPCMessage> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timeout: ${type}`)), ms);
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
  if (db) db.close();
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

describe("Agent lifecycle — spawn → heartbeat → status → shutdown", () => {
  it("completes full lifecycle without errors", async () => {
    const monitor = new HeartbeatMonitor({ timeout_ms: 10_000 });
    const proc = new AgentProcess(DEF, OPTS, monitor);
    spawned.push(proc);

    // 1. Spawn
    await proc.spawn();
    expect(proc.isAlive()).toBe(true);
    expect(proc.getPid()).toBeGreaterThan(0);

    // 2. Wait for initial heartbeat
    await sleep(400);
    expect(monitor.isHealthy("lifecycle-agent")).toBe(true);

    // 3. Request status and verify response
    const statusPromise = waitForMsg(proc, "STATUS_RESPONSE");
    proc.send({ type: "STATUS_REQUEST" });
    const status = await statusPromise;
    expect(status.type).toBe("STATUS_RESPONSE");

    // 4. Graceful shutdown
    await proc.shutdown(true);
    await sleep(200);
    expect(proc.isAlive()).toBe(false);
    expect(monitor.getRegisteredAgents()).not.toContain("lifecycle-agent");
  });
});

describe("Agent lifecycle — checkpoint integration", () => {
  it("saves and loads checkpoint round-trip", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "sidjua-lifecycle-"));
    db = new BetterSQLite3(join(tmpDir, "checkpoints.db"));
    const cpMgr = new CheckpointManager(db);
    cpMgr.initialize();

    const state: AgentState = {
      agent_id: "lifecycle-agent",
      status: "IDLE",
      pid: 1234,
      started_at: new Date().toISOString(),
      last_heartbeat: new Date().toISOString(),
      last_checkpoint: null,
      active_tasks: ["task-a", "task-b"],
      waiting_tasks: [],
      queued_tasks: 2,
      total_tokens_used: 5000,
      total_cost_usd: 0.05,
      restart_count: 0,
      current_hour_cost: 0.05,
      hour_start: new Date().toISOString(),
      error_log: [],
    };

    const checkpoint: Checkpoint = {
      agent_id: "lifecycle-agent",
      timestamp: new Date().toISOString(),
      version: 0,
      state,
      task_states: [
        { task_id: "task-a", status: "RUNNING", progress_notes: "halfway done", messages_so_far: 3, partial_result: null },
      ],
      memory_snapshot: "Recent memory: completed auth task yesterday.",
    };

    // Save
    const version = await cpMgr.save(checkpoint);
    expect(version).toBe(1);

    // Load
    const loaded = await cpMgr.loadLatest("lifecycle-agent");
    expect(loaded).not.toBeNull();
    expect(loaded!.state.total_tokens_used).toBe(5000);
    expect(loaded!.state.active_tasks).toEqual(["task-a", "task-b"]);
    expect(loaded!.task_states[0]!.progress_notes).toBe("halfway done");
    expect(loaded!.memory_snapshot).toContain("auth task yesterday");
  });
});

describe("Agent lifecycle — PAUSE and RESUME", () => {
  it("agent responds to PAUSE and RESUME", async () => {
    const proc = new AgentProcess(DEF, OPTS);
    spawned.push(proc);
    await proc.spawn();
    await sleep(200);

    // Pause
    proc.send({ type: "PAUSE" });
    await sleep(100);

    // Request status — agent should be PAUSED
    const statusPromise = waitForMsg(proc, "STATUS_RESPONSE");
    proc.send({ type: "STATUS_REQUEST" });
    const status = await statusPromise;
    if (status.type === "STATUS_RESPONSE") {
      expect(["PAUSED", "IDLE"]).toContain(status.state.status);
    }

    // Resume
    proc.send({ type: "RESUME" });
    await sleep(100);
    expect(proc.isAlive()).toBe(true);
  });
});

describe("Agent lifecycle — exit callback", () => {
  it("onExit fires with code 0 on graceful shutdown", async () => {
    const proc = new AgentProcess(DEF, OPTS);
    spawned.push(proc);
    await proc.spawn();
    await sleep(100);

    let exitCode: number | null = -999;
    proc.onExit((code) => { exitCode = code; });

    await proc.shutdown(true);
    await sleep(500);

    expect(exitCode).toBe(0);
  });
});
