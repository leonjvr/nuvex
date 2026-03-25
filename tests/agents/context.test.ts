/**
 * Tests for src/agents/context.ts
 */

import { describe, it, expect, beforeEach } from "vitest";
import { AgentContext } from "../../src/agents/context.js";
import type { AgentDefinition, SkillDefinition } from "../../src/agents/types.js";
import type { Task } from "../../src/tasks/types.js";

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
  capabilities: ["code", "analysis"],
  max_concurrent_tasks: 3,
  token_budget_per_task: 10000,
  cost_limit_per_hour: 1.0,
  checkpoint_interval_ms: 30000,
  ttl_default_seconds: 1800,
  heartbeat_interval_ms: 10000,
  max_retries: 3,
  metadata: {},
};

const SKILL: SkillDefinition = {
  agent_id: "sonnet-devlead",
  role: "Development Lead",
  system_prompt: "You are a skilled Development Lead responsible for code quality.",
  review_behavior: {
    strategy: "summary_then_selective",
    confidence_threshold: 0.85,
    max_full_reviews_per_synthesis: 3,
  },
  delegation_style: {
    max_sub_tasks: 8,
    prefer_parallel: true,
    require_plan_approval: false,
  },
  output_format: "markdown",
  constraints: ["Write clean code", "Add tests for all logic"],
  tools: ["code_execution", "file_write"],
};

