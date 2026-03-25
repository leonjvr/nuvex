/**
 * Integration test: full `sidjua apply` pipeline
 *
 * Covers:
 * - Full apply() with real config/divisions.yaml
 * - All 10 steps produce success:true
 * - All expected files and directories exist after apply
 * - Idempotency: running apply() twice produces the same file structure
 * - Personal mode end-to-end
 * - --step flag limits execution to specified step (and prerequisites)
 * - Failed VALIDATE aborts the pipeline before writing anything
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { parse } from "yaml";
import { apply } from "../../src/apply/index.js";
import type { ApplyOptions } from "../../src/types/apply.js";
import type { CostCentersConfig, StateFile } from "../../src/types/apply.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REAL_CONFIG = resolve(__dirname, "../../config/divisions.yaml");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOptions(tmpDir: string, overrides: Partial<ApplyOptions> = {}): ApplyOptions {
  return {
    configPath: REAL_CONFIG,
    dryRun: false,
    verbose: false,
    force: true,
    workDir: tmpDir,
    ...overrides,
  };
}

/** Minimal personal mode divisions.yaml content */
const PERSONAL_CONFIG_YAML = `
schema_version: "1.0"
mode: personal
company:
  name: "Personal Workspace"
  size: personal
  locale: en
  timezone: UTC
divisions: []
size_presets:
  solo:
    recommended: []
    description: Solo
`.trim();

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "sidjua-integration-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Full apply — real config
// ---------------------------------------------------------------------------

describe("apply() — full pipeline with real divisions.yaml", () => {
  it("completes successfully with all 11 steps (includes AGENTS)", async () => {
    const result = await apply(makeOptions(tmpDir));
    expect(result.success).toBe(true);
    expect(result.steps).toHaveLength(11);
    for (const step of result.steps) {
      expect(step.success, `Step ${step.step} should succeed`).toBe(true);
    }
  });

  it("creates .system/ directory with core files", async () => {
    await apply(makeOptions(tmpDir));
    expect(existsSync(join(tmpDir, ".system", "sidjua.db"))).toBe(true);
    expect(existsSync(join(tmpDir, ".system", "secrets.db"))).toBe(true);
    expect(existsSync(join(tmpDir, ".system", "rbac.yaml"))).toBe(true);
    expect(existsSync(join(tmpDir, ".system", "routing-table.yaml"))).toBe(true);
    expect(existsSync(join(tmpDir, ".system", "cost-centers.yaml"))).toBe(true);
    expect(existsSync(join(tmpDir, ".system", "state.json"))).toBe(true);
  });

  it("creates README.md at workspace root", async () => {
    await apply(makeOptions(tmpDir));
    expect(existsSync(join(tmpDir, "README.md"))).toBe(true);
  });

  it("creates division directories for each active division", async () => {
    await apply(makeOptions(tmpDir));
    // From config/divisions.yaml — 12 active divisions
    const expectedDivs = [
      "executive", "legal", "finance", "product", "engineering",
      "sales", "customer-service", "marketing", "communications",
      "it", "intelligence", "ai-governance",
    ];
    for (const code of expectedDivs) {
      expect(existsSync(join(tmpDir, code)), `Division dir "${code}" should exist`).toBe(true);
      expect(existsSync(join(tmpDir, code, "inbox"))).toBe(true);
      expect(existsSync(join(tmpDir, code, ".meta", "division.json"))).toBe(true);
    }
  });

  it("creates skills.yaml for each active division", async () => {
    await apply(makeOptions(tmpDir));
    expect(existsSync(join(tmpDir, "engineering", ".meta", "skills.yaml"))).toBe(true);
    expect(existsSync(join(tmpDir, "customer-service", ".meta", "skills.yaml"))).toBe(true);
  });

  it("creates governance/audit/ structure", async () => {
    await apply(makeOptions(tmpDir));
    expect(existsSync(join(tmpDir, "governance", "audit", "reports"))).toBe(true);
    expect(existsSync(join(tmpDir, "governance", "audit", "audit-config.yaml"))).toBe(true);
  });

  it("state.json has 12 active divisions", async () => {
    await apply(makeOptions(tmpDir));
    const state = JSON.parse(
      readFileSync(join(tmpDir, ".system", "state.json"), "utf-8"),
    ) as StateFile;
    expect(state.last_apply.active_divisions).toHaveLength(12);
  });

  it("cost-centers.yaml lists all 12 active divisions", async () => {
    await apply(makeOptions(tmpDir));
    const cc = parse(
      readFileSync(join(tmpDir, ".system", "cost-centers.yaml"), "utf-8"),
    ) as CostCentersConfig;
    expect(Object.keys(cc.divisions)).toHaveLength(12);
  });
});

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

