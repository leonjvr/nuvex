/**
 * Phase 10.5 — AgentTemplateLoader unit tests
 * Phase 16   — Provider pricing helper tests (getProviderPricing)
 */

import { describe, it, expect } from "vitest";
import { AgentTemplateLoader } from "../../src/agent-lifecycle/agent-template.js";
import { getProviderPricing } from "../../src/agent-lifecycle/cli-agent.js";

const loader = new AgentTemplateLoader();

describe("AgentTemplateLoader", () => {
  it("listTemplates returns 9 built-in templates", async () => {
    const templates = await loader.listTemplates();
    expect(templates.length).toBeGreaterThanOrEqual(9);
  });

  it("all built-in template IDs are correct", async () => {
    const templates = await loader.listTemplates();
    const ids = templates.map((t) => t.id);
    const expected = [
      "strategic-lead", "department-head", "code-worker", "researcher",
      "writer", "data-analyst", "customer-support", "video-editor", "custom",
    ];
    for (const id of expected) {
      expect(ids).toContain(id);
    }
  });

  it("getTemplate returns undefined for unknown ID", async () => {
    const t = await loader.getTemplate("nonexistent-template-xyz");
    expect(t).toBeUndefined();
  });

  it("getTemplate returns the correct template", async () => {
    const t = await loader.getTemplate("code-worker");
    expect(t?.tier).toBe(3);
    expect(t?.defaults.capabilities).toContain("coding");
  });

  it("expand sets all required fields", async () => {
    const def = await loader.expand("code-worker", {
      id: "my-coder",
      name: "My Coder",
      division: "engineering",
      provider: "anthropic",
      model: "claude-haiku-4-5",
    });
    expect(def.id).toBe("my-coder");
    expect(def.name).toBe("My Coder");
    expect(def.tier).toBe(3);
    expect(def.division).toBe("engineering");
    expect(def.provider).toBe("anthropic");
    expect(def.model).toBe("claude-haiku-4-5");
    expect(def.schema_version).toBe("1.0");
  });

  it("expand inherits template tier", async () => {
    const def = await loader.expand("strategic-lead", { id: "ceo-agent", division: "executive", provider: "anthropic", model: "claude-opus-4-5" });
    expect(def.tier).toBe(1);
  });

  it("expand overrides tier when provided", async () => {
    const def = await loader.expand("strategic-lead", { id: "demoted", tier: 2, division: "exec", provider: "anthropic", model: "m" });
    expect(def.tier).toBe(2);
  });

  it("expand merges budget (override wins)", async () => {
    const def = await loader.expand("video-editor", {
      id: "v1",
      division: "content",
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      budget: { per_month_usd: 999.00 },
    });
    // per_month_usd should be overridden to 999
    expect(def.budget?.per_month_usd).toBe(999.00);
    // per_task_usd should come from template default
    expect(def.budget?.per_task_usd).toBe(5.00);
  });

  it("expand throws for unknown template", async () => {
    await expect(
      loader.expand("nonexistent", { id: "x", division: "y", provider: "z", model: "m" }),
    ).rejects.toThrow("not found");
  });

  it("getSkillTemplate returns markdown content", async () => {
    const content = await loader.getSkillTemplate("code-worker");
    expect(content).toBeDefined();
    expect(content).toContain("## Identity");
    expect(content).toContain("## Decision Authority");
  });

  it("custom template has all required placeholders", async () => {
    const content = await loader.getSkillTemplate("custom");
    expect(content).toContain("{agent_name}");
    expect(content).toContain("{organization}");
    expect(content).toContain("{reports_to}");
  });
});

// ---------------------------------------------------------------------------
// Phase 16: getProviderPricing tests
// ---------------------------------------------------------------------------

describe("getProviderPricing", () => {
  it("returns isPaid=true for anthropic claude-sonnet-4-6", () => {
    const info = getProviderPricing("anthropic", "claude-sonnet-4-6");
    expect(info.isPaid).toBe(true);
    expect(info.inputPer1m).toBe(3);
    expect(info.outputPer1m).toBe(15);
  });

  it("returns isPaid=true for anthropic claude-opus-4-6", () => {
    const info = getProviderPricing("anthropic", "claude-opus-4-6");
    expect(info.isPaid).toBe(true);
    expect(info.inputPer1m).toBeGreaterThan(0);
    expect(info.outputPer1m).toBeGreaterThan(0);
  });

  it("returns isPaid=false for cloudflare-ai free model", () => {
    const info = getProviderPricing("cloudflare-ai", "@cf/meta/llama-4-scout-17b-16e-instruct");
    expect(info.isPaid).toBe(false);
    expect(info.inputPer1m).toBe(0);
    expect(info.outputPer1m).toBe(0);
  });

  it("returns isPaid=false for local ollama provider", () => {
    const info = getProviderPricing("ollama", "llama3");
    expect(info.isPaid).toBe(false);
  });

  it("returns isPaid=false for unknown provider/model", () => {
    const info = getProviderPricing("unknown-provider", "unknown-model");
    expect(info.isPaid).toBe(false);
    expect(info.inputPer1m).toBe(0);
    expect(info.outputPer1m).toBe(0);
  });
});


// ---------------------------------------------------------------------------
// resolveSkillPath — path traversal guard (SEC-010)
// ---------------------------------------------------------------------------

import { resolveSkillPath } from "../../src/agent-lifecycle/agent-template.js";

describe("resolveSkillPath — path traversal guard (SEC-010)", () => {
  const workDir = "/app/workdir";

  it("allows valid relative skill paths", () => {
    const result = resolveSkillPath(workDir, "skills/my-skill.md");
    expect(result).toBe("/app/workdir/skills/my-skill.md");
  });

  it("allows nested valid paths", () => {
    const result = resolveSkillPath(workDir, "skills/sub/deep.md");
    expect(result).toBe("/app/workdir/skills/sub/deep.md");
  });

  it("rejects path traversal with ..", () => {
    // SidjuaError SEC-010: code is on .code property; message contains "Path traversal"
    expect(() => resolveSkillPath(workDir, "../../etc/passwd")).toThrow(/path traversal/i);
  });

  it("rejects single-level path traversal", () => {
    expect(() => resolveSkillPath(workDir, "../sibling-dir/file.md")).toThrow(/path traversal/i);
  });

  it("rejects absolute paths", () => {
    expect(() => resolveSkillPath(workDir, "/etc/passwd")).toThrow(/not absolute|SEC-010|absolute/i);
  });

  it("allows path that stays within workDir (no escape)", () => {
    const result = resolveSkillPath(workDir, "a/b/../c.md");
    expect(result).toBe("/app/workdir/a/c.md");
  });
});
