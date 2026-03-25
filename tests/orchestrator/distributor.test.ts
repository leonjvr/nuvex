/**
 * Tests for src/orchestrator/distributor.ts
 *
 * Covers:
 * - assignTask: tier, division, capability, availability, score filters
 * - findPeer: same-tier different agent
 * - rebalance: imbalance detection
 */

import { describe, it, expect } from "vitest";
import { WorkDistributor } from "../../src/orchestrator/distributor.js";
import type { AgentInstance } from "../../src/orchestrator/types.js";
import type { Task } from "../../src/tasks/types.js";
import type { AgentDefinition } from "../../src/agents/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id:                  "task-1",
    parent_id:           null,
    root_id:             "task-1",
    division:            "engineering",
    type:                "root",
    tier:                2,
    title:               "Test task",
    description:         "Test",
    assigned_agent:      null,
    status:              "PENDING",
    priority:            3,
    classification:      "internal",
    created_at:          "2026-01-01T00:00:00Z",
    updated_at:          "2026-01-01T00:00:00Z",
    started_at:          null,
    completed_at:        null,
    result_file:         null,
    result_summary:      null,
    confidence:          null,
    token_budget:        10_000,
    token_used:          0,
    cost_budget:         1.0,
    cost_used:           0,
    ttl_seconds:         600,
    retry_count:         0,
    max_retries:         3,
    checkpoint:          null,
    sub_tasks_expected:  0,
    sub_tasks_received:  0,
    embedding_id:        null,
    metadata:            {},
    ...overrides,
  };
}

function makeDefinition(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id:                      "agent-1",
    name:                    "Test Agent",
    tier:                    2,
    provider:                "anthropic",
    model:                   "claude-sonnet-4-6",
    skill_file:              "skills/t2.md",
    division:                "engineering",
    capabilities:            ["code", "analysis"],
    max_concurrent_tasks:    4,
    token_budget_per_task:   10_000,
    cost_limit_per_hour:     1.0,
    checkpoint_interval_ms:  30_000,
    ttl_default_seconds:     600,
    heartbeat_interval_ms:   10_000,
    max_retries:             3,
    metadata:                {},
    ...overrides,
  };
}

function makeAgent(defOverrides: Partial<AgentDefinition> = {}, instOverrides: Partial<AgentInstance> = {}): AgentInstance {
  const definition = makeDefinition(defOverrides);
  return {
    definition,
    process:               { send: () => {} } as unknown as AgentInstance["process"],
    status:                "idle",
    active_task_count:     0,
    total_tasks_completed: 0,
    total_tokens_used:     0,
    total_cost_usd:        0,
    last_heartbeat:        "2026-01-01T00:00:00Z",
    started_at:            "2026-01-01T00:00:00Z",
    ...instOverrides,
  };
}

// ---------------------------------------------------------------------------
// assignTask
// ---------------------------------------------------------------------------