describe("apply() — idempotency", () => {
  it("running apply twice produces the same outcome", async () => {
    const r1 = await apply(makeOptions(tmpDir));
    const r2 = await apply(makeOptions(tmpDir));

    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);

    // Both runs have same number of steps
    expect(r1.steps).toHaveLength(r2.steps.length);
    // Both runs succeed all steps
    for (const step of r2.steps) {
      expect(step.success, `Step ${step.step} should succeed on second run`).toBe(true);
    }
  });

  it("user-customised skills.yaml preserved after second apply", async () => {
    await apply(makeOptions(tmpDir));

    const skillsPath = join(tmpDir, "engineering", ".meta", "skills.yaml");
    const custom = "# CUSTOM\ndivision: engineering\nskills: []\n";
    writeFileSync(skillsPath, custom, "utf-8");

    await apply(makeOptions(tmpDir));

    const content = readFileSync(skillsPath, "utf-8");
    expect(content).toBe(custom);
  });

  it("history grows by one entry on second apply", async () => {
    await apply(makeOptions(tmpDir));
    await apply(makeOptions(tmpDir));

    const state = JSON.parse(
      readFileSync(join(tmpDir, ".system", "state.json"), "utf-8"),
    ) as StateFile;
    expect(state.history).toHaveLength(2);
  });

  it("cost-centers user limit preserved after second apply", async () => {
    await apply(makeOptions(tmpDir));

    // Simulate user setting a monthly limit
    const ccPath = join(tmpDir, ".system", "cost-centers.yaml");
    const cc = parse(readFileSync(ccPath, "utf-8")) as CostCentersConfig;
    cc.divisions["engineering"] = { monthly_limit_usd: 100.0, daily_limit_usd: null };
    writeFileSync(ccPath, JSON.stringify(cc));

    await apply(makeOptions(tmpDir));

    const updated = parse(readFileSync(ccPath, "utf-8")) as CostCentersConfig;
    expect(updated.divisions["engineering"]?.monthly_limit_usd).toBe(100.0);
  });
});

// ---------------------------------------------------------------------------
// Personal mode
// ---------------------------------------------------------------------------

describe("apply() — personal mode", () => {
  it("runs successfully in personal mode", async () => {
    const personalConfigPath = join(tmpDir, "divisions.yaml");
    writeFileSync(personalConfigPath, PERSONAL_CONFIG_YAML, "utf-8");

    const result = await apply(makeOptions(tmpDir, { configPath: personalConfigPath }));
    expect(result.success).toBe(true);
  });

  it("personal mode creates workspace/ structure", async () => {
    const personalConfigPath = join(tmpDir, "divisions.yaml");
    writeFileSync(personalConfigPath, PERSONAL_CONFIG_YAML, "utf-8");

    await apply(makeOptions(tmpDir, { configPath: personalConfigPath }));
    expect(existsSync(join(tmpDir, "workspace", "projects"))).toBe(true);
    expect(existsSync(join(tmpDir, "workspace", "knowledge"))).toBe(true);
  });

  it("personal mode creates governance/ with template files", async () => {
    const personalConfigPath = join(tmpDir, "divisions.yaml");
    writeFileSync(personalConfigPath, PERSONAL_CONFIG_YAML, "utf-8");

    await apply(makeOptions(tmpDir, { configPath: personalConfigPath }));
    expect(existsSync(join(tmpDir, "governance", "my-rules.yaml"))).toBe(true);
    expect(existsSync(join(tmpDir, "governance", "boundaries", "forbidden-actions.yaml"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// --step flag
// ---------------------------------------------------------------------------

describe("apply() — step flag", () => {
  it("--step VALIDATE runs only VALIDATE", async () => {
    const result = await apply(makeOptions(tmpDir, { step: "VALIDATE" }));
    expect(result.success).toBe(true);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]?.step).toBe("VALIDATE");
    // No filesystem changes
    expect(existsSync(join(tmpDir, ".system"))).toBe(false);
  });

  it("--step FILESYSTEM runs VALIDATE + FILESYSTEM", async () => {
    const result = await apply(makeOptions(tmpDir, { step: "FILESYSTEM" }));
    expect(result.success).toBe(true);
    const stepNames = result.steps.map((s) => s.step);
    expect(stepNames).toContain("VALIDATE");
    expect(stepNames).toContain("FILESYSTEM");
    expect(stepNames).not.toContain("DATABASE");
    // .system dir created by FILESYSTEM
    expect(existsSync(join(tmpDir, ".system"))).toBe(true);
  });

  it("--step DATABASE runs VALIDATE + FILESYSTEM + DATABASE", async () => {
    const result = await apply(makeOptions(tmpDir, { step: "DATABASE" }));
    expect(result.success).toBe(true);
    const stepNames = result.steps.map((s) => s.step);
    expect(stepNames).toContain("DATABASE");
    expect(stepNames).not.toContain("SECRETS");
    expect(existsSync(join(tmpDir, ".system", "sidjua.db"))).toBe(true);
  });

  it("--step AUDIT runs steps 1-8", async () => {
    const result = await apply(makeOptions(tmpDir, { step: "AUDIT" }));
    expect(result.success).toBe(true);
    const stepNames = result.steps.map((s) => s.step);
    expect(stepNames).toContain("AUDIT");
    expect(stepNames).not.toContain("COST_CENTERS");
    expect(stepNames).not.toContain("FINALIZE");
  });
});

// ---------------------------------------------------------------------------
// Error propagation
// ---------------------------------------------------------------------------

describe("apply() — error handling", () => {
  it("invalid config path returns success:false with VALIDATE error", async () => {
    const result = await apply(
      makeOptions(tmpDir, { configPath: "/nonexistent/divisions.yaml" }),
    );
    expect(result.success).toBe(false);
    // No files written
    expect(existsSync(join(tmpDir, ".system"))).toBe(false);
  });

  it("invalid divisions.yaml content returns success:false", async () => {
    const badConfigPath = join(tmpDir, "bad.yaml");
    writeFileSync(badConfigPath, "schema_version: '99.99'\ncompany: {}\n", "utf-8");

    const result = await apply(makeOptions(tmpDir, { configPath: badConfigPath }));
    expect(result.success).toBe(false);
    expect(result.steps[0]?.step).toBe("VALIDATE");
    expect(result.steps[0]?.success).toBe(false);
  });
});
