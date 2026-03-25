/**
 * Phase 13b: AgentReasoningLoop mock-integration tests
 *
 * Uses real ToolResponseParser + real PromptBuilder + real TaskStore (in-memory DB).
 * Provider, MemoryManager, CheckpointManager, and EventBus remain mocked.
 *
 * These tests verify the full data flow without live LLM network calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync }  from "node:fs";
import { tmpdir }               from "node:os";
import { join }                 from "node:path";
import { AgentReasoningLoop }   from "../../src/agents/reasoning-loop.js";
import type { ReasoningLoopDeps } from "../../src/agents/reasoning-loop.js";
import { ToolResponseParser }   from "../../src/providers/tool-response-parser.js";
import { PromptBuilder }        from "../../src/agents/prompt-builder.js";
import { TaskStore }            from "../../src/tasks/store.js";
import { openDatabase }         from "../../src/utils/db.js";
import type { AgentDefinition } from "../../src/agents/types.js";
import type { Task }            from "../../src/tasks/types.js";
import type { ToolLLMResponse } from "../../src/providers/types.js";
import type { Database }        from "../../src/utils/db.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id:                    "integration-agent-01",
    name:                  "Integration Worker",
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
    ...overrides,
  };
}

/** Build a ToolLLMResponse that the real ToolResponseParser can parse. */
function toolResponse(toolName: string, input: Record<string, unknown>): ToolLLMResponse {
  return {
    toolCalls:   [{ name: toolName, input }],
    textContent: "",
    content:     "",
    usage:       { inputTokens: 120, outputTokens: 60, totalTokens: 180 },
    latencyMs:   40,
    model:       "claude-haiku-4-5-20251001",
    provider:    "anthropic",
  };
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let tmpDir: string;
let db: Database;
let taskStore: TaskStore;
let parentTask: Task;

beforeEach(async () => {
  tmpDir    = mkdtempSync(join(tmpdir(), "sidjua-loop-int-"));
  db        = openDatabase(join(tmpDir, "tasks.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  taskStore = new TaskStore(db);
  taskStore.initialize();

  parentTask = taskStore.create({
    title:        "Integration test task",
    description:  "A task for integration testing",
    division:     "eng",
    type:         "delegation",
    tier:         3,
    token_budget: 4_000,
    cost_budget:  0.10,
  });
  // Manually set RUNNING status so reasoning-loop preconditions are met
  taskStore.update(parentTask.id, { status: "RUNNING" });
  parentTask = taskStore.get(parentTask.id)!;
});

afterEach(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

function makeDeps(
  chatWithToolsMock: ReturnType<typeof vi.fn>,
  overrides: Partial<ReasoningLoopDeps> = {},
): ReasoningLoopDeps {
  return {
    provider: {
      providerName:   "mock",
      defaultModel:   "claude-haiku-4-5-20251001",
      chat:           vi.fn(),
      chatWithTools:  chatWithToolsMock,
      estimateTokens: vi.fn().mockReturnValue(100),
      getModels:      vi.fn().mockReturnValue([]),
    },
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
      max_turns_per_task:       10,
      max_tool_calls_per_task:  50,
      checkpoint_every_n_turns: 5,
      turn_timeout_ms:          5_000,
      context_window_limit:     150_000,
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AgentReasoningLoop integration (mock provider, real parser+store)", () => {

  it("full single-agent flow: provider → execute_result → TaskStore updated", async () => {
    const mock = vi.fn().mockResolvedValue(
      toolResponse("execute_result", {
        result:     "function add(a, b) { return a + b; }",
        summary:    "Implemented add function",
        confidence: 0.95,
      }),
    );
    const deps = makeDeps(mock);
    const loop = new AgentReasoningLoop(deps);

    const result = await loop.executeTask(parentTask, makeAgent());

    expect(result.success).toBe(true);
    expect(result.turns_taken).toBe(1);
    expect(result.decision.type).toBe("execute_result");

    // Verify TaskStore persisted the update
    const updated = taskStore.get(parentTask.id)!;
    expect(updated.result_summary).toBe("Implemented add function");
    expect(updated.confidence).toBeCloseTo(0.95);
    expect(updated.token_used).toBeGreaterThan(0);
  });

  it("multi-turn tool use: use_tool → execute_result persisted correctly", async () => {
    const dispatcher = vi.fn().mockResolvedValue({ count: 10 });
    const mock = vi.fn()
      .mockResolvedValueOnce(
        toolResponse("use_tool", {
          tool_name:  "count_items",
          tool_input: { collection: "tasks" },
          purpose:    "Count tasks in the system",
        }),
      )
      .mockResolvedValueOnce(
        toolResponse("execute_result", {
          result:     "There are 10 tasks",
          summary:    "Retrieved task count",
          confidence: 0.98,
        }),
      );

    const deps = makeDeps(mock, { dispatchTool: dispatcher });
    const loop = new AgentReasoningLoop(deps);

    const result = await loop.executeTask(parentTask, makeAgent());

    expect(result.success).toBe(true);
    expect(result.turns_taken).toBe(2);
    expect(dispatcher).toHaveBeenCalledWith("count_items", { collection: "tasks" });

    const updated = taskStore.get(parentTask.id)!;
    expect(updated.result_summary).toBe("Retrieved task count");
  });

  it("decomposition: creates valid sub-tasks in real TaskStore, parent updated", async () => {
    const agent = makeAgent({ tier: 2 });
    const parentT2 = taskStore.create({
      title:        "Complex task",
      description:  "Needs decomposition",
      division:     "eng",
      type:         "delegation",
      tier:         2,
      token_budget: 8_000,
      cost_budget:  0.50,
    });
    taskStore.update(parentT2.id, { status: "RUNNING" });
    const task = taskStore.get(parentT2.id)!;

    const mock = vi.fn().mockResolvedValueOnce(
      toolResponse("decompose_task", {
        reasoning:  "Two independent sub-problems",
        sub_tasks: [
          { title: "Sub-task Alpha", description: "Handle part A", tier: 3 },
          { title: "Sub-task Beta",  description: "Handle part B", tier: 3 },
        ],
      }),
    );

    const deps = makeDeps(mock);
    const loop = new AgentReasoningLoop(deps);

    const result = await loop.executeTask(task, agent);

    expect(result.success).toBe(true);
    expect(result.decision.type).toBe("decompose_task");

    // Verify sub-tasks created in real DB
    const children = taskStore.getByParent(parentT2.id);
    expect(children).toHaveLength(2);
    expect(children[0]?.title).toBe("Sub-task Alpha");
    expect(children[1]?.title).toBe("Sub-task Beta");
    expect(children[0]?.tier).toBe(3);

    // Verify parent updated
    const updatedParent = taskStore.get(parentT2.id)!;
    expect(updatedParent.sub_tasks_expected).toBe(2);
  });

  it("governance block: blocked tool call → agent receives block message → recovers with execute_result", async () => {
    const mock = vi.fn()
      .mockResolvedValueOnce(
        toolResponse("use_tool", {
          tool_name:  "delete_all_data",
          tool_input: {},
          purpose:    "Clean up",
        }),
      )
      .mockResolvedValueOnce(
        toolResponse("execute_result", {
          result:     "Used alternative approach without delete_all_data",
          summary:    "Completed without destructive tool",
          confidence: 0.80,
        }),
      );

    const blockedExecutor = {
      executeAction: vi.fn().mockResolvedValueOnce({
        success:      false,
        blocked:      true,
        block_reason: "delete_all_data is forbidden by governance policy",
      }).mockResolvedValue({ success: true }),
    } as unknown as ReasoningLoopDeps["actionExecutor"];

    const deps = makeDeps(mock, { actionExecutor: blockedExecutor });
    const loop = new AgentReasoningLoop(deps);

    const result = await loop.executeTask(parentTask, makeAgent());

    expect(result.success).toBe(true);
    expect(result.turns_taken).toBe(2);

    // The block event must have been emitted
    expect((deps.eventBus.emit as ReturnType<typeof vi.fn>))
      .toHaveBeenCalledWith("agent.tool.blocked", expect.objectContaining({
        tool_name: "delete_all_data",
      }));
  });

  it("checkpoint: checkpointManager.save() called at turn 6 (every 5 turns)", async () => {
    // think_more for turns 1-5, then execute_result on turn 6
    const mock = vi.fn();
    for (let i = 0; i < 5; i++) {
      mock.mockResolvedValueOnce(
        toolResponse("think_more", {
          thoughts:  `Reasoning step ${i + 1}`,
          next_step: "Continue",
        }),
      );
    }
    mock.mockResolvedValueOnce(
      toolResponse("execute_result", {
        result:     "Done after much thought",
        summary:    "Completed after 5 think_more turns",
        confidence: 0.85,
      }),
    );

    const checkpointSave = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps(mock, {
      checkpointManager: { save: checkpointSave } as unknown as ReasoningLoopDeps["checkpointManager"],
      config: {
        max_turns_per_task:       10,
        max_tool_calls_per_task:  50,
        checkpoint_every_n_turns: 5,
        turn_timeout_ms:          5_000,
        context_window_limit:     150_000,
      },
    });

    const loop   = new AgentReasoningLoop(deps);
    const result = await loop.executeTask(parentTask, makeAgent());

    expect(result.success).toBe(true);
    expect(result.turns_taken).toBe(6);
    // Checkpoint fires at turn 6: turn > 1 && (6 - 1) % 5 === 0
    expect(checkpointSave).toHaveBeenCalledTimes(1);
    expect(checkpointSave).toHaveBeenCalledWith(
      expect.objectContaining({
        agent_id: makeAgent().id,
        task_states: expect.arrayContaining([
          expect.objectContaining({ task_id: parentTask.id }),
        ]),
      }),
    );
  });

});