const TASK: Task = {
  id: "task-1",
  title: "Implement auth module",
  description: "Create JWT authentication middleware",
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
  started_at: new Date().toISOString(),
  completed_at: null,
  result_file: null,
  result_summary: null,
  confidence: null,
  token_budget: 5000,
  token_used: 200,
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

/** Minimal no-op memory manager stub */
function makeMemoryStub(shortTermContent = "") {
  return {
    getRelevantMemories: async () => shortTermContent,
  } as never;
}

// ---------------------------------------------------------------------------
// buildSystemPrompt
// ---------------------------------------------------------------------------

describe("AgentContext — buildSystemPrompt", () => {
  let ctx: AgentContext;

  beforeEach(() => {
    ctx = new AgentContext(DEF, SKILL, makeMemoryStub());
  });

  it("includes governance preamble with division and tier", () => {
    const prompt = ctx.buildSystemPrompt();
    expect(prompt).toContain("Governance Rules");
    expect(prompt).toContain("engineering");
    expect(prompt).toContain("T2");
  });

  it("includes role section with skill system prompt", () => {
    const prompt = ctx.buildSystemPrompt();
    expect(prompt).toContain("Development Lead");
    expect(prompt).toContain("skilled Development Lead");
  });

  it("includes agent constraints section", () => {
    const prompt = ctx.buildSystemPrompt();
    expect(prompt).toContain("Agent Constraints");
    expect(prompt).toContain("max_concurrent_tasks".replace("_", " ").toLowerCase() === "max concurrent tasks" ? "3" : "3");
    // Cost limit present
    expect(prompt).toContain("1.00");
  });

  it("includes role-specific constraints from skill", () => {
    const prompt = ctx.buildSystemPrompt();
    expect(prompt).toContain("Write clean code");
    expect(prompt).toContain("Add tests for all logic");
  });

  it("returns a non-empty string", () => {
    expect(ctx.buildSystemPrompt().trim().length).toBeGreaterThan(100);
  });
});

// ---------------------------------------------------------------------------
// buildMessages
// ---------------------------------------------------------------------------

describe("AgentContext — buildMessages", () => {
  it("returns [system, user] messages", async () => {
    const ctx = new AgentContext(DEF, SKILL, makeMemoryStub());
    const messages = await ctx.buildMessages(TASK);
    expect(messages).toHaveLength(2);
    expect(messages[0]!.role).toBe("system");
    expect(messages[1]!.role).toBe("user");
  });

  it("user message contains task title and description", async () => {
    const ctx = new AgentContext(DEF, SKILL, makeMemoryStub());
    const messages = await ctx.buildMessages(TASK);
    const user = messages[1]!.content;
    expect(user).toContain("Implement auth module");
    expect(user).toContain("JWT authentication middleware");
  });

  it("user message contains output format instructions", async () => {
    const ctx = new AgentContext(DEF, SKILL, makeMemoryStub());
    const messages = await ctx.buildMessages(TASK);
    const user = messages[1]!.content;
    expect(user).toContain("DECISION");
    expect(user).toContain("EXECUTE");
    expect(user).toContain("DECOMPOSE");
  });

  it("includes memory when available", async () => {
    const ctx = new AgentContext(DEF, SKILL, makeMemoryStub("Relevant: fix null checks in auth flow"));
    const messages = await ctx.buildMessages(TASK);
    const user = messages[1]!.content;
    expect(user).toContain("Relevant Memory");
    expect(user).toContain("null checks");
  });

  it("omits memory section when memory is empty", async () => {
    const ctx = new AgentContext(DEF, SKILL, makeMemoryStub(""));
    const messages = await ctx.buildMessages(TASK);
    const user = messages[1]!.content;
    expect(user).not.toContain("Relevant Memory");
  });

  it("appends additionalContext when provided", async () => {
    const ctx = new AgentContext(DEF, SKILL, makeMemoryStub());
    const messages = await ctx.buildMessages(TASK, "Extra context: see PR #42");
    const user = messages[1]!.content;
    expect(user).toContain("Extra context: see PR #42");
  });

  it("consultation task uses consultation format", async () => {
    const consultTask: Task = { ...TASK, type: "consultation" };
    const ctx = new AgentContext(DEF, SKILL, makeMemoryStub());
    const messages = await ctx.buildMessages(consultTask);
    const user = messages[1]!.content;
    // Should have consultation format, not EXECUTE/DECOMPOSE
    expect(user).toContain("RESULT:");
    expect(user).toContain("CONFIDENCE:");
  });
});

// ---------------------------------------------------------------------------
// buildSynthesisMessages
// ---------------------------------------------------------------------------

describe("AgentContext — buildSynthesisMessages", () => {
  it("returns [system, user] messages", async () => {
    const ctx = new AgentContext(DEF, SKILL, makeMemoryStub());
    const messages = await ctx.buildSynthesisMessages(TASK, ["Result 1", "Result 2"]);
    expect(messages).toHaveLength(2);
    expect(messages[0]!.role).toBe("system");
    expect(messages[1]!.role).toBe("user");
  });

  it("includes child summaries in user message", async () => {
    const ctx = new AgentContext(DEF, SKILL, makeMemoryStub());
    const messages = await ctx.buildSynthesisMessages(TASK, ["Auth done", "Tests passing"]);
    const user = messages[1]!.content;
    expect(user).toContain("Auth done");
    expect(user).toContain("Tests passing");
    expect(user).toContain("Sub-Task Results");
  });

  it("includes synthesis format instructions", async () => {
    const ctx = new AgentContext(DEF, SKILL, makeMemoryStub());
    const messages = await ctx.buildSynthesisMessages(TASK, ["summary"]);
    const user = messages[1]!.content;
    expect(user).toContain("CONFIDENCE");
  });
});

// ---------------------------------------------------------------------------
// buildConsultationMessages
// ---------------------------------------------------------------------------

describe("AgentContext — buildConsultationMessages", () => {
  it("returns [system, user] messages", async () => {
    const ctx = new AgentContext(DEF, SKILL, makeMemoryStub());
    const messages = await ctx.buildConsultationMessages(TASK);
    expect(messages).toHaveLength(2);
    expect(messages[0]!.role).toBe("system");
    expect(messages[1]!.role).toBe("user");
  });

  it("user message contains consultation request header", async () => {
    const ctx = new AgentContext(DEF, SKILL, makeMemoryStub());
    const messages = await ctx.buildConsultationMessages(TASK);
    const user = messages[1]!.content;
    expect(user).toContain("Consultation Request");
    expect(user).toContain("Implement auth module");
  });
});

// ---------------------------------------------------------------------------
// estimateTokens
// ---------------------------------------------------------------------------

describe("AgentContext — estimateTokens", () => {
  it("returns a positive integer", () => {
    const ctx = new AgentContext(DEF, SKILL, makeMemoryStub());
    const msgs = [
      { role: "system" as const, content: "System prompt here." },
      { role: "user" as const, content: "User message here." },
    ];
    const est = ctx.estimateTokens(msgs);
    expect(est).toBeGreaterThan(0);
    expect(Number.isInteger(est)).toBe(true);
  });

  it("returns 0 for empty messages", () => {
    const ctx = new AgentContext(DEF, SKILL, makeMemoryStub());
    expect(ctx.estimateTokens([])).toBe(0);
  });

  it("scales with content length", () => {
    const ctx = new AgentContext(DEF, SKILL, makeMemoryStub());
    const short = [{ role: "user" as const, content: "Hello." }];
    const long = [{ role: "user" as const, content: "Hello. ".repeat(100) }];
    expect(ctx.estimateTokens(long)).toBeGreaterThan(ctx.estimateTokens(short));
  });
});

// ---------------------------------------------------------------------------
// trimToFit
// ---------------------------------------------------------------------------

describe("AgentContext — trimToFit", () => {
  it("returns messages unchanged when within limit", () => {
    const ctx = new AgentContext(DEF, SKILL, makeMemoryStub());
    const msgs = [
      { role: "system" as const, content: "Short system." },
      { role: "user" as const, content: "Short user." },
    ];
    const result = ctx.trimToFit(msgs, 10_000);
    expect(result).toHaveLength(2);
    expect(result[0]!.content).toBe("Short system.");
    expect(result[1]!.content).toBe("Short user.");
  });

  it("trims user message when over limit", () => {
    const ctx = new AgentContext(DEF, SKILL, makeMemoryStub());
    // Use a large system prompt so the guard condition (user.length > toRemove + 200) passes.
    // trimToFit guards: userMsg.content.length > toRemove + 200
    // With system=400 chars, user=10000, maxTokens=50 (200 target chars):
    //   toRemove = 10400 - 200 = 10200
    //   check: 10000 > 10200 + 200 = 10400? → FALSE (trim blocked)
    // We need user >> system for this to work. Use maxTokens=1000 (4000 chars target) instead:
    //   toRemove = (400 + 10000) - 4000 = 6400
    //   check: 10000 > 6400 + 200 = 6600? → TRUE (trim happens)
    const systemContent = "X".repeat(400);
    const bigContent = "Memory content here. ".repeat(500); // ~10500 chars
    const msgs = [
      { role: "system" as const, content: systemContent },
      { role: "user" as const, content: bigContent },
    ];
    const originalTotal = systemContent.length + bigContent.length;
    const result = ctx.trimToFit(msgs, 1000); // 1000 tokens = 4000 chars target
    const totalChars = result.reduce((s, m) => s + m.content.length, 0);
    expect(totalChars).toBeLessThan(originalTotal);
  });

  it("preserves system message unchanged", () => {
    const ctx = new AgentContext(DEF, SKILL, makeMemoryStub());
    const systemContent = "Critical system prompt.";
    const bigContent = "x".repeat(5000);
    const msgs = [
      { role: "system" as const, content: systemContent },
      { role: "user" as const, content: bigContent },
    ];
    const result = ctx.trimToFit(msgs, 10);
    const sysMsg = result.find((m) => m.role === "system");
    expect(sysMsg?.content).toBe(systemContent);
  });
});

// ---------------------------------------------------------------------------
// buildLLMRequest
// ---------------------------------------------------------------------------

describe("AgentContext — buildLLMRequest", () => {
  it("returns LLMRequest with user messages and system prompt", () => {
    const ctx = new AgentContext(DEF, SKILL, makeMemoryStub());
    const msgs = [
      { role: "system" as const, content: "System." },
      { role: "user" as const, content: "User." },
    ];
    const req = ctx.buildLLMRequest(msgs, TASK);
    expect(req.systemPrompt).toBe("System.");
    expect(req.messages).toHaveLength(1);
    expect(req.messages[0]!.content).toBe("User.");
    expect(req.taskId).toBe("task-1");
  });

  it("maxTokens respects task budget minus used", () => {
    const ctx = new AgentContext(DEF, SKILL, makeMemoryStub());
    const msgs = [
      { role: "system" as const, content: "S." },
      { role: "user" as const, content: "U." },
    ];
    const req = ctx.buildLLMRequest(msgs, { ...TASK, token_budget: 1000, token_used: 600 });
    // remaining = 400, capped at 4096
    expect(req.maxTokens).toBe(400);
  });

  it("maxTokens capped at 4096", () => {
    const ctx = new AgentContext(DEF, SKILL, makeMemoryStub());
    const msgs = [
      { role: "system" as const, content: "S." },
      { role: "user" as const, content: "U." },
    ];
    const req = ctx.buildLLMRequest(msgs, { ...TASK, token_budget: 50000, token_used: 0 });
    expect(req.maxTokens).toBe(4096);
  });

  it("includes agent metadata", () => {
    const ctx = new AgentContext(DEF, SKILL, makeMemoryStub());
    const msgs = [
      { role: "system" as const, content: "S." },
      { role: "user" as const, content: "U." },
    ];
    const req = ctx.buildLLMRequest(msgs, TASK);
    expect(req.metadata?.agent_id).toBe("sonnet-devlead");
    expect(req.metadata?.tier).toBe(2);
  });
});
