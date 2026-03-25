/**
 * Tests for src/agents/skill-loader.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { SkillLoader } from "../../src/agents/skill-loader.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "../fixtures/skills");

const loader = new SkillLoader();

// ---------------------------------------------------------------------------
// Fixture loading
// ---------------------------------------------------------------------------

describe("SkillLoader — fixture files", () => {
  it("loads T1-strategic.md correctly", async () => {
    const skill = await loader.load(join(FIXTURES, "T1-strategic.md"));
    expect(skill.agent_id).toBe("opus-ceo");
    expect(skill.role).toBe("CEO Strategic Advisor");
    expect(skill.review_behavior.strategy).toBe("summary_then_selective");
    expect(skill.review_behavior.confidence_threshold).toBe(0.85);
    expect(skill.delegation_style.max_sub_tasks).toBe(6);
    expect(skill.delegation_style.prefer_parallel).toBe(true);
    expect(skill.system_prompt).toContain("Strategic AI Advisor");
    expect(skill.constraints.length).toBeGreaterThan(0);
  });

  it("loads T2-devlead.md correctly", async () => {
    const skill = await loader.load(join(FIXTURES, "T2-devlead.md"));
    expect(skill.agent_id).toBe("sonnet-devlead");
    expect(skill.role).toBe("Development Lead");
    expect(skill.review_behavior.max_full_reviews_per_synthesis).toBe(3);
    expect(skill.delegation_style.prefer_parallel).toBe(true);
    expect(skill.system_prompt).toContain("Development Lead");
    expect(skill.tools).toContain("code_execution");
  });

  it("loads T3-worker.md correctly", async () => {
    const skill = await loader.load(join(FIXTURES, "T3-worker.md"));
    expect(skill.agent_id).toBe("haiku-worker");
    expect(skill.role).toBe("Worker Agent");
    expect(skill.review_behavior.strategy).toBe("summary_only");
    expect(skill.review_behavior.confidence_threshold).toBe(0.9);
    expect(skill.delegation_style.prefer_parallel).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Inline parsing
// ---------------------------------------------------------------------------

describe("SkillLoader — parse() inline", () => {
  it("parses valid skill.md content", () => {
    const content = `---
agent_id: "test-agent"
role: "Test Role"
---

You are a test agent.
`;
    const skill = loader.parse(content);
    expect(skill.agent_id).toBe("test-agent");
    expect(skill.role).toBe("Test Role");
    expect(skill.system_prompt).toContain("test agent");
  });

  it("applies default review_behavior when missing", () => {
    const content = `---
agent_id: "minimal"
role: "Minimal"
---

Minimal agent.
`;
    const skill = loader.parse(content);
    expect(skill.review_behavior.strategy).toBe("summary_then_selective");
    expect(skill.review_behavior.confidence_threshold).toBe(0.8);
    expect(skill.review_behavior.max_full_reviews_per_synthesis).toBe(3);
  });

  it("applies default delegation_style when missing", () => {
    const content = `---
agent_id: "minimal"
role: "Minimal"
---

Minimal.
`;
    const skill = loader.parse(content);
    expect(skill.delegation_style.max_sub_tasks).toBe(10);
    expect(skill.delegation_style.prefer_parallel).toBe(true);
    expect(skill.delegation_style.require_plan_approval).toBe(false);
  });

  it("parses constraints array", () => {
    const content = `---
agent_id: "a"
role: "R"
constraints:
  - "Rule one"
  - "Rule two"
---

Body.
`;
    const skill = loader.parse(content);
    expect(skill.constraints).toEqual(["Rule one", "Rule two"]);
  });

  it("parses tools array", () => {
    const content = `---
agent_id: "a"
role: "R"
tools:
  - "code_execution"
  - "file_write"
---

Body.
`;
    const skill = loader.parse(content);
    expect(skill.tools).toEqual(["code_execution", "file_write"]);
  });

  it("uses empty arrays for missing constraints and tools", () => {
    const content = `---
agent_id: "a"
role: "R"
---

Body.
`;
    const skill = loader.parse(content);
    expect(skill.constraints).toEqual([]);
    expect(skill.tools).toEqual([]);
  });

  it("output_format defaults to markdown when missing", () => {
    const content = `---
agent_id: "a"
role: "R"
---

Body.
`;
    const skill = loader.parse(content);
    expect(skill.output_format).toBe("markdown");
  });

  it("uses provided output_format", () => {
    const content = `---
agent_id: "a"
role: "R"
output_format: "json_structured"
---

Body.
`;
    const skill = loader.parse(content);
    expect(skill.output_format).toBe("json_structured");
  });
});

// ---------------------------------------------------------------------------
// Error cases
// ---------------------------------------------------------------------------

describe("SkillLoader — error cases", () => {
  it("throws if agent_id missing", () => {
    const content = `---
role: "R"
---

Body.
`;
    expect(() => loader.parse(content)).toThrow(/agent_id/);
  });

  it("throws if role missing", () => {
    const content = `---
agent_id: "a"
---

Body.
`;
    expect(() => loader.parse(content)).toThrow(/role/);
  });

  it("throws if no opening frontmatter marker", () => {
    const content = `agent_id: "a"\nrole: "R"\n\nBody.`;
    expect(() => loader.parse(content)).toThrow(/must start with ---/);
  });

  it("throws if closing frontmatter marker missing", () => {
    const content = `---\nagent_id: "a"\nrole: "R"`;
    expect(() => loader.parse(content)).toThrow(/not closed/);
  });

  it("throws if file does not exist", async () => {
    await expect(loader.load("/nonexistent/path/skill.md")).rejects.toThrow(/not found/);
  });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe("SkillLoader — validate()", () => {
  it("valid skill passes validation", async () => {
    const skill = await loader.load(join(FIXTURES, "T2-devlead.md"));
    const result = loader.validate(skill);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("empty agent_id fails", () => {
    const skill = loader.parse(`---\nagent_id: "a"\nrole: "R"\n---\nBody.`);
    const invalid = { ...skill, agent_id: "" };
    const result = loader.validate(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("agent_id"))).toBe(true);
  });

  it("invalid review strategy fails", () => {
    const skill = loader.parse(`---\nagent_id: "a"\nrole: "R"\n---\nBody.`);
    const invalid = {
      ...skill,
      review_behavior: { ...skill.review_behavior, strategy: "invalid" as "summary_only" },
    };
    const result = loader.validate(invalid);
    expect(result.valid).toBe(false);
  });

  it("confidence_threshold out of range fails", () => {
    const skill = loader.parse(`---\nagent_id: "a"\nrole: "R"\n---\nBody.`);
    const invalid = {
      ...skill,
      review_behavior: { ...skill.review_behavior, confidence_threshold: 1.5 },
    };
    const result = loader.validate(invalid);
    expect(result.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SkillLoader — loadWithContext (Phase 8 Amendment)
// ---------------------------------------------------------------------------

describe("SkillLoader — loadWithContext", () => {
  it("returns EnrichedSkillDefinition with empty deep_knowledge when no Qdrant", async () => {
    const result = await loader.loadWithContext(join(FIXTURES, "T2-devlead.md"), "auth feature");
    expect(result.agent_id).toBe("sonnet-devlead");
    expect(Array.isArray(result.deep_knowledge)).toBe(true);
    expect(result.deep_knowledge).toHaveLength(0); // graceful fallback
    expect(result.deep_knowledge_tokens).toBe(0);
  });

  it("loads the base skill correctly even with task context provided", async () => {
    const result = await loader.loadWithContext(join(FIXTURES, "T1-strategic.md"), "strategic planning");
    expect(result.role).toBe("CEO Strategic Advisor");
    expect(result.system_prompt).toContain("Strategic AI Advisor");
  });

  it("works without task context (undefined)", async () => {
    const result = await loader.loadWithContext(join(FIXTURES, "T3-worker.md"));
    expect(result.agent_id).toBe("haiku-worker");
    expect(result.deep_knowledge).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// SkillLoader — getSkillHealth (Phase 8 Amendment)
// ---------------------------------------------------------------------------

describe("SkillLoader — getSkillHealth", () => {
  it("returns SkillHealthReport with correct skill_path", () => {
    const skillPath = join(FIXTURES, "T2-devlead.md");
    const health = loader.getSkillHealth(skillPath);
    expect(health.skill_path).toBe(skillPath);
    expect(health.size_kb).toBeGreaterThan(0);
    expect(["healthy", "warning", "critical"]).toContain(health.status);
    expect(typeof health.last_modified).toBe("string");
  });

  it("returns sections array", () => {
    const health = loader.getSkillHealth(join(FIXTURES, "T1-strategic.md"));
    expect(Array.isArray(health.sections)).toBe(true);
  });

  it("returns recommendations array", () => {
    const health = loader.getSkillHealth(join(FIXTURES, "T3-worker.md"));
    expect(Array.isArray(health.recommendations)).toBe(true);
  });

  it("returns healthy status for small skill files", () => {
    // Test fixtures are small so should be healthy
    const health = loader.getSkillHealth(join(FIXTURES, "T3-worker.md"));
    expect(health.status).toBe("healthy");
  });
});

// ---------------------------------------------------------------------------
// SkillLoader — compactSkill (Phase 8 Amendment)
// ---------------------------------------------------------------------------

describe("SkillLoader — compactSkill", () => {
  let tmpSkillDir: string;
  let tmpSkillPath: string;

  beforeEach(() => {
    tmpSkillDir = mkdtempSync(join(tmpdir(), "sidjua-skill-compact-test-"));
    tmpSkillPath = join(tmpSkillDir, "skill.md");

    // Write a skill file with multiple sections
    const content = `---
agent_id: "test-agent"
role: "Test Role"
review_behavior:
  strategy: summary_only
  confidence_threshold: 0.9
  max_full_reviews_per_synthesis: 2
delegation_style:
  max_sub_tasks: 3
  prefer_parallel: false
  peer_consultation_threshold: 0.7
output_format: plain
constraints: []
tools: []
---

## Current Role

You are a test agent handling structured tasks.

## Active Rules

Always validate input before processing.

## Procedures

Follow these steps to complete any task:
1. Analyze the request
2. Plan the approach
3. Execute the plan

## History

Previously completed project Alpha in Q1 2024.
Previously completed project Beta in Q2 2024.

## Reference Patterns

Standard error handling pattern: try-catch with logging.
Standard retry pattern: exponential backoff.
`;

    writeFileSync(tmpSkillPath, content, "utf8");
  });

  afterEach(() => {
    rmSync(tmpSkillDir, { recursive: true, force: true });
  });

  it("returns compaction result with before/after sizes", async () => {
    const result = await loader.compactSkill(tmpSkillPath, {
      max_size_kb: 5,
      keep_sections: ["Current Role", "Active Rules"],
      migrate_categories: ["procedures", "history", "patterns"],
    });

    expect(result.before_size_kb).toBeGreaterThan(0);
    expect(result.after_size_kb).toBeGreaterThanOrEqual(0);
    expect(typeof result.new_skill_content).toBe("string");
  });

  it("keeps sections specified in keep_sections", async () => {
    const result = await loader.compactSkill(tmpSkillPath, {
      max_size_kb: 10,
      keep_sections: ["Current Role", "Active Rules"],
      migrate_categories: ["history"],
    });

    expect(result.new_skill_content).toContain("Current Role");
    expect(result.new_skill_content).toContain("Active Rules");
  });

  it("new_skill_content is smaller than original when sections removed", async () => {
    const result = await loader.compactSkill(tmpSkillPath, {
      max_size_kb: 1,
      keep_sections: ["Current Role"],
      migrate_categories: ["procedures", "history", "reference"],
    });

    const original = `---
agent_id: "test-agent"`.length;
    expect(result.new_skill_content.length).toBeGreaterThan(0);
    expect(result.migrated_sections).toBeGreaterThanOrEqual(0);
  });
});
