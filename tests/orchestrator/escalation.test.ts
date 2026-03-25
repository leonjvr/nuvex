/**
 * Tests for src/orchestrator/escalation.ts
 *
 * Covers:
 * - escalate: same-tier reassignment, parent escalation, budget notification,
 *             timeout retry, quality concern, human_required at T1
 * - handleHumanDecision: retry, cancel, reassign, resolve
 * - getEscalationHistory
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../src/utils/db.js";
import { TaskStore } from "../../src/tasks/store.js";
import { TaskEventBus } from "../../src/tasks/event-bus.js";
import { EscalationManager } from "../../src/orchestrator/escalation.js";
import { WorkDistributor } from "../../src/orchestrator/distributor.js";
import { TaskTreeManager } from "../../src/orchestrator/tree-manager.js";
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
let distributor: WorkDistributor;
let agents: Map<string, AgentInstance>;
let treeManager: TaskTreeManager;
let escalation: EscalationManager;

beforeEach(() => {
  tmpDir      = mkdtempSync(join(tmpdir(), "sidjua-esc-test-"));
  db          = openDatabase(join(tmpDir, "tasks.db"));
  db.pragma("journal_mode = WAL");
  store       = new TaskStore(db);
  store.initialize();
  bus         = new TaskEventBus(db);
  bus.initialize();
  agents      = new Map();
  distributor = new WorkDistributor();
  treeManager = new TaskTreeManager(db, bus);
  escalation  = new EscalationManager(db, bus, distributor, agents, treeManager);
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
    title:        "Task",
    description:  "Description",
    division:     "engineering",
    type:         "root",
    tier:         2,
    token_budget: 10_000,
    cost_budget:  1.0,
    max_retries:  3,
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

function makeAgentInstance(id: string, tier: 1 | 2 | 3 = 2): AgentInstance {
  return {
    definition:            makeAgentDef(id, tier),
    process:               { send: vi.fn() } as unknown as AgentInstance["process"],
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
// escalate: capability_mismatch / agent_requested
// ---------------------------------------------------------------------------

describe("EscalationManager.escalate — same-tier reassignment", () => {
  it("tries same-tier reassignment for capability_mismatch", () => {
    const agent1 = makeAgentInstance("agent-1", 2);
    const agent2 = makeAgentInstance("agent-2", 2);
    agents.set("agent-1", agent1);
    agents.set("agent-2", agent2);

    const task = store.create(makeInput({ assigned_agent: "agent-1" }));
    const result = escalation.escalate(task, "capability_mismatch");

    expect(result.action).toBe("reassigned");
    expect(result.target_agent).toBe("agent-2");
    expect(result.target_tier).toBe(2);
  });

  it("escalates to parent if no same-tier peer available", () => {
    const parent  = store.create(makeInput({ tier: 1 }));
    const child   = store.create(makeInput({ tier: 2, parent_id: parent.id, root_id: parent.id, assigned_agent: "agent-1" }));

    // Only agent-1 registered, no alternatives
    agents.set("agent-1", makeAgentInstance("agent-1", 2));

    const result = escalation.escalate(child, "capability_mismatch");
    expect(result.action).toBe("escalated_to_parent");
  });

  it("marks task as ESCALATED after parent escalation", () => {
    const parent = store.create(makeInput({ tier: 1 }));
    const child  = store.create(makeInput({ tier: 2, parent_id: parent.id, root_id: parent.id }));

    const result = escalation.escalate(child, "max_retries_exceeded");
    expect(result.action).toBe("escalated_to_parent");
    expect(store.get(child.id)!.status).toBe("ESCALATED");
  });
});

// ---------------------------------------------------------------------------
// escalate: max_retries_exceeded / repeated_crashes
// ---------------------------------------------------------------------------

describe("EscalationManager.escalate — parent escalation", () => {
  it("escalates max_retries_exceeded to parent immediately", () => {
    const parent = store.create(makeInput({ tier: 1 }));
    const child  = store.create(makeInput({ tier: 2, parent_id: parent.id, root_id: parent.id }));

    const result = escalation.escalate(child, "max_retries_exceeded");
    expect(result.action).toBe("escalated_to_parent");
    expect(result.target_tier).toBe(1);
  });

  it("escalates repeated_crashes to parent immediately", () => {
    const parent = store.create(makeInput({ tier: 1 }));
    const child  = store.create(makeInput({ tier: 2, parent_id: parent.id, root_id: parent.id }));

    const result = escalation.escalate(child, "repeated_crashes");
    expect(result.action).toBe("escalated_to_parent");
  });
});

// ---------------------------------------------------------------------------
// escalate: budget_exceeded
// ---------------------------------------------------------------------------

describe("EscalationManager.escalate — budget_exceeded", () => {
  it("notifies parent for budget_exceeded", () => {
    const parent = store.create(makeInput({ tier: 1 }));
    const child  = store.create(makeInput({ tier: 2, parent_id: parent.id, root_id: parent.id }));

    const result = escalation.escalate(child, "budget_exceeded");
    expect(result.action).toBe("escalated_to_parent");
  });
});

// ---------------------------------------------------------------------------
// escalate: timeout
// ---------------------------------------------------------------------------

describe("EscalationManager.escalate — timeout", () => {
  it("resets to PENDING with incremented retry on timeout", () => {
    const parent = store.create(makeInput({ tier: 1 }));
    const task   = store.create(makeInput({
      tier: 2, parent_id: parent.id, root_id: parent.id,
      max_retries: 3,
    }));
    store.update(task.id, { retry_count: 0, status: "RUNNING" });

    const result = escalation.escalate(store.get(task.id)!, "timeout");
    expect(result.action).toBe("retrying");
    expect(store.get(task.id)!.retry_count).toBe(1);
    expect(store.get(task.id)!.status).toBe("PENDING");
  });

  it("escalates to parent when timeout retries exhausted", () => {
    const parent = store.create(makeInput({ tier: 1 }));
    const task   = store.create(makeInput({
      tier: 2, parent_id: parent.id, root_id: parent.id,
      max_retries: 2,
    }));
    store.update(task.id, { retry_count: 2, status: "RUNNING" });

    const result = escalation.escalate(store.get(task.id)!, "timeout");
    expect(result.action).toBe("escalated_to_parent");
  });
});

// ---------------------------------------------------------------------------
// escalate: quality_concern
// ---------------------------------------------------------------------------

describe("EscalationManager.escalate — quality_concern", () => {
  it("resets task to PENDING with quality feedback appended", () => {
    const parent = store.create(makeInput({ tier: 1 }));
    const task   = store.create(makeInput({
      tier: 2, parent_id: parent.id, root_id: parent.id,
      description: "Original description",
    }));

    const result = escalation.escalate(task, "quality_concern");
    expect(result.action).toBe("retrying");

    const updated = store.get(task.id)!;
    expect(updated.status).toBe("PENDING");
    expect(updated.description).toContain("QUALITY_REVIEW");
    expect(updated.description).toContain("Original description");
  });
});

// ---------------------------------------------------------------------------
// escalate: HUMAN_REQUIRED (T1)
// ---------------------------------------------------------------------------

describe("EscalationManager.escalate — human_required", () => {
  it("marks task HUMAN_REQUIRED when T1 task fails", () => {
    const t1Task = store.create(makeInput({ tier: 1 }));
    const result = escalation.escalate(t1Task, "max_retries_exceeded");
    expect(result.action).toBe("human_required");
    expect(result.target_agent).toBeNull();
    expect(store.get(t1Task.id)!.status).toBe("ESCALATED");
  });

  it("writes to human_decisions table", () => {
    const task   = store.create(makeInput({ tier: 1 }));
    escalation.escalate(task, "max_retries_exceeded");

    const row = db.prepare("SELECT * FROM human_decisions WHERE task_id = ?").get(task.id) as Record<string, unknown> | undefined;
    expect(row).toBeDefined();
    expect(row!["reason"]).toBe("max_retries_exceeded");
    expect(row!["decided_at"]).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// handleHumanDecision
// ---------------------------------------------------------------------------

describe("EscalationManager.handleHumanDecision", () => {
  it("retry: resets task to PENDING with guidance", () => {
    const task = store.create(makeInput({ tier: 1 }));
    store.update(task.id, { status: "ESCALATED" });

    escalation.handleHumanDecision(task.id, {
      action:   "retry",
      guidance: "Try a different approach",
    });

    const updated = store.get(task.id)!;
    expect(updated.status).toBe("PENDING");
    expect(updated.description).toContain("HUMAN_GUIDANCE");
    expect(updated.description).toContain("Try a different approach");
    expect(updated.retry_count).toBe(0);
  });

  it("retry: works without guidance", () => {
    const task = store.create(makeInput({ tier: 1 }));
    escalation.handleHumanDecision(task.id, { action: "retry" });
    expect(store.get(task.id)!.status).toBe("PENDING");
  });

  it("cancel: cancels task and descendants", () => {
    const root  = store.create(makeInput({ tier: 1 }));
    const child = store.create(makeInput({ tier: 2, type: "delegation", parent_id: root.id, root_id: root.id }));

    escalation.handleHumanDecision(root.id, { action: "cancel" });

    // Both root and child should be CANCELLED
    expect(store.get(root.id)!.status).toBe("CANCELLED");
    expect(store.get(child.id)!.status).toBe("CANCELLED");
  });

  it("reassign: assigns to specific agent", () => {
    const task = store.create(makeInput({ tier: 2 }));
    store.update(task.id, { status: "ESCALATED" });

    escalation.handleHumanDecision(task.id, {
      action:       "reassign",
      target_agent: "special-agent",
    });

    const updated = store.get(task.id)!;
    expect(updated.status).toBe("ASSIGNED");
    expect(updated.assigned_agent).toBe("special-agent");
  });

  it("resolve: marks task DONE with human result", () => {
    const task = store.create(makeInput({ tier: 1 }));
    store.update(task.id, { status: "ESCALATED" });

    escalation.handleHumanDecision(task.id, {
      action: "resolve",
      result: "The answer is 42",
    });

    const updated = store.get(task.id)!;
    expect(updated.status).toBe("DONE");
    expect(updated.result_summary).toBe("The answer is 42");
    expect(updated.completed_at).not.toBeNull();
  });

  it("handles unknown task gracefully", () => {
    // Should not throw
    expect(() => {
      escalation.handleHumanDecision("nonexistent", { action: "retry" });
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// getEscalationHistory
// ---------------------------------------------------------------------------

describe("EscalationManager.getEscalationHistory", () => {
  it("returns empty array for task with no escalations", () => {
    const task = store.create(makeInput({ tier: 2 }));
    expect(escalation.getEscalationHistory(task.id)).toHaveLength(0);
  });

  it("returns escalation records in chronological order", () => {
    const parent = store.create(makeInput({ tier: 1 }));
    const task   = store.create(makeInput({ tier: 2, parent_id: parent.id, root_id: parent.id }));

    escalation.escalate(task, "timeout");
    const updated = store.get(task.id)!;
    if (updated.status === "PENDING") {
      // Retry happened — escalate again after exhausting
      store.update(task.id, { retry_count: 3, status: "RUNNING" });
      escalation.escalate(store.get(task.id)!, "timeout");
    }

    const history = escalation.getEscalationHistory(task.id);
    expect(history.length).toBeGreaterThanOrEqual(1);
    expect(history[0]!.task_id).toBe(task.id);
    expect(history[0]!.reason).toBe("timeout");
  });

  it("records escalation with correct fields", () => {
    const parent = store.create(makeInput({ tier: 1 }));
    const task   = store.create(makeInput({
      tier: 2, parent_id: parent.id, root_id: parent.id,
      assigned_agent: "agent-x",
    }));

    escalation.escalate(task, "max_retries_exceeded");

    const history = escalation.getEscalationHistory(task.id);
    expect(history).toHaveLength(1);
    expect(history[0]!.from_agent).toBe("agent-x");
    expect(history[0]!.from_tier).toBe(2);
    expect(history[0]!.to_tier).toBe(1);
    expect(history[0]!.reason).toBe("max_retries_exceeded");
    expect(history[0]!.resolution).toBe("reassigned");
  });
});
