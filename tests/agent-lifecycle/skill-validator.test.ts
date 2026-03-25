/**
 * Phase 10.5 — SkillValidator unit tests
 */

import { describe, it, expect } from "vitest";
import { SkillValidator, parseSections, injectVariables } from "../../src/agent-lifecycle/skill-validator.js";

const VALID_SKILL = `# Video Editor — Agent Skill Definition

## Identity
You are a professional video editor working for {organization}.
Your name is {agent_name}.
Your supervisor is {reports_to}.

## Work Style
- Review all raw footage before starting edits

## Decision Authority
- You MAY: trim clips, adjust color
- You MAY NOT: delete original footage
- ESCALATE: style changes not in brand guide

## Quality Standards
- Output resolution: match source

## Supervision Expectations
When you complete a task:
1. Write full result to result file
2. Create management summary
`;

const validator = new SkillValidator();

// ---------------------------------------------------------------------------
// parseSections
// ---------------------------------------------------------------------------

describe("parseSections", () => {
  it("extracts ## sections in order", () => {
    const sections = parseSections(VALID_SKILL);
    const names = sections.map((s) => s.name);
    expect(names).toContain("Identity");
    expect(names).toContain("Decision Authority");
    expect(names).toContain("Quality Standards");
    expect(names).toContain("Supervision Expectations");
  });

  it("excludes # title from sections", () => {
    const sections = parseSections(VALID_SKILL);
    expect(sections.find((s) => s.name === "Video Editor — Agent Skill Definition")).toBeUndefined();
  });

  it("preserves section content", () => {
    const sections = parseSections(VALID_SKILL);
    const identity = sections.find((s) => s.name === "Identity");
    expect(identity?.content).toContain("{organization}");
  });
});

// ---------------------------------------------------------------------------
// injectVariables
// ---------------------------------------------------------------------------

describe("injectVariables", () => {
  it("replaces all three variables", () => {
    const result = injectVariables(
      "You work for {organization} as {agent_name}, supervised by {reports_to}.",
      { agent_name: "Haiku", organization: "Acme Corp", reports_to: "Sonnet Lead" },
    );
    expect(result).toBe("You work for Acme Corp as Haiku, supervised by Sonnet Lead.");
  });

  it("replaces multiple occurrences", () => {
    const result = injectVariables(
      "{agent_name} is {agent_name}. {organization} loves {organization}.",
      { agent_name: "Alice", organization: "Corp", reports_to: "Bob" },
    );
    expect(result).toBe("Alice is Alice. Corp loves Corp.");
  });
});

// ---------------------------------------------------------------------------
// SkillValidator.validate
// ---------------------------------------------------------------------------

describe("SkillValidator", () => {
  it("passes a valid skill.md", () => {
    const result = validator.validate(VALID_SKILL);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("reports missing required sections", () => {
    const content = `## Identity\nYou work for {organization}.`;
    const result = validator.validate(content);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Decision Authority"))).toBe(true);
    expect(result.errors.some((e) => e.includes("Quality Standards"))).toBe(true);
    expect(result.errors.some((e) => e.includes("Supervision Expectations"))).toBe(true);
  });

  it("warns about missing recommended sections", () => {
    const result = validator.validate(VALID_SKILL);
    // Work Style IS present in VALID_SKILL, so only Error Handling and Communication Style should warn
    expect(result.warnings.some((w) => w.includes("Error Handling"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("Communication Style"))).toBe(true);
  });

  it("errors on Decision Authority missing MAY NOT", () => {
    const content = `
## Identity
You are {agent_name} at {organization}.

## Decision Authority
- You MAY: do things
- ESCALATE: when needed

## Quality Standards
Standards here.

## Supervision Expectations
Write result and summary.
`;
    const result = validator.validate(content);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("MAY NOT"))).toBe(true);
  });

  it("errors on Decision Authority missing ESCALATE", () => {
    const content = `
## Identity
{agent_name} at {organization}.

## Decision Authority
- You MAY: do something
- You MAY NOT: something else

## Quality Standards
.

## Supervision Expectations
result and summary.
`;
    const result = validator.validate(content);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("ESCALATE"))).toBe(true);
  });

  it("detects variable placeholders", () => {
    const result = validator.validate(VALID_SKILL);
    expect(result.has_variables.agent_name).toBe(true);
    expect(result.has_variables.organization).toBe(true);
    expect(result.has_variables.reports_to).toBe(true);
  });

  it("warns about frontmatter format", () => {
    const frontmatterContent = `---
agent_id: test
role: tester
---
# Test
## Identity
## Decision Authority
- You MAY: x
- You MAY NOT: y
- ESCALATE: z
## Quality Standards
.
## Supervision Expectations
result + summary.
`;
    const result = validator.validate(frontmatterContent);
    expect(result.warnings.some((w) => w.includes("frontmatter"))).toBe(true);
  });

  it("errors when size exceeds 50KB", () => {
    const big = "x".repeat(51 * 1024);
    const result = validator.validate(big, 51 * 1024);
    expect(result.errors.some((e) => e.includes("50KB"))).toBe(true);
  });

  it("lists sections_found", () => {
    const result = validator.validate(VALID_SKILL);
    expect(result.sections_found).toContain("Identity");
    expect(result.sections_found).toContain("Decision Authority");
  });
});
