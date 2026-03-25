/**
 * Tests for src/agents/checkpoint.ts
 */

import { describe, it, expect, beforeEach } from "vitest";
import BetterSQLite3 from "better-sqlite3";
import { CheckpointManager } from "../../src/agents/checkpoint.js";
import type { Checkpoint, AgentState } from "../../src/agents/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDb() {
  return new BetterSQLite3(":memory:");
}

function makeState(agentId: string): AgentState {
  return {
    agent_id: agentId,
    status: "IDLE",
    pid: 12345,
    started_at: new Date().toISOString(),
    last_heartbeat: new Date().toISOString(),
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
  };
}

function makeCheckpoint(agentId: string, extra?: Partial<Checkpoint>): Checkpoint {
  return {
    agent_id: agentId,
    timestamp: new Date().toISOString(),
    version: 0, // will be overwritten by save()
    state: makeState(agentId),
    task_states: [],
    memory_snapshot: "Short-term memory content",
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// initialize
// ---------------------------------------------------------------------------

describe("CheckpointManager — initialize", () => {
  it("creates checkpoints table", () => {
    const db = makeDb();
    const mgr = new CheckpointManager(db);
    mgr.initialize();

    const row = db
      .prepare<[string], { name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
      )
      .get("checkpoints");
    expect(row?.name).toBe("checkpoints");
  });

  it("is idempotent — calling twice does not throw", () => {
    const db = makeDb();
    const mgr = new CheckpointManager(db);
    mgr.initialize();
    expect(() => mgr.initialize()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// save / loadLatest
// ---------------------------------------------------------------------------

describe("CheckpointManager — save and loadLatest", () => {
  let mgr: CheckpointManager;

  beforeEach(() => {
    const db = makeDb();
    mgr = new CheckpointManager(db);
    mgr.initialize();
  });

  it("save returns version 1 for first checkpoint", async () => {
    const version = await mgr.save(makeCheckpoint("agent-a"));
    expect(version).toBe(1);
  });

  it("save auto-increments version per agent", async () => {
    await mgr.save(makeCheckpoint("agent-a"));
    const v2 = await mgr.save(makeCheckpoint("agent-a"));
    const v3 = await mgr.save(makeCheckpoint("agent-a"));
    expect(v2).toBe(2);
    expect(v3).toBe(3);
  });

  it("versions are independent per agent", async () => {
    const vA1 = await mgr.save(makeCheckpoint("agent-a"));
    const vA2 = await mgr.save(makeCheckpoint("agent-a"));
    const vB1 = await mgr.save(makeCheckpoint("agent-b"));
    expect(vA1).toBe(1);
    expect(vA2).toBe(2);
    expect(vB1).toBe(1); // separate counter for agent-b
  });

  it("loadLatest returns null when no checkpoints", async () => {
    const result = await mgr.loadLatest("nonexistent-agent");
    expect(result).toBeNull();
  });

  it("loadLatest returns the most recent checkpoint", async () => {
    await mgr.save(makeCheckpoint("agent-a"));
    await mgr.save(makeCheckpoint("agent-a", { memory_snapshot: "V2 snapshot" }));

    const latest = await mgr.loadLatest("agent-a");
    expect(latest).not.toBeNull();
    expect(latest!.version).toBe(2);
    expect(latest!.memory_snapshot).toBe("V2 snapshot");
  });

  it("deserializes state correctly", async () => {
    const state = makeState("agent-a");
    state.total_tokens_used = 9999;
    state.active_tasks = ["t-1", "t-2"];

    await mgr.save({ ...makeCheckpoint("agent-a"), state });
    const loaded = await mgr.loadLatest("agent-a");

    expect(loaded!.state.total_tokens_used).toBe(9999);
    expect(loaded!.state.active_tasks).toEqual(["t-1", "t-2"]);
  });

  it("deserializes task_states correctly", async () => {
    const checkpoint = makeCheckpoint("agent-a");
    checkpoint.task_states = [
      {
        task_id: "task-123",
        status: "RUNNING",
        progress_notes: "50% done",
        messages_so_far: 5,
        partial_result: null,
      },
    ];

    await mgr.save(checkpoint);
    const loaded = await mgr.loadLatest("agent-a");

    expect(loaded!.task_states).toHaveLength(1);
    expect(loaded!.task_states[0]!.task_id).toBe("task-123");
    expect(loaded!.task_states[0]!.progress_notes).toBe("50% done");
  });

  it("preserves memory_snapshot", async () => {
    const checkpoint = makeCheckpoint("agent-a", {
      memory_snapshot: "Important memory snapshot here.",
    });
    await mgr.save(checkpoint);
    const loaded = await mgr.loadLatest("agent-a");
    expect(loaded!.memory_snapshot).toBe("Important memory snapshot here.");
  });
});

// ---------------------------------------------------------------------------
// loadVersion
// ---------------------------------------------------------------------------

describe("CheckpointManager — loadVersion", () => {
  let mgr: CheckpointManager;

  beforeEach(() => {
    const db = makeDb();
    mgr = new CheckpointManager(db);
    mgr.initialize();
  });

  it("returns null for non-existent version", async () => {
    const result = await mgr.loadVersion("agent-a", 99);
    expect(result).toBeNull();
  });

  it("returns correct version", async () => {
    await mgr.save(makeCheckpoint("agent-a", { memory_snapshot: "V1" }));
    await mgr.save(makeCheckpoint("agent-a", { memory_snapshot: "V2" }));
    await mgr.save(makeCheckpoint("agent-a", { memory_snapshot: "V3" }));

    const v2 = await mgr.loadVersion("agent-a", 2);
    expect(v2).not.toBeNull();
    expect(v2!.version).toBe(2);
    expect(v2!.memory_snapshot).toBe("V2");
  });
});

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

describe("CheckpointManager — list", () => {
  let mgr: CheckpointManager;

  beforeEach(() => {
    const db = makeDb();
    mgr = new CheckpointManager(db);
    mgr.initialize();
  });

  it("returns empty array when no checkpoints", async () => {
    const results = await mgr.list("agent-a");
    expect(results).toEqual([]);
  });

  it("returns checkpoints ordered by version descending", async () => {
    for (let i = 0; i < 4; i++) {
      await mgr.save(makeCheckpoint("agent-a"));
    }
    const results = await mgr.list("agent-a");
    expect(results).toHaveLength(4);
    expect(results[0]!.version).toBe(4);
    expect(results[1]!.version).toBe(3);
    expect(results[2]!.version).toBe(2);
    expect(results[3]!.version).toBe(1);
  });

  it("respects limit", async () => {
    for (let i = 0; i < 6; i++) {
      await mgr.save(makeCheckpoint("agent-a"));
    }
    const results = await mgr.list("agent-a", 3);
    expect(results).toHaveLength(3);
    expect(results[0]!.version).toBe(6); // most recent first
  });
});

// ---------------------------------------------------------------------------
// cleanup
// ---------------------------------------------------------------------------

describe("CheckpointManager — cleanup", () => {
  let mgr: CheckpointManager;

  beforeEach(() => {
    const db = makeDb();
    mgr = new CheckpointManager(db);
    mgr.initialize();
  });

  it("returns 0 when fewer checkpoints than keepLast", async () => {
    await mgr.save(makeCheckpoint("agent-a"));
    await mgr.save(makeCheckpoint("agent-a"));
    const deleted = await mgr.cleanup("agent-a", 5);
    expect(deleted).toBe(0);
  });

  it("deletes old checkpoints, keeps most recent N", async () => {
    for (let i = 0; i < 7; i++) {
      await mgr.save(makeCheckpoint("agent-a"));
    }

    const deleted = await mgr.cleanup("agent-a", 3);
    expect(deleted).toBeGreaterThan(0);

    const remaining = await mgr.list("agent-a", 100);
    expect(remaining.length).toBeLessThanOrEqual(4); // at most keepLast + 1 boundary case
    // Latest versions should be kept
    expect(remaining[0]!.version).toBe(7);
  });

  it("does not affect other agents", async () => {
    for (let i = 0; i < 5; i++) {
      await mgr.save(makeCheckpoint("agent-a"));
      await mgr.save(makeCheckpoint("agent-b"));
    }

    await mgr.cleanup("agent-a", 1);

    const bCheckpoints = await mgr.list("agent-b", 100);
    expect(bCheckpoints).toHaveLength(5); // agent-b unaffected
  });
});

// ---------------------------------------------------------------------------
// deleteAll
// ---------------------------------------------------------------------------

describe("CheckpointManager — deleteAll", () => {
  let mgr: CheckpointManager;

  beforeEach(() => {
    const db = makeDb();
    mgr = new CheckpointManager(db);
    mgr.initialize();
  });

  it("removes all checkpoints for agent", async () => {
    for (let i = 0; i < 3; i++) {
      await mgr.save(makeCheckpoint("agent-a"));
    }
    await mgr.deleteAll("agent-a");
    const results = await mgr.list("agent-a");
    expect(results).toHaveLength(0);
  });

  it("does not affect other agents", async () => {
    await mgr.save(makeCheckpoint("agent-a"));
    await mgr.save(makeCheckpoint("agent-b"));

    await mgr.deleteAll("agent-a");

    const bResults = await mgr.list("agent-b");
    expect(bResults).toHaveLength(1);
  });

  it("is safe to call when no checkpoints exist", async () => {
    await expect(mgr.deleteAll("ghost-agent")).resolves.toBeUndefined();
  });

  it("next save after deleteAll starts version at 1", async () => {
    for (let i = 0; i < 3; i++) {
      await mgr.save(makeCheckpoint("agent-a"));
    }
    await mgr.deleteAll("agent-a");
    const newVersion = await mgr.save(makeCheckpoint("agent-a"));
    expect(newVersion).toBe(1);
  });
});
