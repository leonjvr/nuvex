/**
 * Phase 13c: Governance Integration Tests (env-gated)
 *
 * Tests Pre-Action Pipeline enforcement, budget limits, and cost tracking
 * during real task execution.
 *
 * Gated by SIDJUA_INTEGRATION_TESTS=1.
 * Run with: SIDJUA_INTEGRATION_TESTS=1 ANTHROPIC_API_KEY=sk-... npm test -- governance.integration
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync }   from "node:fs";
import { tmpdir }                from "node:os";
import { join }                  from "node:path";
import { openDatabase }          from "../../src/utils/db.js";
import { TaskStore }             from "../../src/tasks/store.js";
import { TaskEventBus }          from "../../src/tasks/event-bus.js";
import { ExecutionBridge }       from "../../src/orchestrator/execution-bridge.js";
import { SynthesisHandler }      from "../../src/orchestrator/synthesis-handler.js";
import { AgentReasoningLoop }    from "../../src/agents/reasoning-loop.js";
import { AnthropicAdapter }      from "../../src/providers/adapters/anthropic-adapter.js";
import { ToolResponseParser }    from "../../src/providers/tool-response-parser.js";
import { PromptBuilder }         from "../../src/agents/prompt-builder.js";
import { PHASE9_SCHEMA_SQL }     from "../../src/orchestrator/types.js";
import { DEFAULT_REASONING_CONFIG } from "../../src/agents/reasoning-loop.js";
import type { Database }         from "../../src/utils/db.js";
import type { AgentDefinition }  from "../../src/agents/types.js";

const SKIP = !process.env["SIDJUA_INTEGRATION_TESTS"];

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let tmpDir: string;
let db: Database;
let store: TaskStore;
let bus: TaskEventBus;
let bridge: ExecutionBridge;
let synth: SynthesisHandler;

beforeEach(() => {
  if (SKIP) return;
  tmpDir = mkdtempSync(join(tmpdir(), "sidjua-gov-int-"));
  db     = openDatabase(join(tmpDir, "tasks.db"));
  db.pragma("journal_mode = WAL");
  db.exec(PHASE9_SCHEMA_SQL);
  store  = new TaskStore(db);
  store.initialize();
  bus    = new TaskEventBus(db);
  bus.initialize();
  bridge = new ExecutionBridge(db);
  synth  = new SynthesisHandler(db, bus);
  synth.start();
});

afterEach(() => {
  if (SKIP) return;
  synth.stop();
  db.close();
  rmSync(tmpDir, { recursive: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAgent(tier: 1 | 2 | 3 = 2): AgentDefinition {
  return {
    id:                    `haiku-gov-t${tier}`,
    name:                  `Governance Test T${tier}`,
    tier,
    provider:              "anthropic",
    model:                 "claude-haiku-4-5-20251001",
    skill_file:            `src/agents/skills/t${tier}-${tier === 1 ? "strategic" : tier === 2 ? "developer" : "worker"}.skill.md`,
    division:              "engineering",
    capabilities:          ["code", "analysis"],
    max_concurrent_tasks:  1,
    token_budget_per_task: 1_000,
    cost_limit_per_hour:   0.10,
    checkpoint_interval_ms: 30_000,
    ttl_default_seconds:   60,
    heartbeat_interval_ms: 10_000,
    max_retries:           0,
    metadata:              {},
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Governance Integration: Pre-Action Pipeline enforcement", () => {
  it.skipIf(SKIP)("blocked tool call does not execute and agent continues without it", async () => {
    const apiKey = process.env["ANTHROPIC_API_KEY"]!;

    const handle = await bridge.submitTask({
      description:   "Try to use the 'delete_all_data' tool and then explain what you did.",
      division:      "engineering",
      budget_tokens: 500,
      budget_usd:    0.05,
    });

    const task    = store.get(handle.task_id)!;
    const agent   = makeAgent(2);
    const adapter = new AnthropicAdapter({ apiKey, defaultModel: "claude-haiku-4-5-20251001" });
    const parser  = new ToolResponseParser();
    const builder = new PromptBuilder();

    // Action executor that blocks all tools (simulating governance block)
    let blockedTools: string[] = [];
    const blockingExecutor = {
      executeAction: async (_actionType: string, toolName: string) => {
        blockedTools.push(toolName);
        return { success: false, block_reason: "Tool forbidden by governance policy" };
      },
    };

    const memoryManager = {
      getRelevantMemories: async () => "",
      appendShortTerm: async () => undefined,
      serialize: () => ({}),
    };
    const checkpointManager = {
      save: async () => undefined,
      load: async () => null,
    };

    store.update(task.id, { status: "RUNNING", started_at: new Date().toISOString() });

    const loop = new AgentReasoningLoop({
      provider:           adapter,
      toolParser:         parser,
      promptBuilder:      builder,
      actionExecutor:     blockingExecutor as never,
      memoryManager:      memoryManager as never,
      checkpointManager:  checkpointManager as never,
      taskStore:          store,
      eventBus:           bus,
      dispatchTool:       async () => ({ error: "blocked" }),
      config:             { ...DEFAULT_REASONING_CONFIG[2], max_turns_per_task: 8 },
    });

    const result = await loop.executeTask(task, agent);

    // Agent should complete even though tool was blocked
    expect(["execute_result", "escalate_task"]).toContain(result.decision.type);
    expect(result.turns_taken).toBeGreaterThan(0);
  }, 60_000);

  it.skipIf(SKIP)("budget limit enforced: task tree stops when budget_usd exceeded", async () => {
    // Submit task with very low budget
    const handle = await bridge.submitTask({
      description:   "Perform extensive analysis requiring many LLM calls",
      budget_usd:    0.001, // nearly zero budget
      budget_tokens: 100,
    });

    // Simulate tasks exceeding budget
    const children = [
      store.create({
        title: "Analysis A", description: "A",
        division: "engineering", type: "delegation", tier: 2,
        parent_id: handle.task_id, root_id: handle.task_id,
        token_budget: 50, cost_budget: 0.0005,
      }),
    ];
    store.update(children[0]!.id, { status: "RUNNING", cost_used: 0.002 });
    store.update(handle.task_id, { cost_used: 0.0005, sub_tasks_expected: 1, status: "WAITING" });

    // Total cost: 0.002 + 0.0005 = 0.0025 > 0.001 budget
    const exhausted = await bridge.enforceBudget(handle.task_id, 0.001);
    expect(exhausted).toBe(true);

    // All non-terminal tasks cancelled
    const updatedChild = store.get(children[0]!.id)!;
    expect(updatedChild.status).toBe("CANCELLED");
  }, 30_000);

  it.skipIf(SKIP)("cost tracking accurate across multi-agent delegation tree", async () => {
    const apiKey = process.env["ANTHROPIC_API_KEY"]!;

    // Create task tree with 2 T2 sub-tasks
    const handle = await bridge.submitTask({
      description:   "Simple two-part analysis",
      budget_tokens: 2_000,
      budget_usd:    0.20,
    });

    const t1Task = store.get(handle.task_id)!;
    store.update(t1Task.id, {
      status:         "WAITING",
      sub_tasks_expected: 2,
      token_used:     200,
      cost_used:      0.02,
    });

    const child1 = store.create({
      title: "Part A", description: "Analyze X",
      division: "engineering", type: "delegation", tier: 2,
      parent_id: t1Task.id, root_id: t1Task.id,
      token_budget: 500, cost_budget: 0.05,
    });
    store.update(child1.id, { status: "DONE", token_used: 150, cost_used: 0.015 });

    const child2 = store.create({
      title: "Part B", description: "Analyze Y",
      division: "engineering", type: "delegation", tier: 2,
      parent_id: t1Task.id, root_id: t1Task.id,
      token_budget: 500, cost_budget: 0.05,
    });
    store.update(child2.id, { status: "DONE", token_used: 180, cost_used: 0.018 });

    // Check tree cost is aggregated correctly
    const status = await bridge.getTaskStatus(handle.task_id);

    // Total: 200 (T1) + 150 (C1) + 180 (C2) = 530 tokens
    expect(status.total_tokens_used).toBe(530);
    // Total cost: 0.02 + 0.015 + 0.018 = 0.053
    expect(status.total_cost_usd).toBeCloseTo(0.053, 3);
  }, 30_000);
});
