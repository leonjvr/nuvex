/**
 * Phase 10.5 — HotReconfigure unit tests
 */

import { describe, it, expect } from "vitest";
import { HotReconfigure } from "../../src/agent-lifecycle/hot-reconfigure.js";
import type { AgentLifecycleDefinition } from "../../src/agent-lifecycle/types.js";

const BASE: AgentLifecycleDefinition = {
  id: "video-editor",
  name: "Video Editor",
  tier: 3,
  division: "content",
  provider: "anthropic",
  model: "claude-sonnet-4-5",
  skill: "agents/skills/video-editor.md",
  capabilities: ["video-editing", "color-grading"],
  budget: { per_task_usd: 5.00, per_hour_usd: 10.00, per_month_usd: 200.00 },
};

const reconfigurer = new HotReconfigure();

describe("HotReconfigure", () => {
  it("computeHash produces a 16-char hex string", () => {
    const hash = reconfigurer.computeHash(BASE);
    expect(hash).toHaveLength(16);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it("same definition → same hash", () => {
    const h1 = reconfigurer.computeHash(BASE);
    const h2 = reconfigurer.computeHash({ ...BASE });
    expect(h1).toBe(h2);
  });

  it("different model → different hash", () => {
    const h1 = reconfigurer.computeHash(BASE);
    const h2 = reconfigurer.computeHash({ ...BASE, model: "claude-opus-4-5" });
    expect(h1).not.toBe(h2);
  });

  it("no changes → config_hash_changed false", () => {
    const result = reconfigurer.detectChanges(BASE, { ...BASE });
    expect(result.config_hash_changed).toBe(false);
    expect(result.changes).toHaveLength(0);
    expect(result.requires_restart).toBe(false);
  });

  it("model change → immediate (no restart)", () => {
    const newDef = { ...BASE, model: "claude-opus-4-5" };
    const result = reconfigurer.detectChanges(BASE, newDef);
    expect(result.config_hash_changed).toBe(true);
    expect(result.changes.some((c) => c.field === "model")).toBe(true);
    expect(result.requires_restart).toBe(false);
    expect(result.restart_fields).toHaveLength(0);
    expect(result.immediate_fields).toContain("model");
  });

  it("division change → restart required", () => {
    const newDef = { ...BASE, division: "engineering" };
    const result = reconfigurer.detectChanges(BASE, newDef);
    expect(result.requires_restart).toBe(true);
    expect(result.restart_fields).toContain("division");
    expect(result.restart_reason).toContain("division");
  });

  it("tier change → restart required", () => {
    const newDef = { ...BASE, tier: 2 };
    const result = reconfigurer.detectChanges(BASE, newDef);
    expect(result.requires_restart).toBe(true);
    expect(result.restart_fields).toContain("tier");
  });

  it("budget change → immediate", () => {
    const newDef = { ...BASE, budget: { ...BASE.budget, per_month_usd: 300.00 } };
    const result = reconfigurer.detectChanges(BASE, newDef);
    expect(result.requires_restart).toBe(false);
    expect(result.immediate_fields).toContain("budget");
  });

  it("capabilities change → immediate", () => {
    const newDef = { ...BASE, capabilities: ["video-editing", "color-grading", "audio-sync"] };
    const result = reconfigurer.detectChanges(BASE, newDef);
    expect(result.requires_restart).toBe(false);
    expect(result.immediate_fields).toContain("capabilities");
  });

  it("applyPatch merges budget objects correctly", () => {
    const { merged, result } = reconfigurer.applyPatch(BASE, {
      budget: { per_month_usd: 300.00 },
    });
    // Should keep per_task_usd and per_hour_usd from BASE
    expect(merged.budget?.per_task_usd).toBe(5.00);
    expect(merged.budget?.per_month_usd).toBe(300.00);
    expect(result.changes.some((c) => c.field === "budget")).toBe(true);
  });

  it("applyPatch with model change detects field correctly", () => {
    const { merged, result } = reconfigurer.applyPatch(BASE, { model: "claude-haiku-4-5" });
    expect(merged.model).toBe("claude-haiku-4-5");
    const modelChange = result.changes.find((c) => c.field === "model");
    expect(modelChange?.old_value).toBe("claude-sonnet-4-5");
    expect(modelChange?.new_value).toBe("claude-haiku-4-5");
    expect(modelChange?.requires_restart).toBe(false);
  });

  it("multiple changes — restart if any field requires restart", () => {
    const newDef = { ...BASE, model: "claude-haiku-4-5", division: "intelligence" };
    const result = reconfigurer.detectChanges(BASE, newDef);
    expect(result.requires_restart).toBe(true);
    // Model is immediate, division needs restart
    expect(result.immediate_fields).toContain("model");
    expect(result.restart_fields).toContain("division");
  });
});
