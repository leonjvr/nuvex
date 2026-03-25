/**
 * Tests for src/agents/action-executor.ts
 */

import { describe, it, expect, vi } from "vitest";
import { ActionExecutor } from "../../src/agents/action-executor.js";
import type { PipelineEvaluator } from "../../src/agents/action-executor.js";
import type { AgentDefinition, LLMRequest } from "../../src/agents/types.js";
import type { Task } from "../../src/tasks/types.js";
import type { ProviderRegistry } from "../../src/provider/registry.js";
import type { TaskStore } from "../../src/tasks/store.js";
import type { PipelineResult } from "../../src/types/pipeline.js";
import type { ProviderCallResponse } from "../../src/types/provider.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DEF: AgentDefinition = {
  id: "sonnet-devlead",
  name: "Dev Lead",
  tier: 2,
  provider: "anthropic",
  model: "claude-sonnet-4-6",
  skill_file: "",
  division: "engineering",
  capabilities: ["code"],
  max_concurrent_tasks: 3,
  token_budget_per_task: 10000,
  cost_limit_per_hour: 1.0,
  checkpoint_interval_ms: 30000,
  ttl_default_seconds: 1800,
  heartbeat_interval_ms: 10000,
  max_retries: 3,
  metadata: {},
};

const TASK: Task = {
  id: "task-1",
  title: "Implement feature",
  description: "Implement the feature",
  division: "engineering",
  type: "delegation",
  tier: 2,
  parent_id: null,
  root_id: "task-1",
  assigned_agent: "sonnet-devlead",
  status: "RUNNING",
  priority: 3,
  classification: "internal",
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  started_at: null,
  completed_at: null,
  result_file: null,
  result_summary: null,
  confidence: null,
  token_budget: 5000,
  token_used: 100,
  cost_budget: 0.5,
  cost_used: 0.01,
  ttl_seconds: 1800,
  retry_count: 0,
  max_retries: 3,
  checkpoint: null,
  sub_tasks_expected: 0,
  sub_tasks_received: 0,
  embedding_id: null,
  metadata: {},
};

const LLM_REQUEST: LLMRequest = {
  messages: [{ role: "user", content: "Do the task." }],
  systemPrompt: "You are a helpful agent.",
  maxTokens: 1000,
};

