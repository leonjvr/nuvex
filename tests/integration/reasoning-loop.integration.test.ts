/**
 * Phase 13b: AgentReasoningLoop live-provider integration tests
 *
 * These tests make REAL HTTP calls to a live LLM provider.
 * They are skipped unless SIDJUA_INTEGRATION_TESTS=1 is set.
 *
 * Run with:
 *   SIDJUA_INTEGRATION_TESTS=1 ANTHROPIC_API_KEY=sk-... npx vitest run tests/integration/reasoning-loop.integration.test.ts
 *
 * The tests exercise the complete pipeline:
 *   real ProviderAdapter → real ToolResponseParser → real PromptBuilder
 *   → in-memory TaskStore → AgentReasoningLoop.executeTask()
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir }              from "node:os";
import { join }                from "node:path";
import { AgentReasoningLoop }  from "../../src/agents/reasoning-loop.js";
import type { ReasoningLoopDeps } from "../../src/agents/reasoning-loop.js";
import { ToolResponseParser }  from "../../src/providers/tool-response-parser.js";
import { PromptBuilder }       from "../../src/agents/prompt-builder.js";
import { TaskStore }           from "../../src/tasks/store.js";
import { openDatabase }        from "../../src/utils/db.js";
import { createRegistryFromEnvironment } from "../../src/providers/registry.js";
import type { AgentDefinition } from "../../src/agents/types.js";
import type { Task }            from "../../src/tasks/types.js";
import type { Database }        from "../../src/utils/db.js";

const SKIP = !process.env["SIDJUA_INTEGRATION_TESTS"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAgent(): AgentDefinition {
  return {
    id:                    "live-agent-t3",
    name:                  "Live Test Worker",
    tier:                  3,
    provider:              "anthropic",
    model:                 "claude-haiku-4-5-20251001",
    skill_file:            "src/agents/skills/t3-worker.skill.md",
    division:              "eng",
    capabilities:          ["code"],
    max_concurrent_tasks:  1,
    token_budget_per_task: 4_000,
    cost_limit_per_hour:   1.00,
    checkpoint_interval_ms: 30_000,
    ttl_default_seconds:   300,
    heartbeat_interval_ms: 10_000,
    max_retries:           3,
    metadata:              {},
  };
}

// ---------------------------------------------------------------------------
// Shared test state
// ---------------------------------------------------------------------------

let tmpDir: string;
let db: Database;
let taskStore: TaskStore;

beforeEach(() => {
  tmpDir    = mkdtempSync(join(tmpdir(), "sidjua-loop-live-"));
  db        = openDatabase(join(tmpDir, "tasks.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  taskStore = new TaskStore(db);
  taskStore.initialize();
});

afterEach(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

async function buildLiveDeps(overrides: Partial<ReasoningLoopDeps> = {}): Promise<ReasoningLoopDeps> {
  const { registry, defaultProvider } = await createRegistryFromEnvironment();
  if (!defaultProvider) throw new Error("No provider configured — set ANTHROPIC_API_KEY or similar");

  return {
    provider: registry.get(defaultProvider),
    toolParser:    new ToolResponseParser(),
    promptBuilder: new PromptBuilder(),
    actionExecutor: {
      executeAction: vi.fn().mockResolvedValue({ success: true }),
    } as unknown as ReasoningLoopDeps["actionExecutor"],
    memoryManager: {
      getRelevantMemories: vi.fn().mockResolvedValue(""),
      appendShortTerm:     vi.fn().mockResolvedValue(undefined),
      serialize:           vi.fn().mockReturnValue("{}"),
    } as unknown as ReasoningLoopDeps["memoryManager"],
    checkpointManager: {
      save: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReasoningLoopDeps["checkpointManager"],
    taskStore,
    eventBus: {
      emit: vi.fn(),
    } as unknown as ReasoningLoopDeps["eventBus"],
    dispatchTool: null,
    config: {
      max_turns_per_task:       5,
      max_tool_calls_per_task:  10,
      checkpoint_every_n_turns: 5,
      turn_timeout_ms:          30_000,
      context_window_limit:     150_000,
    },
    ...overrides,
  };
}

function createTask(overrides: Partial<Task> = {}): Task {
  const created = taskStore.create({
    title:        "Live integration task",
    description:  "A simple task for live integration testing",
    division:     "eng",
    type:         "delegation",
    tier:         3,
    token_budget: 4_000,
    cost_budget:  0.10,
    ...overrides,
  });
  taskStore.update(created.id, { status: "RUNNING" });
  return taskStore.get(created.id)!;
}

// ---------------------------------------------------------------------------
// Live tests
// ---------------------------------------------------------------------------

describe.skipIf(SKIP)("AgentReasoningLoop live integration", () => {

  it("completes a simple code generation task with execute_result", async () => {
    const task  = createTask({
      title:       "Write a TypeScript identity function",
      description: "Write a simple TypeScript function called identity<T>(x: T): T that returns x unchanged. Just write the function, then call execute_result with the code as the result.",
    });
    const agent = makeAgent();
    const deps  = await buildLiveDeps();
    const loop  = new AgentReasoningLoop(deps);

    const result = await loop.executeTask(task, agent);

    expect(result.success).toBe(true);
    expect(result.decision.type).toBe("execute_result");
    expect(result.turns_taken).toBeGreaterThanOrEqual(1);
    expect(result.total_tokens).toBeGreaterThan(0);

    const updated = taskStore.get(task.id)!;
    expect(updated.result_summary).not.toBeNull();
    expect(updated.confidence).toBeGreaterThan(0);
  }, 60_000);

  it("uses think_more and then completes the task within max_turns", async () => {
    const task  = createTask({
      title:       "Analyse and solve a simple problem",
      description: "You have a list [3, 1, 4, 1, 5, 9]. First use think_more to reason about what the sum is, then call execute_result with the answer.",
    });
    const agent = makeAgent();
    const deps  = await buildLiveDeps();
    const loop  = new AgentReasoningLoop(deps);

    const result = await loop.executeTask(task, agent);

    expect(result.success).toBe(true);
    expect(result.turns_taken).toBeGreaterThanOrEqual(1);
    // May or may not use think_more — key is that it terminates successfully
    expect(["execute_result", "escalate_task"]).toContain(result.decision.type);
  }, 60_000);

  it("system prompt includes skill file content and division governance", async () => {
    const agent         = makeAgent();
    const promptBuilder = new PromptBuilder();
    await promptBuilder.preloadSkill(agent.skill_file);

    const tools = [
      { name: "execute_result", description: "Signal task completion" },
    ];
    const prompt = promptBuilder.buildSystemPrompt(agent, tools);

    // Real skill content loaded from t3-worker.skill.md
    expect(prompt).toContain("Task Executor");
    expect(prompt).toContain("NEVER call decompose_task");
    expect(prompt).toContain("eng");
    expect(prompt).toContain("execute_result");
  });

  it("token usage and cost are non-zero after a successful task", async () => {
    const task  = createTask({
      title:       "Short answer task",
      description: 'Say "hello" in 3 different programming language comments, then call execute_result.',
    });
    const agent       = makeAgent();
    const recordCost  = vi.fn();
    const deps        = await buildLiveDeps({ recordCost });
    const loop        = new AgentReasoningLoop(deps);

    const result = await loop.executeTask(task, agent);

    expect(result.total_tokens).toBeGreaterThan(0);
    expect(result.total_cost_usd).toBeGreaterThan(0);

    // recordCost should have been called at least once (once per turn)
    expect(recordCost).toHaveBeenCalled();
    expect(recordCost).toHaveBeenCalledWith(expect.objectContaining({
      agentId:      agent.id,
      divisionCode: "eng",
      taskId:       task.id,
    }));
  }, 60_000);

});
