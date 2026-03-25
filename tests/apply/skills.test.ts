/**
 * Tests for Step 7: SKILLS
 *
 * Covers:
 * - Division-specific templates applied
 * - _default fallback for unknown division codes
 * - HIGH_RISK_SKILLS get requires_approval: true
 * - Existing skills.yaml NOT overwritten (overwrite:false)
 * - Skills written to {div.code}/.meta/skills.yaml
 * - Inactive divisions have no skills.yaml created
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { applySkills, generateSkillsForDivision } from "../../src/apply/skills.js";
import type { ParsedConfig, Division } from "../../src/types/config.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDivision(code: string, active = true): Division {
  return {
    code,
    name: { en: code },
    scope: "test",
    required: false,
    active,
    recommend_from: null,
    head: { role: null, agent: null },
  };
}

function makeConfig(codes: string[], inactive: string[] = []): ParsedConfig {
  const activeDivs = codes.map((c) => makeDivision(c, true));
  const inactiveDivs = inactive.map((c) => makeDivision(c, false));
  const divisions = [...activeDivs, ...inactiveDivs];
  return {
    schema_version: "1.0",
    company: { name: "TestCo", size: "solo", locale: "en", timezone: "UTC", mode: "business" },
    mode: "business",
    divisions,
    activeDivisions: activeDivs,
    size_presets: { solo: { recommended: [], description: "Solo" } },
    sourcePath: "/tmp/test.yaml",
    contentHash: "abc123",
  };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "sidjua-skills-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// generateSkillsForDivision
// ---------------------------------------------------------------------------

describe("generateSkillsForDivision", () => {
  it("returns engineering template for 'engineering' division", () => {
    const file = generateSkillsForDivision("engineering");
    const skillNames = file.skills.map((s) => s.name);
    expect(skillNames).toContain("read_file");
    expect(skillNames).toContain("write_file");
    expect(skillNames).toContain("execute_code");
    expect(skillNames).toContain("git_operations");
    expect(skillNames).toContain("deploy");
  });

  it("returns sales template for 'sales' division", () => {
    const file = generateSkillsForDivision("sales");
    const skillNames = file.skills.map((s) => s.name);
    expect(skillNames).toContain("send_email_draft");
    expect(skillNames).toContain("crm_access");
  });

  it("returns _default template for unknown division code", () => {
    const file = generateSkillsForDivision("unknown-division");
    const skillNames = file.skills.map((s) => s.name);
    expect(skillNames).toContain("read_file");
    expect(skillNames).toContain("write_file");
    expect(skillNames).toContain("search_knowledge");
    expect(skillNames).toHaveLength(3);
  });

  it("HIGH_RISK_SKILLS get requires_approval: true", () => {
    const file = generateSkillsForDivision("engineering");
    const deploy = file.skills.find((s) => s.name === "deploy");
    expect(deploy?.requires_approval).toBe(true);
  });

  it("non-risk skills get requires_approval: false", () => {
    const file = generateSkillsForDivision("engineering");
    const readFile = file.skills.find((s) => s.name === "read_file");
    expect(readFile?.requires_approval).toBe(false);
  });

  it("sales send_email_draft is high-risk", () => {
    const file = generateSkillsForDivision("sales");
    const emailSkill = file.skills.find((s) => s.name === "send_email_draft");
    expect(emailSkill?.requires_approval).toBe(true);
  });

  it("all skills have scope = 'own_division'", () => {
    const file = generateSkillsForDivision("engineering");
    for (const skill of file.skills) {
      expect(skill.scope).toBe("own_division");
    }
  });

  it("returns generated_at as ISO string", () => {
    const file = generateSkillsForDivision("engineering");
    expect(file.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// ---------------------------------------------------------------------------
// applySkills — file creation
// ---------------------------------------------------------------------------

describe("applySkills", () => {
  it("creates skills.yaml in {div}/.meta/ for each active division", () => {
    const config = makeConfig(["engineering", "sales"]);

    // Pre-create the .meta dirs (normally done by FILESYSTEM step)
    mkdirSync(join(tmpDir, "engineering", ".meta"), { recursive: true });
    mkdirSync(join(tmpDir, "sales", ".meta"), { recursive: true });

    applySkills(config, tmpDir);

    expect(existsSync(join(tmpDir, "engineering", ".meta", "skills.yaml"))).toBe(true);
    expect(existsSync(join(tmpDir, "sales", ".meta", "skills.yaml"))).toBe(true);
  });

  it("written YAML is parseable and contains correct division", () => {
    const config = makeConfig(["engineering"]);
    mkdirSync(join(tmpDir, "engineering", ".meta"), { recursive: true });
    applySkills(config, tmpDir);

    const content = readFileSync(join(tmpDir, "engineering", ".meta", "skills.yaml"), "utf-8");
    const parsed = parse(content) as { division: string; skills: unknown[] };
    expect(parsed.division).toBe("engineering");
    expect(Array.isArray(parsed.skills)).toBe(true);
    expect(parsed.skills.length).toBeGreaterThan(0);
  });

  it("does NOT create skills.yaml for inactive divisions", () => {
    const config = makeConfig(["engineering"], ["hr"]);
    mkdirSync(join(tmpDir, "engineering", ".meta"), { recursive: true });
    applySkills(config, tmpDir);

    expect(existsSync(join(tmpDir, "hr", ".meta", "skills.yaml"))).toBe(false);
  });

  it("preserves existing skills.yaml (overwrite:false)", () => {
    const config = makeConfig(["engineering"]);
    mkdirSync(join(tmpDir, "engineering", ".meta"), { recursive: true });

    const customContent = "# CUSTOM SKILLS\ndivision: engineering\nskills: []\n";
    writeFileSync(join(tmpDir, "engineering", ".meta", "skills.yaml"), customContent, "utf-8");

    applySkills(config, tmpDir);

    const content = readFileSync(join(tmpDir, "engineering", ".meta", "skills.yaml"), "utf-8");
    expect(content).toBe(customContent);
  });

  it("creates .meta directory if missing", () => {
    const config = makeConfig(["engineering"]);
    // Do NOT pre-create .meta — applySkills should create it
    applySkills(config, tmpDir);
    expect(existsSync(join(tmpDir, "engineering", ".meta", "skills.yaml"))).toBe(true);
  });

  it("returns StepResult with success:true", () => {
    const config = makeConfig(["engineering"]);
    const result = applySkills(config, tmpDir);
    expect(result.step).toBe("SKILLS");
    expect(result.success).toBe(true);
  });

  it("reports preserved count in details when file already exists", () => {
    const config = makeConfig(["engineering"]);
    mkdirSync(join(tmpDir, "engineering", ".meta"), { recursive: true });
    applySkills(config, tmpDir);

    // Second run — all files preserved
    const result = applySkills(config, tmpDir);
    expect(result.details?.["preserved"]).toBe(1);
    expect(result.details?.["newFiles"]).toBe(0);
  });
});