const MOCK_RESPONSE: ProviderCallResponse = {
  content: "Task completed successfully.",
  usage: { promptTokens: 100, completionTokens: 200, totalTokens: 300 },
  costUsd: 0.001,
  model: "claude-sonnet-4-6",
  provider: "anthropic",
  finishReason: "end_turn",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAllowPipeline(): PipelineEvaluator {
  return () => ({
    verdict: "ALLOW",
    stages: [],
    duration_ms: 1,
    metadata: {},
  } satisfies PipelineResult);
}

function makeBlockPipeline(reason = "Action is forbidden"): PipelineEvaluator {
  return () => ({
    verdict: "BLOCK",
    blocking_reason: reason,
    stages: [],
    duration_ms: 1,
    metadata: {},
  } satisfies PipelineResult);
}

function makePausePipeline(approvalId = 99): PipelineEvaluator {
  return () => ({
    verdict: "PAUSE",
    blocking_reason: "Requires manager approval",
    approval_id: approvalId,
    stages: [],
    duration_ms: 1,
    metadata: {},
  } satisfies PipelineResult);
}

function makeRegistry(response: ProviderCallResponse = MOCK_RESPONSE): ProviderRegistry {
  return {
    call: vi.fn().mockResolvedValue(response),
  } as unknown as ProviderRegistry;
}

function makeTaskStore(): TaskStore {
  return {
    update: vi.fn(),
  } as unknown as TaskStore;
}

// ---------------------------------------------------------------------------
// executeLLMCall — ALLOW
// ---------------------------------------------------------------------------

describe("ActionExecutor — executeLLMCall ALLOW", () => {
  it("returns success=true with response when pipeline ALLOWs", async () => {
    const registry = makeRegistry();
    const store = makeTaskStore();
    const exec = new ActionExecutor(makeAllowPipeline(), registry, DEF, store);

    const result = await exec.executeLLMCall(LLM_REQUEST, TASK);
    expect(result.success).toBe(true);
    expect(result.response).toBeDefined();
    expect(result.response!.content).toBe("Task completed successfully.");
  });

  it("calls registry.call with correct parameters", async () => {
    const registry = makeRegistry();
    const store = makeTaskStore();
    const exec = new ActionExecutor(makeAllowPipeline(), registry, DEF, store);

    await exec.executeLLMCall(LLM_REQUEST, TASK);

    expect(registry.call).toHaveBeenCalledOnce();
    const callArg = (registry.call as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArg.agentId).toBe("sonnet-devlead");
    expect(callArg.provider).toBe("anthropic");
    expect(callArg.model).toBe("claude-sonnet-4-6");
  });

  it("updates task token_used after LLM call", async () => {
    const registry = makeRegistry();
    const store = makeTaskStore();
    const exec = new ActionExecutor(makeAllowPipeline(), registry, DEF, store);

    await exec.executeLLMCall(LLM_REQUEST, TASK);

    expect(store.update).toHaveBeenCalledWith("task-1", expect.objectContaining({
      token_used: TASK.token_used + MOCK_RESPONSE.usage.totalTokens,
    }));
  });

  it("updates task cost_used after LLM call", async () => {
    const registry = makeRegistry();
    const store = makeTaskStore();
    const exec = new ActionExecutor(makeAllowPipeline(), registry, DEF, store);

    await exec.executeLLMCall(LLM_REQUEST, TASK);

    expect(store.update).toHaveBeenCalledWith("task-1", expect.objectContaining({
      cost_used: expect.any(Number),
    }));
    const callArg = (store.update as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(callArg.cost_used).toBeCloseTo(TASK.cost_used + MOCK_RESPONSE.costUsd);
  });
});

// ---------------------------------------------------------------------------
// executeLLMCall — BLOCK
// ---------------------------------------------------------------------------

describe("ActionExecutor — executeLLMCall BLOCK", () => {
  it("returns success=false and blocked=true", async () => {
    const registry = makeRegistry();
    const store = makeTaskStore();
    const exec = new ActionExecutor(makeBlockPipeline("Forbidden action"), registry, DEF, store);

    const result = await exec.executeLLMCall(LLM_REQUEST, TASK);
    expect(result.success).toBe(false);
    expect(result.blocked).toBe(true);
  });

  it("returns block_reason from pipeline", async () => {
    const registry = makeRegistry();
    const store = makeTaskStore();
    const exec = new ActionExecutor(makeBlockPipeline("Sensitive data access denied"), registry, DEF, store);

    const result = await exec.executeLLMCall(LLM_REQUEST, TASK);
    expect(result.block_reason).toContain("Sensitive data access denied");
  });

  it("does NOT call registry when blocked", async () => {
    const registry = makeRegistry();
    const store = makeTaskStore();
    const exec = new ActionExecutor(makeBlockPipeline(), registry, DEF, store);

    await exec.executeLLMCall(LLM_REQUEST, TASK);
    expect(registry.call).not.toHaveBeenCalled();
  });

  it("does NOT update task when blocked", async () => {
    const registry = makeRegistry();
    const store = makeTaskStore();
    const exec = new ActionExecutor(makeBlockPipeline(), registry, DEF, store);

    await exec.executeLLMCall(LLM_REQUEST, TASK);
    expect(store.update).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// executeLLMCall — PAUSE
// ---------------------------------------------------------------------------

describe("ActionExecutor — executeLLMCall PAUSE", () => {
  it("returns success=false and paused=true", async () => {
    const registry = makeRegistry();
    const store = makeTaskStore();
    const exec = new ActionExecutor(makePausePipeline(), registry, DEF, store);

    const result = await exec.executeLLMCall(LLM_REQUEST, TASK);
    expect(result.success).toBe(false);
    expect(result.paused).toBe(true);
  });

  it("returns approval_id from pipeline", async () => {
    const registry = makeRegistry();
    const store = makeTaskStore();
    const exec = new ActionExecutor(makePausePipeline(42), registry, DEF, store);

    const result = await exec.executeLLMCall(LLM_REQUEST, TASK);
    expect(result.approval_id).toBe(42);
  });

  it("does NOT call registry when paused", async () => {
    const registry = makeRegistry();
    const store = makeTaskStore();
    const exec = new ActionExecutor(makePausePipeline(), registry, DEF, store);

    await exec.executeLLMCall(LLM_REQUEST, TASK);
    expect(registry.call).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// executeLLMCall — provider error
// ---------------------------------------------------------------------------

describe("ActionExecutor — executeLLMCall provider error", () => {
  it("returns success=false when registry.call throws", async () => {
    const registry = {
      call: vi.fn().mockRejectedValue(new Error("Network timeout")),
    } as unknown as ProviderRegistry;
    const store = makeTaskStore();
    const exec = new ActionExecutor(makeAllowPipeline(), registry, DEF, store);

    const result = await exec.executeLLMCall(LLM_REQUEST, TASK);
    expect(result.success).toBe(false);
    expect(result.block_reason).toContain("Provider error");
    expect(result.block_reason).toContain("Network timeout");
  });
});

// ---------------------------------------------------------------------------
// executeAction
// ---------------------------------------------------------------------------

describe("ActionExecutor — executeAction", () => {
  it("returns success=true when pipeline ALLOWs", async () => {
    const registry = makeRegistry();
    const store = makeTaskStore();
    const exec = new ActionExecutor(makeAllowPipeline(), registry, DEF, store);

    const result = await exec.executeAction("task.create", "task-db", "Create sub-task", TASK);
    expect(result.success).toBe(true);
  });

  it("returns success=false and blocked=true when pipeline BLOCKs", async () => {
    const registry = makeRegistry();
    const store = makeTaskStore();
    const exec = new ActionExecutor(makeBlockPipeline("Unauthorized"), registry, DEF, store);

    const result = await exec.executeAction("task.create", "task-db", "Create sub-task", TASK);
    expect(result.success).toBe(false);
    expect(result.blocked).toBe(true);
  });

  it("includes block_reason when blocked", async () => {
    const registry = makeRegistry();
    const store = makeTaskStore();
    const exec = new ActionExecutor(makeBlockPipeline("Tier too low"), registry, DEF, store);

    const result = await exec.executeAction("task.create", "task-db", "Create sub-task", TASK);
    expect(result.block_reason).toContain("Tier too low");
  });

  it("returns success=false when pipeline PAUSEs", async () => {
    const registry = makeRegistry();
    const store = makeTaskStore();
    const exec = new ActionExecutor(makePausePipeline(), registry, DEF, store);

    const result = await exec.executeAction("task.create", "task-db", "Create sub-task", TASK);
    expect(result.success).toBe(false);
    expect(result.blocked).toBe(true);
  });

  it("does not call registry (no LLM call)", async () => {
    const registry = makeRegistry();
    const store = makeTaskStore();
    const exec = new ActionExecutor(makeAllowPipeline(), registry, DEF, store);

    await exec.executeAction("task.create", "task-db", "Create sub-task", TASK);
    expect(registry.call).not.toHaveBeenCalled();
  });
});
