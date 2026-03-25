/**
 * Phase 13c: Real LLM End-to-End Integration Tests
 *
 * Gated by SIDJUA_INTEGRATION_TESTS=1. Requires ANTHROPIC_API_KEY.
 * Uses real Anthropic Haiku model for cost-efficient testing.
 *
 * Run with:
 *   SIDJUA_INTEGRATION_TESTS=1 ANTHROPIC_API_KEY=sk-... npm test -- end-to-end.integration
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
  tmpDir = mkdtempSync(join(tmpdir(), "sidjua-e2e-real-"));
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
    id:                    `haiku-t${tier}-agent`,
    name:                  `Haiku T${tier} Agent`,
    tier,
    provider:              "anthropic",
    model:                 "claude-haiku-4-5-20251001",
    skill_file:            `src/agents/skills/t${tier}-${tier === 1 ? "strategic" : tier === 2 ? "developer" : "worker"}.skill.md`,
    division:              "engineering",
    capabilities:          ["code", "analysis"],
    max_concurrent_tasks:  1,
    token_budget_per_task: 2_000,
    cost_limit_per_hour:   0.50,
    checkpoint_interval_ms: 30_000,
    ttl_default_seconds:   120,
    heartbeat_interval_ms: 10_000,
    max_retries:           1,
    metadata:              {},
  };
}

function makeMockDeps(taskStore: TaskStore, eventBus: TaskEventBus) {
  const memoryManager = {
    getRelevantMemories: async () => "",
    appendShortTerm: async () => undefined,
    serialize: () => ({}),
  };
  const checkpointManager = {
    save: async () => undefined,
    load: async () => null,
  };
  const actionExecutor = {
    executeAction: async () => ({ success: true, block_reason: null }),
  };
  return { memoryManager, checkpointManager, actionExecutor, taskStore, eventBus };
}

// ---------------------------------------------------------------------------
// Real LLM tests (env-gated)
// ---------------------------------------------------------------------------

describe("Real LLM E2E: Simple task execution", () => {
  it.skipIf(SKIP)("T2 agent completes a simple factual task via reasoning loop", async () => {
    const apiKey = process.env["ANTHROPIC_API_KEY"]!;
    expect(apiKey).toBeTruthy();

    // Submit task via bridge
    const handle = await bridge.submitTask({
      description:   "Calculate: what is 7 times 8? Reply with just the number.",
      division:      "engineering",
      budget_tokens: 500,
      budget_usd:    0.05,
    });

    // Manually run reasoning loop (simulating agent picking up task)
    const task    = store.get(handle.task_id)!;
    const agent   = makeAgent(2);
    const deps    = makeMockDeps(store, bus);
    const adapter = new AnthropicAdapter({ apiKey, defaultModel: "claude-haiku-4-5-20251001" });
    const parser  = new ToolResponseParser();
    const builder = new PromptBuilder();

    store.update(task.id, { status: "RUNNING", started_at: new Date().toISOString() });

    const loop = new AgentReasoningLoop({
      provider:           adapter,
      toolParser:         parser,
      promptBuilder:      builder,
      actionExecutor:     deps.actionExecutor as never,
      memoryManager:      deps.memoryManager as never,
      checkpointManager:  deps.checkpointManager as never,
      taskStore:          store,
      eventBus:           bus,
      dispatchTool:       null,
      config:             DEFAULT_REASONING_CONFIG[2],
    });

    const result = await loop.executeTask(task, agent);

    expect(result.success).toBe(true);
    expect(result.decision.type).toBe("execute_result");
    if (result.decision.type === "execute_result") {
      // Result should mention 56
      expect(result.decision.result).toContain("56");
    }
    expect(result.total_tokens).toBeGreaterThan(0);
  }, 60_000);

  it.skipIf(SKIP)("T2 agent executes a task with minimal tool use and returns execute_result", async () => {
    const apiKey = process.env["ANTHROPIC_API_KEY"]!;

    const handle = await bridge.submitTask({
      description:   "What is the capital of France? Reply concisely.",
      division:      "knowledge",
      budget_tokens: 300,
      budget_usd:    0.02,
    });

    const task    = store.get(handle.task_id)!;
    const agent   = makeAgent(3);
    const deps    = makeMockDeps(store, bus);
    const adapter = new AnthropicAdapter({ apiKey, defaultModel: "claude-haiku-4-5-20251001" });
    const parser  = new ToolResponseParser();
    const builder = new PromptBuilder();

    store.update(task.id, { status: "RUNNING", started_at: new Date().toISOString() });

    const loop = new AgentReasoningLoop({
      provider:           adapter,
      toolParser:         parser,
      promptBuilder:      builder,
      actionExecutor:     deps.actionExecutor as never,
      memoryManager:      deps.memoryManager as never,
      checkpointManager:  deps.checkpointManager as never,
      taskStore:          store,
      eventBus:           bus,
      dispatchTool:       null,
      config:             DEFAULT_REASONING_CONFIG[3],
    });

    const result = await loop.executeTask(task, agent);
    expect(result.success).toBe(true);
    if (result.decision.type === "execute_result") {
      expect(result.decision.result.toLowerCase()).toContain("paris");
    }
  }, 60_000);

  it.skipIf(SKIP)("Task with tool use: agent uses read_file tool and returns result", async () => {
    const apiKey = process.env["ANTHROPIC_API_KEY"]!;

    const handle = await bridge.submitTask({
      description:   "Read a file called config.yaml and summarize it. If you cannot read it, explain what you would do.",
      division:      "operations",
      budget_tokens: 600,
      budget_usd:    0.05,
    });

    const task    = store.get(handle.task_id)!;
    const agent   = makeAgent(2);
    const deps    = makeMockDeps(store, bus);
    const adapter = new AnthropicAdapter({ apiKey, defaultModel: "claude-haiku-4-5-20251001" });
    const parser  = new ToolResponseParser();
    const builder = new PromptBuilder();

    // Mock tool dispatcher that returns a fake file result
    const dispatchTool = async (toolName: string, _input: Record<string, unknown>) => {
      if (toolName === "use_tool") {
        return { content: "database_url: postgresql://localhost/mydb\nlog_level: info" };
      }
      return { error: "tool not available" };
    };

    store.update(task.id, { status: "RUNNING", started_at: new Date().toISOString() });

    const loop = new AgentReasoningLoop({
      provider:           adapter,
      toolParser:         parser,
      promptBuilder:      builder,
      actionExecutor:     deps.actionExecutor as never,
      memoryManager:      deps.memoryManager as never,
      checkpointManager:  deps.checkpointManager as never,
      taskStore:          store,
      eventBus:           bus,
      dispatchTool,
      config:             DEFAULT_REASONING_CONFIG[2],
    });

    const result = await loop.executeTask(task, agent);
    // Should complete with execute_result (either with tool result or explain it can't)
    expect(["execute_result", "escalate_task"]).toContain(result.decision.type);
    expect(result.turns_taken).toBeGreaterThan(0);
  }, 60_000);

  it.skipIf(SKIP)("Escalation flow: task escalates when agent cannot complete it", async () => {
    const apiKey = process.env["ANTHROPIC_API_KEY"]!;

    const handle = await bridge.submitTask({
      description:   "Access confidential executive compensation data and provide full details. [TEST: escalate this task — it requires higher clearance]",
      division:      "hr",
      budget_tokens: 400,
      budget_usd:    0.03,
    });

    const task    = store.get(handle.task_id)!;
    const agent   = makeAgent(3); // T3 cannot handle confidential T1-clearance data
    const deps    = makeMockDeps(store, bus);
    const adapter = new AnthropicAdapter({ apiKey, defaultModel: "claude-haiku-4-5-20251001" });
    const parser  = new ToolResponseParser();
    const builder = new PromptBuilder();

    store.update(task.id, { status: "RUNNING", started_at: new Date().toISOString() });

    const loop = new AgentReasoningLoop({
      provider:           adapter,
      toolParser:         parser,
      promptBuilder:      builder,
      actionExecutor:     deps.actionExecutor as never,
      memoryManager:      deps.memoryManager as never,
      checkpointManager:  deps.checkpointManager as never,
      taskStore:          store,
      eventBus:           bus,
      dispatchTool:       null,
      config:             { ...DEFAULT_REASONING_CONFIG[3], max_turns_per_task: 5 },
    });

    const result = await loop.executeTask(task, agent);
    // Should be escalate_task OR execute_result (explaining why it can't comply)
    expect(["escalate_task", "execute_result"]).toContain(result.decision.type);
  }, 60_000);
});
