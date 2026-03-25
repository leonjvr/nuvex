/**
 * Phase 13b: AgentReasoningLoop unit tests
 *
 * All external deps are mocked — no DB, no HTTP, no real provider.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgentReasoningLoop }    from "../../src/agents/reasoning-loop.js";
import type { ReasoningLoopDeps } from "../../src/agents/reasoning-loop.js";
import type { AgentDefinition }   from "../../src/agents/types.js";
import type { Task }              from "../../src/tasks/types.js";
import type { ToolLLMResponse }   from "../../src/providers/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id:                    "agent-t3-01",
    name:                  "Test Worker",
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

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id:                   "task-001",
    parent_id:            null,
    root_id:              "task-001",
    division:             "eng",
    type:                 "delegation",
    tier:                 3,
    title:                "Write a function",
    description:          "Write a TypeScript function that adds two numbers.",
    assigned_agent:       "agent-t3-01",
    status:               "RUNNING",
    priority:             3,
    classification:       "internal",
    created_at:           new Date().toISOString(),
    updated_at:           new Date().toISOString(),
    started_at:           new Date().toISOString(),
    completed_at:         null,
    result_file:          null,
    result_summary:       null,
    confidence:           null,
    token_budget:         4_000,
    token_used:           0,
    cost_budget:          0.10,
    cost_used:            0,
    ttl_seconds:          300,
    retry_count:          0,
    max_retries:          3,
    checkpoint:           null,
    sub_tasks_expected:   0,
    sub_tasks_received:   0,
    embedding_id:         null,
    metadata:             {},
    ...overrides,
  };
}

function makeToolResponse(overrides: Partial<ToolLLMResponse> = {}): ToolLLMResponse {
  return {
    content:     "",
    toolCalls:   [],
    textContent: "",
    usage:       { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    finishReason: "end_turn",
    latencyMs:   50,
    model:       "claude-haiku-4-5-20251001",
    provider:    "anthropic",
    ...overrides,
  };
}

function makeDeps(overrides: Partial<ReasoningLoopDeps> = {}): ReasoningLoopDeps {
  return {
    provider: {
      providerName:   "mock",
      defaultModel:   "claude-haiku-4-5-20251001",
      chat:           vi.fn(),
      chatWithTools:  vi.fn(),
      estimateTokens: vi.fn().mockReturnValue(100),
      getModels:      vi.fn().mockReturnValue([]),
    },
    toolParser: {
      parse: vi.fn(),
    } as unknown as ReasoningLoopDeps["toolParser"],
    promptBuilder: {
      preloadSkill:           vi.fn().mockResolvedValue(undefined),
      buildSystemPrompt:      vi.fn().mockReturnValue("system-prompt"),
      buildTaskPrompt:        vi.fn().mockReturnValue("task-prompt"),
      buildToolResultMessage: vi.fn().mockReturnValue({ role: "user", content: "tool result" }),
      summarizeConversation:  vi.fn().mockImplementation((msgs: unknown[]) => msgs),
    } as unknown as ReasoningLoopDeps["promptBuilder"],
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
    taskStore: {
      create: vi.fn().mockReturnValue({ id: "child-001" }),
      update: vi.fn(),
    } as unknown as ReasoningLoopDeps["taskStore"],
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

describe("AgentReasoningLoop.executeTask", () => {

  it("single-turn execute: returns success on first execute_result", async () => {
    const deps  = makeDeps();
    const agent = makeAgent();
    const task  = makeTask();

    (deps.provider.chatWithTools as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(makeToolResponse());

    (deps.toolParser.parse as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce({
        type:       "execute_result",
        result:     "function add(a,b){return a+b;}",
        summary:    "Implemented add function",
        confidence: 0.95,
      });

    const loop   = new AgentReasoningLoop(deps);
    const result = await loop.executeTask(task, agent);

    expect(result.success).toBe(true);
    expect(result.turns_taken).toBe(1);
    expect(result.decision.type).toBe("execute_result");
    expect(result.total_tokens).toBe(150);
    expect(deps.taskStore.update).toHaveBeenCalledWith(task.id, expect.objectContaining({
      result_summary: "Implemented add function",
      confidence:     0.95,
    }));
  });

  it("multi-turn think: think_more → execute_result → turns_taken = 2", async () => {
    const deps  = makeDeps();
    const agent = makeAgent();
    const task  = makeTask();

    (deps.provider.chatWithTools as ReturnType<typeof vi.fn>)
      .mockResolvedValue(makeToolResponse());

    (deps.toolParser.parse as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce({
        type:      "think_more",
        thoughts:  "Let me reason through the types needed.",
        next_step: "Now implement the function.",
      })
      .mockReturnValueOnce({
        type:       "execute_result",
        result:     "function add(a: number, b: number): number { return a + b; }",
        summary:    "Implemented typed add",
        confidence: 0.92,
      });

    const loop   = new AgentReasoningLoop(deps);
    const result = await loop.executeTask(task, agent);

    expect(result.success).toBe(true);
    expect(result.turns_taken).toBe(2);
    expect(deps.provider.chatWithTools).toHaveBeenCalledTimes(2);
  });

  it("decompose: creates sub-tasks in TaskStore and returns success", async () => {
    const deps  = makeDeps();
    const agent = makeAgent({ tier: 2 });
    const task  = makeTask({ tier: 2, token_budget: 8_000 });

    (deps.provider.chatWithTools as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(makeToolResponse());

    (deps.toolParser.parse as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce({
        type:      "decompose_task",
        reasoning: "Task has two independent parts",
        sub_tasks: [
          { title: "Part A", description: "Do part A", tier: 3 },
          { title: "Part B", description: "Do part B", tier: 3 },
        ],
      });

    const loop   = new AgentReasoningLoop(deps);
    const result = await loop.executeTask(task, agent);

    expect(result.success).toBe(true);
    expect(result.decision.type).toBe("decompose_task");
    expect(deps.taskStore.create).toHaveBeenCalledTimes(2);
    expect(deps.taskStore.update).toHaveBeenCalledWith(task.id, expect.objectContaining({
      sub_tasks_expected: 2,
    }));
    expect(deps.eventBus.emit).toHaveBeenCalledWith("agent.task.decomposed", expect.objectContaining({
      sub_task_count: 2,
    }));
  });

  it("tool use: use_tool → tool result appended → execute_result", async () => {
    const deps       = makeDeps();
    const dispatcher = vi.fn().mockResolvedValue({ lines: 42 });
    deps.dispatchTool = dispatcher;
    const agent      = makeAgent();
    const task       = makeTask();

    (deps.provider.chatWithTools as ReturnType<typeof vi.fn>)
      .mockResolvedValue(makeToolResponse());

    (deps.toolParser.parse as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce({
        type:       "use_tool",
        tool_name:  "count_lines",
        tool_input: { path: "src/index.ts" },
        purpose:    "Count source lines",
      })
      .mockReturnValueOnce({
        type:       "execute_result",
        result:     "Source has 42 lines",
        summary:    "Line count completed",
        confidence: 0.99,
      });

    const loop   = new AgentReasoningLoop(deps);
    const result = await loop.executeTask(task, agent);

    expect(result.success).toBe(true);
    expect(dispatcher).toHaveBeenCalledWith("count_lines", { path: "src/index.ts" });
    expect(deps.promptBuilder.buildToolResultMessage).toHaveBeenCalledWith("count_lines", { lines: 42 });
    expect(result.turns_taken).toBe(2);
  });

  it("max turns exceeded: returns escalation with EXEC-001 reason", async () => {
    const deps  = makeDeps({
      config: {
        max_turns_per_task:       2,   // very low limit for test
        max_tool_calls_per_task:  50,
        checkpoint_every_n_turns: 5,
        turn_timeout_ms:          5_000,
        context_window_limit:     150_000,
      },
    });
    const agent = makeAgent();
    const task  = makeTask();

    (deps.provider.chatWithTools as ReturnType<typeof vi.fn>)
      .mockResolvedValue(makeToolResponse());

    // Always think_more — never terminates
    (deps.toolParser.parse as ReturnType<typeof vi.fn>)
      .mockReturnValue({
        type:      "think_more",
        thoughts:  "Still thinking...",
        next_step: "Keep thinking.",
      });

    const loop   = new AgentReasoningLoop(deps);
    const result = await loop.executeTask(task, agent);

    expect(result.success).toBe(false);
    expect(result.turns_taken).toBe(2);
    expect(result.decision.type).toBe("escalate_task");
    expect((result.decision as { type: "escalate_task"; reason: string }).reason).toContain("max reasoning turns");
    expect(deps.eventBus.emit).toHaveBeenCalledWith("agent.task.escalated", expect.objectContaining({
      task_id: task.id,
    }));
  });

});
