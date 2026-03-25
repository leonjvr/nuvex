/**
 * Tests for Guide: Agent Creation Capability
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir }  from "node:os";
import { join }    from "node:path";
import { parse as parseYaml } from "yaml";
import {
  validateAgentId,
  writeAgentDefinition,
  writeSkillFile,
  registerInAgentsYaml,
  generateDefaultSkill,
  createAgent,
} from "../../src/guide/agent-creator.js";
import type { AgentCreationSpec } from "../../src/guide/agent-creator.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const VALID_SPEC: AgentCreationSpec = {
  id:           "test-researcher",
  name:         "Test Researcher",
  tier:         3,
  division:     "engineering",
  provider:     "groq",
  model:        "llama-3.3-70b-versatile",
  capabilities: ["research", "synthesis"],
  description:  "A test researcher agent",
  budget: { per_task_usd: 0.10, per_month_usd: 5.00 },
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "sidjua-agent-creator-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// validateAgentId
// ---------------------------------------------------------------------------

describe("validateAgentId", () => {
  it("accepts valid lowercase IDs", () => {
    expect(validateAgentId("my-agent").valid).toBe(true);
    expect(validateAgentId("researcher").valid).toBe(true);
    expect(validateAgentId("dev-worker-3").valid).toBe(true);
    expect(validateAgentId("a").valid).toBe(true);
  });

  it("rejects IDs starting with digits", () => {
    expect(validateAgentId("1agent").valid).toBe(false);
    expect(validateAgentId("3-researchers").valid).toBe(false);
  });

  it("rejects IDs with uppercase letters", () => {
    expect(validateAgentId("MyAgent").valid).toBe(false);
    expect(validateAgentId("RESEARCHER").valid).toBe(false);
  });

  it("rejects IDs with spaces or special chars", () => {
    expect(validateAgentId("my agent").valid).toBe(false);
    expect(validateAgentId("my_agent").valid).toBe(false);
    expect(validateAgentId("my.agent").valid).toBe(false);
  });

  it("rejects IDs longer than 63 chars", () => {
    const long = "a".repeat(64);
    expect(validateAgentId(long).valid).toBe(false);
  });

  it("accepts IDs exactly 63 chars", () => {
    const maxLen = "a" + "b".repeat(62);
    expect(validateAgentId(maxLen).valid).toBe(true);
  });

  it("rejects the reserved 'guide' ID", () => {
    const result = validateAgentId("guide");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("reserved");
  });

  it("includes reason in rejection", () => {
    const result = validateAgentId("1bad");
    expect(result.valid).toBe(false);
    expect(result.reason).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// writeAgentDefinition
// ---------------------------------------------------------------------------

describe("writeAgentDefinition", () => {
  it("creates definition file at agents/definitions/<id>.yaml", async () => {
    const path = await writeAgentDefinition(VALID_SPEC, tmpDir);
    expect(path).toContain("agents/definitions/test-researcher.yaml");
    expect(existsSync(path)).toBe(true);
  });

  it("writes valid YAML with required fields", async () => {
    const path = await writeAgentDefinition(VALID_SPEC, tmpDir);
    const raw  = readFileSync(path, "utf-8");
    const def  = parseYaml(raw) as Record<string, unknown>;

    expect(def["id"]).toBe("test-researcher");
    expect(def["name"]).toBe("Test Researcher");
    expect(def["tier"]).toBe(3);
    expect(def["division"]).toBe("engineering");
    expect(def["provider"]).toBe("groq");
    expect(def["model"]).toBe("llama-3.3-70b-versatile");
    expect(Array.isArray(def["capabilities"])).toBe(true);
  });

  it("includes budget in definition", async () => {
    const path = await writeAgentDefinition(VALID_SPEC, tmpDir);
    const raw  = readFileSync(path, "utf-8");
    const def  = parseYaml(raw) as Record<string, unknown>;
    const budget = def["budget"] as Record<string, unknown>;

    expect(budget["per_task_usd"]).toBe(0.10);
    expect(budget["per_month_usd"]).toBe(5.00);
  });

  it("creates parent directories if needed", async () => {
    const deepDir = join(tmpDir, "new-workspace");
    const path = await writeAgentDefinition(VALID_SPEC, deepDir);
    expect(existsSync(path)).toBe(true);
  });

  it("sets max_concurrent_tasks based on tier", async () => {
    const t1Spec = { ...VALID_SPEC, id: "t1-agent", tier: 1 as const };
    const t3Spec = { ...VALID_SPEC, id: "t3-agent", tier: 3 as const };

    const p1 = await writeAgentDefinition(t1Spec, tmpDir);
    const p3 = await writeAgentDefinition(t3Spec, tmpDir);

    const d1 = parseYaml(readFileSync(p1, "utf-8")) as Record<string, unknown>;
    const d3 = parseYaml(readFileSync(p3, "utf-8")) as Record<string, unknown>;

    expect(d1["max_concurrent_tasks"]).toBe(3);   // T1: 3
    expect(d3["max_concurrent_tasks"]).toBe(10);  // T3: 10
  });
});

// ---------------------------------------------------------------------------
// writeSkillFile
// ---------------------------------------------------------------------------

describe("writeSkillFile", () => {
  it("creates skill file at agents/skills/<id>.md", async () => {
    const path = await writeSkillFile("test-researcher", "# Test Skill\n\nHello.", tmpDir);
    expect(path).toContain("agents/skills/test-researcher.md");
    expect(existsSync(path)).toBe(true);
  });

  it("writes the provided content", async () => {
    const content = "# My Skill\n\nDo great things.";
    const path = await writeSkillFile("my-agent", content, tmpDir);
    const raw  = readFileSync(path, "utf-8");
    expect(raw).toBe(content);
  });

  it("creates parent directory if needed", async () => {
    const deepDir = join(tmpDir, "workspace");
    const path = await writeSkillFile("agent", "# Skill", deepDir);
    expect(existsSync(path)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// registerInAgentsYaml
// ---------------------------------------------------------------------------

describe("registerInAgentsYaml", () => {
  it("creates agents.yaml if it does not exist", async () => {
    await registerInAgentsYaml("my-agent", tmpDir);

    const yamlPath = join(tmpDir, "agents", "agents.yaml");
    expect(existsSync(yamlPath)).toBe(true);

    const raw  = readFileSync(yamlPath, "utf-8");
    const data = parseYaml(raw) as { agents: string[] };
    expect(data.agents).toContain("my-agent");
  });

  it("appends to existing agents.yaml", async () => {
    await registerInAgentsYaml("agent-1", tmpDir);
    await registerInAgentsYaml("agent-2", tmpDir);

    const yamlPath = join(tmpDir, "agents", "agents.yaml");
    const raw  = readFileSync(yamlPath, "utf-8");
    const data = parseYaml(raw) as { agents: string[] };

    expect(data.agents).toContain("agent-1");
    expect(data.agents).toContain("agent-2");
  });

  it("does not add duplicates", async () => {
    await registerInAgentsYaml("test-agent", tmpDir);
    await registerInAgentsYaml("test-agent", tmpDir);

    const yamlPath = join(tmpDir, "agents", "agents.yaml");
    const raw  = readFileSync(yamlPath, "utf-8");
    const data = parseYaml(raw) as { agents: string[] };

    const count = data.agents.filter((a) => a === "test-agent").length;
    expect(count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// generateDefaultSkill
// ---------------------------------------------------------------------------

describe("generateDefaultSkill", () => {
  it("generates skill with agent name and description", () => {
    const skill = generateDefaultSkill(VALID_SPEC);
    expect(skill).toContain("Test Researcher");
    expect(skill).toContain("A test researcher agent");
  });

  it("includes capabilities in the skill file", () => {
    const skill = generateDefaultSkill(VALID_SPEC);
    expect(skill).toContain("research");
    expect(skill).toContain("synthesis");
  });

  it("shows correct tier label for T1", () => {
    const spec = { ...VALID_SPEC, tier: 1 as const };
    const skill = generateDefaultSkill(spec);
    expect(skill).toContain("T1 (Strategic Lead)");
  });

  it("shows correct tier label for T2", () => {
    const spec = { ...VALID_SPEC, tier: 2 as const };
    const skill = generateDefaultSkill(spec);
    expect(skill).toContain("T2 (Department Head)");
  });

  it("shows correct tier label for T3", () => {
    const skill = generateDefaultSkill(VALID_SPEC); // tier: 3
    expect(skill).toContain("T3 (Specialist/Worker)");
  });

  it("includes division info", () => {
    const skill = generateDefaultSkill(VALID_SPEC);
    expect(skill).toContain("engineering");
  });

  it("includes markdown header", () => {
    const skill = generateDefaultSkill(VALID_SPEC);
    expect(skill).toMatch(/^#\s+/);
  });

  it("includes management summary instructions", () => {
    const skill = generateDefaultSkill(VALID_SPEC);
    expect(skill).toContain("management summary");
  });
});

// ---------------------------------------------------------------------------
// createAgent (integration)
// ---------------------------------------------------------------------------

describe("createAgent", () => {
  it("creates all three artifacts (definition, skill, agents.yaml)", async () => {
    const result = await createAgent(VALID_SPEC, tmpDir);

    expect(existsSync(result.definitionPath)).toBe(true);
    expect(existsSync(result.skillPath)).toBe(true);
    expect(result.registeredInYaml).toBe(true);

    const yamlPath = join(tmpDir, "agents", "agents.yaml");
    expect(existsSync(yamlPath)).toBe(true);
  });

  it("rejects invalid agent IDs", async () => {
    const badSpec = { ...VALID_SPEC, id: "INVALID_ID" };
    await expect(createAgent(badSpec, tmpDir)).rejects.toThrow("Invalid agent ID");
  });

  it("rejects the 'guide' reserved ID", async () => {
    const badSpec = { ...VALID_SPEC, id: "guide" };
    await expect(createAgent(badSpec, tmpDir)).rejects.toThrow("Invalid agent ID");
  });

  it("definition YAML has correct content", async () => {
    const result = await createAgent(VALID_SPEC, tmpDir);
    const raw    = readFileSync(result.definitionPath, "utf-8");
    const def    = parseYaml(raw) as Record<string, unknown>;

    expect(def["id"]).toBe("test-researcher");
    expect(def["provider"]).toBe("groq");
  });

  it("skill file contains agent name", async () => {
    const result  = await createAgent(VALID_SPEC, tmpDir);
    const content = readFileSync(result.skillPath, "utf-8");
    expect(content).toContain("Test Researcher");
  });

  it("agent appears in agents.yaml after creation", async () => {
    await createAgent(VALID_SPEC, tmpDir);

    const yamlPath = join(tmpDir, "agents", "agents.yaml");
    const raw  = readFileSync(yamlPath, "utf-8");
    const data = parseYaml(raw) as { agents: string[] };
    expect(data.agents).toContain("test-researcher");
  });
});
