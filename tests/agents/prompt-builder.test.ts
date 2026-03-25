/**
 * Phase 13b: PromptBuilder unit tests
 */

import { describe, it, expect, beforeAll } from "vitest";
import { PromptBuilder } from "../../src/agents/prompt-builder.js";
import type { AgentDefinition } from "../../src/agents/types.js";
import type { Task }            from "../../src/tasks/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id:                    "test-agent-01",
    name:                  "Test Agent",
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
    title:                "Write a hello world function",
    description:          "Write a Python function that prints Hello, World!",
    assigned_agent:       "test-agent-01",
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PromptBuilder.buildSystemPrompt", () => {
  it("includes skill content and injects the tools list", async () => {
    const builder = new PromptBuilder();
    const agent   = makeAgent();

    // Pre-load the real t3-worker skill file
    await builder.preloadSkill(agent.skill_file);

    const prompt = builder.buildSystemPrompt(agent, [
      { name: "execute_result",  description: "Signal task completion" },
      { name: "escalate_task",   description: "Escalate to higher tier" },
    ]);

    expect(prompt).toContain("Task Executor");         // from skill role
    expect(prompt).toContain("execute_result");         // tool name injected
    expect(prompt).toContain("Signal task completion"); // tool description
    expect(prompt).toContain("NEVER call decompose_task"); // constraint from skill
    expect(prompt).toContain("eng");                   // governance division
  });

  it("falls back to generic role when skill file is missing", () => {
    const builder = new PromptBuilder();
    const agent   = makeAgent({ skill_file: "/nonexistent/path.md" });

    const prompt = builder.buildSystemPrompt(agent, [
      { name: "execute_result", description: "Signal task completion" },
    ]);

    expect(prompt).toContain("Tier 3");
    expect(prompt).toContain("eng");
    expect(prompt).toContain("execute_result");
  });
});

describe("PromptBuilder.buildTaskPrompt", () => {
  it("includes task description and memory context", () => {
    const builder = new PromptBuilder();
    const task    = makeTask();

    const prompt = builder.buildTaskPrompt(task, "Previous task: implemented login");

    expect(prompt).toContain("Write a hello world function");
    expect(prompt).toContain("prints Hello, World!");
    expect(prompt).toContain("Previous task: implemented login");
    expect(prompt).toContain("T3");
    expect(prompt).toContain("eng");
  });

  it("omits memory section when no memory context provided", () => {
    const builder = new PromptBuilder();
    const task    = makeTask();

    const prompt = builder.buildTaskPrompt(task);

    expect(prompt).toContain("Write a hello world function");
    expect(prompt).not.toContain("Relevant Memory");
  });
});

describe("PromptBuilder.summarizeConversation", () => {
  it("keeps system message + last N messages when over limit", () => {
    const builder   = new PromptBuilder();
    const messages  = [
      { role: "system" as const,    content: "You are an agent." },
      { role: "user" as const,      content: "Turn 1 user" },
      { role: "assistant" as const, content: "Turn 1 assistant" },
      { role: "user" as const,      content: "Turn 2 user" },
      { role: "assistant" as const, content: "Turn 2 assistant" },
      { role: "user" as const,      content: "Turn 3 user" },
    ];

    const summarised = builder.summarizeConversation(messages, 2);

    // System message preserved
    expect(summarised[0]?.content).toBe("You are an agent.");
    // Truncation notice injected
    expect(summarised[1]?.content).toContain("truncated");
    // Most recent 2 messages kept
    expect(summarised[summarised.length - 1]?.content).toBe("Turn 3 user");
    expect(summarised.length).toBe(4); // system + summary + 2 recent
  });

  it("returns messages unchanged when within limit", () => {
    const builder  = new PromptBuilder();
    const messages = [
      { role: "system" as const, content: "System" },
      { role: "user"   as const, content: "User" },
    ];

    const result = builder.summarizeConversation(messages, 10);
    expect(result).toHaveLength(2);
    expect(result).toBe(messages); // same reference — no copy
  });
});
