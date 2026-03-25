/**
 * Phase 10.5 — SkillLoaderV2 unit tests
 */

import { describe, it, expect, beforeEach } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SkillLoaderV2 } from "../../src/agent-lifecycle/skill-loader-v2.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const V2_MARKDOWN_SKILL = `# Test Agent — Skill Definition

## Identity
You are {agent_name} working for {organization}.
Your supervisor is {reports_to}.

## Work Style
- Be thorough

## Decision Authority
- You MAY: do tasks
- You MAY NOT: delete data
- ESCALATE: security issues

## Quality Standards
- Accuracy first

## Supervision Expectations
Write result file and management summary.

## Error Handling
Retry once then escalate.

## Communication Style
Be concise.
`;

const V1_FRONTMATTER_SKILL = `---
agent_id: legacy-agent
role: Legacy Worker
---
# Legacy Skill

You work for {organization} and your name is {agent_name}.
Supervisor: {reports_to}.
`;

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function makeSkillFiles(): { v2Path: string; v1Path: string } {
  const dir = join(tmpdir(), `sl-v2-test-${Date.now()}`);
  mkdirSync(dir, { recursive: true });

  const v2Path = join(dir, "v2-skill.md");
  const v1Path = join(dir, "v1-skill.md");

  writeFileSync(v2Path, V2_MARKDOWN_SKILL, "utf-8");
  writeFileSync(v1Path, V1_FRONTMATTER_SKILL, "utf-8");

  return { v2Path, v1Path };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SkillLoaderV2", () => {
  let loader: SkillLoaderV2;
  let v2Path: string;
  let v1Path: string;

  beforeEach(() => {
    loader = new SkillLoaderV2({ organization: "Acme Corp" });
    const paths = makeSkillFiles();
    v2Path = paths.v2Path;
    v1Path = paths.v1Path;
  });

  it("detects v2 format (pure Markdown)", async () => {
    const result = await loader.load(v2Path, {
      agentId: "test-agent",
      agentName: "Test Worker",
      reportsTo: "Sonnet Lead",
    });
    expect(result.format).toBe("v2_markdown");
  });

  it("detects v1 format (frontmatter)", async () => {
    const result = await loader.load(v1Path, {
      agentId: "legacy-agent",
      agentName: "Legacy Worker",
    });
    expect(result.format).toBe("v1_frontmatter");
  });

  it("injects variables in v2 format", async () => {
    const result = await loader.load(v2Path, {
      agentId: "test-agent",
      agentName: "Alice",
      reportsTo: "Bob",
    });
    expect(result.system_prompt).toContain("Alice");
    expect(result.system_prompt).toContain("Acme Corp");
    expect(result.system_prompt).toContain("Bob");
    expect(result.system_prompt).not.toContain("{agent_name}");
    expect(result.system_prompt).not.toContain("{organization}");
  });

  it("injects variables in v1 format", async () => {
    const result = await loader.load(v1Path, {
      agentId: "legacy-agent",
      agentName: "Legacy Worker",
      reportsTo: "Boss",
    });
    expect(result.system_prompt).toContain("Acme Corp");
    expect(result.system_prompt).toContain("Legacy Worker");
    expect(result.system_prompt).toContain("Boss");
  });

  it("v2 load returns valid SkillDefinition", async () => {
    const result = await loader.load(v2Path, {
      agentId: "test-agent",
      agentName: "Test Worker",
    });
    expect(result.definition.agent_id).toBe("test-agent");
    expect(result.definition.system_prompt).toContain("Test Worker");
    expect(result.definition.review_behavior).toBeDefined();
    expect(result.definition.delegation_style).toBeDefined();
  });

  it("v2 load populates validation result", async () => {
    const result = await loader.load(v2Path, {
      agentId: "test-agent",
      agentName: "Test Worker",
    });
    expect(result.validation.valid).toBe(true);
    expect(result.validation.sections_found).toContain("Identity");
  });

  it("throws when skill file does not exist", async () => {
    await expect(
      loader.load("/nonexistent/path/skill.md", { agentId: "x", agentName: "X" }),
    ).rejects.toThrow("not found");
  });

  it("validate delegates to SkillValidator", async () => {
    const validation = await loader.validate(v2Path);
    expect(validation.valid).toBe(true);
    expect(validation.sections_found).toContain("Decision Authority");
  });

  it("v1 format SkillDefinition has correct agent_id from context", async () => {
    const result = await loader.load(v1Path, {
      agentId: "my-agent-id",
      agentName: "My Agent",
    });
    // v2 override: agent_id comes from context, not frontmatter
    expect(result.definition.agent_id).toBe("my-agent-id");
  });
});