describe("WorkDistributor.assignTask", () => {
  it("assigns to a matching agent", () => {
    const d    = new WorkDistributor();
    const task  = makeTask({ tier: 2, division: "engineering" });
    const agent = makeAgent({ tier: 2, division: "engineering" });
    const result = d.assignTask(task, [agent]);
    expect(result).not.toBeNull();
    expect(result!.agent_id).toBe("agent-1");
  });

  it("returns null when no agents", () => {
    const d    = new WorkDistributor();
    const task  = makeTask();
    const result = d.assignTask(task, []);
    expect(result).toBeNull();
  });

  it("filters by tier", () => {
    const d    = new WorkDistributor();
    const task  = makeTask({ tier: 2 });
    const t1Agent = makeAgent({ id: "t1-agent", tier: 1 });
    const result = d.assignTask(task, [t1Agent]);
    expect(result).toBeNull();
  });

  it("filters by division (exact match)", () => {
    const d    = new WorkDistributor();
    const task  = makeTask({ tier: 2, division: "finance" });
    const agent = makeAgent({ division: "engineering" });
    const result = d.assignTask(task, [agent]);
    expect(result).toBeNull();
  });

  it("blocks 'general' division agents from tasks in other divisions (P270 A1 strict isolation)", () => {
    const d    = new WorkDistributor();
    const task  = makeTask({ tier: 2, division: "finance" });
    const agent = makeAgent({ division: "general" });
    const result = d.assignTask(task, [agent]);
    expect(result).toBeNull();
  });

  it("filters by capabilities", () => {
    const d    = new WorkDistributor();
    const task  = makeTask({ tier: 2, metadata: { capabilities_required: ["machine-learning"] } });
    const agent = makeAgent({ capabilities: ["code"] }); // no ML capability
    const result = d.assignTask(task, [agent]);
    expect(result).toBeNull();
  });

  it("passes capability check when agent has required capabilities", () => {
    const d    = new WorkDistributor();
    const task  = makeTask({ tier: 2, metadata: { capabilities_required: ["code"] } });
    const agent = makeAgent({ capabilities: ["code", "analysis"] });
    const result = d.assignTask(task, [agent]);
    expect(result).not.toBeNull();
  });

  it("filters out crashed agents", () => {
    const d    = new WorkDistributor();
    const task  = makeTask({ tier: 2 });
    const agent = makeAgent({}, { status: "crashed" });
    const result = d.assignTask(task, [agent]);
    expect(result).toBeNull();
  });

  it("filters out restarting agents", () => {
    const d    = new WorkDistributor();
    const task  = makeTask({ tier: 2 });
    const agent = makeAgent({}, { status: "restarting" });
    const result = d.assignTask(task, [agent]);
    expect(result).toBeNull();
  });

  it("filters out overloaded agents (at max tasks)", () => {
    const d    = new WorkDistributor();
    const task  = makeTask({ tier: 2 });
    const agent = makeAgent({ max_concurrent_tasks: 2 }, { active_task_count: 2 });
    const result = d.assignTask(task, [agent]);
    expect(result).toBeNull();
  });

  it("prefers idle agent over busy agent", () => {
    const d    = new WorkDistributor();
    const task  = makeTask({ tier: 2 });
    const idle  = makeAgent({ id: "idle-agent" }, { status: "idle" });
    const busy  = makeAgent({ id: "busy-agent" }, { status: "busy", active_task_count: 2 });
    const result = d.assignTask(task, [busy, idle]);
    expect(result!.agent_id).toBe("idle-agent");
  });

  it("load-balances: prefers fewer active tasks", () => {
    const d    = new WorkDistributor();
    const task  = makeTask({ tier: 2 });
    const heavy = makeAgent({ id: "heavy" }, { active_task_count: 3 });
    const light = makeAgent({ id: "light" }, { active_task_count: 1 });
    const result = d.assignTask(task, [heavy, light]);
    expect(result!.agent_id).toBe("light");
  });

  it("includes alternatives_considered count", () => {
    const d    = new WorkDistributor();
    const task  = makeTask({ tier: 2 });
    const a1   = makeAgent({ id: "a1" });
    const a2   = makeAgent({ id: "a2" });
    const result = d.assignTask(task, [a1, a2]);
    expect(result!.alternatives_considered).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// findPeer
// ---------------------------------------------------------------------------

describe("WorkDistributor.findPeer", () => {
  it("finds a same-tier peer", () => {
    const d        = new WorkDistributor();
    const task     = makeTask({ tier: 2 });
    const requester = makeAgent({ id: "req", tier: 2 });
    const peer      = makeAgent({ id: "peer", tier: 2 });
    const result   = d.findPeer("req", task, [requester, peer]);
    expect(result).not.toBeNull();
    expect(result!.definition.id).toBe("peer");
  });

  it("does not return the requesting agent as peer", () => {
    const d        = new WorkDistributor();
    const task     = makeTask({ tier: 2 });
    const requester = makeAgent({ id: "req", tier: 2 });
    const result   = d.findPeer("req", task, [requester]);
    expect(result).toBeNull();
  });

  it("returns null when requesting agent not found", () => {
    const d     = new WorkDistributor();
    const task  = makeTask({ tier: 2 });
    const agent = makeAgent({ id: "other" });
    const result = d.findPeer("unknown", task, [agent]);
    expect(result).toBeNull();
  });

  it("excludes overloaded peers", () => {
    const d        = new WorkDistributor();
    const task     = makeTask({ tier: 2 });
    const req      = makeAgent({ id: "req", tier: 2 });
    const overloaded = makeAgent({ id: "overloaded", tier: 2 }, { status: "overloaded" });
    const result   = d.findPeer("req", task, [req, overloaded]);
    expect(result).toBeNull();
  });

  it("excludes crashed/restarting peers", () => {
    const d       = new WorkDistributor();
    const task    = makeTask({ tier: 2 });
    const req     = makeAgent({ id: "req", tier: 2 });
    const crashed = makeAgent({ id: "crashed", tier: 2 }, { status: "crashed" });
    const result  = d.findPeer("req", task, [req, crashed]);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// rebalance
// ---------------------------------------------------------------------------

describe("WorkDistributor.rebalance", () => {
  it("returns imbalanced=false when single agent", () => {
    const d     = new WorkDistributor();
    const agent = makeAgent({}, { active_task_count: 5 });
    const result = d.rebalance([agent]);
    expect(result.imbalanced).toBe(false);
  });

  it("detects imbalanced load (diff ≥ 3)", () => {
    const d     = new WorkDistributor();
    const busy  = makeAgent({ id: "busy" },  { active_task_count: 5 });
    const idle  = makeAgent({ id: "idle" },  { active_task_count: 0 });
    const result = d.rebalance([busy, idle]);
    expect(result.imbalanced).toBe(true);
    expect(result.recommendations.length).toBeGreaterThan(0);
  });

  it("returns imbalanced=false when load diff < 3", () => {
    const d    = new WorkDistributor();
    const a1   = makeAgent({ id: "a1" }, { active_task_count: 2 });
    const a2   = makeAgent({ id: "a2" }, { active_task_count: 4 });
    const result = d.rebalance([a1, a2]);
    expect(result.imbalanced).toBe(false);
  });

  it("groups by tier for rebalance calculation", () => {
    const d   = new WorkDistributor();
    // T1 balanced, T2 imbalanced
    const t1a = makeAgent({ id: "t1a", tier: 1 }, { active_task_count: 0 });
    const t1b = makeAgent({ id: "t1b", tier: 1 }, { active_task_count: 1 });
    const t2a = makeAgent({ id: "t2a", tier: 2 }, { active_task_count: 0 });
    const t2b = makeAgent({ id: "t2b", tier: 2 }, { active_task_count: 5 });
    const result = d.rebalance([t1a, t1b, t2a, t2b]);
    expect(result.imbalanced).toBe(true);
    // Only T2 agents in recommendations
    expect(result.recommendations.every(
      (r) => r.from_agent === "t2b" || r.to_agent === "t2a",
    )).toBe(true);
  });

  it("returns empty recommendations when no agents", () => {
    const d = new WorkDistributor();
    const result = d.rebalance([]);
    expect(result.imbalanced).toBe(false);
    expect(result.recommendations).toHaveLength(0);
  });
});
