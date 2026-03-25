/**
 * Tests for src/orchestrator/peer-router.ts
 *
 * Covers:
 * - route: finds available peer, assigns consultation, sends IPC
 * - route: returns no_peer when none available
 * - route: rejects non-consultation task type
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../src/utils/db.js";
import { TaskStore } from "../../src/tasks/store.js";
import { TaskEventBus } from "../../src/tasks/event-bus.js";
import { WorkDistributor } from "../../src/orchestrator/distributor.js";
import { PeerRouter } from "../../src/orchestrator/peer-router.js";
import type { AgentInstance } from "../../src/orchestrator/types.js";
import type { Database } from "../../src/utils/db.js";
import type { CreateTaskInput } from "../../src/tasks/types.js";
import type { AgentDefinition } from "../../src/agents/types.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let tmpDir: string;
let db: Database;
let store: TaskStore;
let bus: TaskEventBus;
let agents: Map<string, AgentInstance>;
let router: PeerRouter;

beforeEach(() => {
  tmpDir  = mkdtempSync(join(tmpdir(), "sidjua-peer-test-"));
  db      = openDatabase(join(tmpDir, "tasks.db"));
  db.pragma("journal_mode = WAL");
  store   = new TaskStore(db);
  store.initialize();
  bus     = new TaskEventBus(db);
  bus.initialize();
  agents  = new Map();
  router  = new PeerRouter(db, bus, new WorkDistributor(), agents);
});

afterEach(() => {
  db.close();
  rmSync(tmpDir, { recursive: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInput(overrides: Partial<CreateTaskInput> = {}): CreateTaskInput {
  return {
    title:        "Consultation",
    description:  "Advisory question",
    division:     "engineering",
    type:         "consultation",
    tier:         2,
    token_budget: 2_000,
    cost_budget:  0.2,
    ...overrides,
  };
}

function makeAgentDef(id: string, tier: 1 | 2 | 3 = 2): AgentDefinition {
  return {
    id,
    name:                    `Agent ${id}`,
    tier,
    provider:                "anthropic",
    model:                   "claude-sonnet-4-6",
    skill_file:              "skills/t2.md",
    division:                "engineering",
    capabilities:            ["code"],
    max_concurrent_tasks:    4,
    token_budget_per_task:   10_000,
    cost_limit_per_hour:     1.0,
    checkpoint_interval_ms:  30_000,
    ttl_default_seconds:     600,
    heartbeat_interval_ms:   10_000,
    max_retries:             3,
    metadata:                {},
  };
}

function makeAgent(id: string, tier: 1 | 2 | 3 = 2): AgentInstance {
  const sendFn = vi.fn();
  return {
    definition:            makeAgentDef(id, tier),
    process:               { send: sendFn } as unknown as AgentInstance["process"],
    status:                "idle",
    active_task_count:     0,
    total_tasks_completed: 0,
    total_tokens_used:     0,
    total_cost_usd:        0,
    last_heartbeat:        "2026-01-01T00:00:00Z",
    started_at:            "2026-01-01T00:00:00Z",
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PeerRouter.route", () => {
  it("finds an available peer and routes consultation", () => {
    const requester = makeAgent("requester");
    const peer      = makeAgent("peer");
    agents.set("requester", requester);
    agents.set("peer", peer);

    const task = store.create(makeInput({ assigned_agent: "requester" }));
    const result = router.route(task);

    expect(result.routed).toBe(true);
    expect(result.peer_agent).toBe("peer");
  });

  it("assigns consultation task to peer in DB", () => {
    const requester = makeAgent("requester");
    const peer      = makeAgent("peer");
    agents.set("requester", requester);
    agents.set("peer", peer);

    const task = store.create(makeInput({ assigned_agent: "requester" }));
    router.route(task);

    const updated = store.get(task.id)!;
    expect(updated.assigned_agent).toBe("peer");
    expect(updated.status).toBe("ASSIGNED");
  });

  it("sends IPC TASK_ASSIGNED to peer process", () => {
    const requester = makeAgent("requester");
    const peer      = makeAgent("peer");
    agents.set("requester", requester);
    agents.set("peer", peer);

    const task = store.create(makeInput({ assigned_agent: "requester" }));
    router.route(task);

    expect(peer.process.send).toHaveBeenCalledWith(
      expect.objectContaining({ type: "TASK_ASSIGNED", task_id: task.id }),
    );
  });

  it("returns no_peer when no peer available", () => {
    // Only requester registered — no peer exists
    agents.set("requester", makeAgent("requester"));

    const task = store.create(makeInput({ assigned_agent: "requester" }));
    const result = router.route(task);

    expect(result.routed).toBe(false);
    expect(result.peer_agent).toBeNull();
    expect(result.reason).toContain("No available peer");
  });

  it("returns no_peer when agents map is empty", () => {
    const task = store.create(makeInput({ assigned_agent: "requester" }));
    const result = router.route(task);

    expect(result.routed).toBe(false);
    expect(result.peer_agent).toBeNull();
  });

  it("rejects non-consultation task type", () => {
    agents.set("requester", makeAgent("requester"));
    agents.set("peer", makeAgent("peer"));

    const task = store.create(makeInput({ type: "delegation" }));
    const result = router.route(task);

    expect(result.routed).toBe(false);
    expect(result.reason).toContain("consultation");
  });

  it("does not create a sub-task relationship", () => {
    const requester = makeAgent("requester");
    const peer      = makeAgent("peer");
    agents.set("requester", requester);
    agents.set("peer", peer);

    const task = store.create(makeInput({ assigned_agent: "requester" }));
    router.route(task);

    // Consultation task should not have its parent's sub_tasks_received incremented
    // (no synthesis relationship)
    const consultationTask = store.get(task.id)!;
    expect(consultationTask.parent_id).toBeNull(); // still no parent
  });
});
