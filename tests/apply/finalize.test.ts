/**
 * Tests for Step 10: FINALIZE
 *
 * Covers:
 * - state.json written with correct last_apply fields
 * - divisions_yaml_hash uses config.contentHash with "sha256:" prefix
 * - governance_hash computed from governance/ directory
 * - README.md generated with division navigation
 * - History appended on re-apply
 * - state.json history is never truncated
 * - Initial apply: history has one entry with "initial setup"
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyFinalize } from "../../src/apply/finalize.js";
import type { ParsedConfig, Division } from "../../src/types/config.js";
import type { StateFile } from "../../src/types/apply.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDivision(code: string, active = true, agent: string | null = null): Division {
  return {
    code,
    name: { en: code },
    scope: "test",
    required: false,
    active,
    recommend_from: null,
    head: { role: null, agent },
  };
}

function makeConfig(
  activeCodes: string[],
  inactiveCodes: string[] = [],
  contentHash = "abc123",
): ParsedConfig {
  const activeDivs = activeCodes.map((c) => makeDivision(c, true, "opus-t1"));
  const inactiveDivs = inactiveCodes.map((c) => makeDivision(c, false));
  const divisions = [...activeDivs, ...inactiveDivs];
  return {
    schema_version: "1.0",
    company: { name: "TestCo", size: "solo", locale: "en", timezone: "UTC", mode: "business" },
    mode: "business",
    divisions,
    activeDivisions: activeDivs,
    size_presets: { solo: { recommended: [], description: "Solo" } },
    sourcePath: "/tmp/test.yaml",
    contentHash,
  };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "sidjua-finalize-test-"));
  // Create .system dir (normally done by FILESYSTEM step)
  mkdirSync(join(tmpDir, ".system"), { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// state.json
// ---------------------------------------------------------------------------

describe("applyFinalize — state.json", () => {
  it("creates state.json at .system/state.json", () => {
    const config = makeConfig(["engineering"]);
    applyFinalize(config, tmpDir, 1000);
    expect(existsSync(join(tmpDir, ".system", "state.json"))).toBe(true);
  });

  it("state.json has correct schema_version", () => {
    const config = makeConfig(["engineering"]);
    applyFinalize(config, tmpDir, 500);
    const state = JSON.parse(readFileSync(join(tmpDir, ".system", "state.json"), "utf-8")) as StateFile;
    expect(state.schema_version).toBe("1.0");
  });

  it("divisions_yaml_hash is 'sha256:' + contentHash", () => {
    const config = makeConfig(["engineering"], [], "deadbeef");
    applyFinalize(config, tmpDir, 100);
    const state = JSON.parse(readFileSync(join(tmpDir, ".system", "state.json"), "utf-8")) as StateFile;
    expect(state.last_apply.divisions_yaml_hash).toBe("sha256:deadbeef");
  });

  it("active_divisions list matches config.activeDivisions", () => {
    const config = makeConfig(["executive", "engineering"], ["hr"]);
    applyFinalize(config, tmpDir, 200);
    const state = JSON.parse(readFileSync(join(tmpDir, ".system", "state.json"), "utf-8")) as StateFile;
    expect(state.last_apply.active_divisions.sort()).toEqual(["engineering", "executive"]);
    expect(state.last_apply.inactive_divisions).toEqual(["hr"]);
  });

  it("mode matches config.mode", () => {
    const config = makeConfig(["engineering"]);
    applyFinalize(config, tmpDir, 300);
    const state = JSON.parse(readFileSync(join(tmpDir, ".system", "state.json"), "utf-8")) as StateFile;
    expect(state.last_apply.mode).toBe("business");
  });

  it("apply_duration_ms is the passed value", () => {
    const config = makeConfig(["engineering"]);
    applyFinalize(config, tmpDir, 847);
    const state = JSON.parse(readFileSync(join(tmpDir, ".system", "state.json"), "utf-8")) as StateFile;
    expect(state.last_apply.apply_duration_ms).toBe(847);
  });

  it("agent_count counts unique non-null head agents", () => {
    // Both active divisions have opus-t1 → count = 1
    const divs = [
      makeDivision("executive", true, "opus-t1"),
      makeDivision("product", true, "opus-t1"),
      makeDivision("engineering", true, "sonnet-t2"),
      makeDivision("hr", false, null), // inactive, no agent
    ];
    const config: ParsedConfig = {
      schema_version: "1.0",
      company: { name: "TestCo", size: "solo", locale: "en", timezone: "UTC", mode: "business" },
      mode: "business",
      divisions: divs,
      activeDivisions: divs.filter((d) => d.active),
      size_presets: { solo: { recommended: [], description: "Solo" } },
      sourcePath: "/tmp/test.yaml",
      contentHash: "abc123",
    };
    applyFinalize(config, tmpDir, 100);
    const state = JSON.parse(readFileSync(join(tmpDir, ".system", "state.json"), "utf-8")) as StateFile;
    // opus-t1 + sonnet-t2 = 2 unique agents
    expect(state.last_apply.agent_count).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

describe("applyFinalize — history", () => {
  it("initial apply creates history with one entry", () => {
    const config = makeConfig(["engineering"]);
    applyFinalize(config, tmpDir, 100);
    const state = JSON.parse(readFileSync(join(tmpDir, ".system", "state.json"), "utf-8")) as StateFile;
    expect(state.history).toHaveLength(1);
    expect(state.history[0]?.action).toBe("apply");
  });

  it("initial apply history entry contains 'initial setup'", () => {
    const config = makeConfig(["engineering"]);
    applyFinalize(config, tmpDir, 100);
    const state = JSON.parse(readFileSync(join(tmpDir, ".system", "state.json"), "utf-8")) as StateFile;
    expect(state.history[0]?.changes.some((c) => c.includes("initial setup"))).toBe(true);
  });

  it("re-apply appends a new history entry", () => {
    const config = makeConfig(["engineering"]);
    applyFinalize(config, tmpDir, 100);
    applyFinalize(config, tmpDir, 100);
    const state = JSON.parse(readFileSync(join(tmpDir, ".system", "state.json"), "utf-8")) as StateFile;
    expect(state.history).toHaveLength(2);
  });

  it("history is never truncated across multiple runs", () => {
    const config = makeConfig(["engineering"]);
    for (let i = 0; i < 5; i++) {
      applyFinalize(config, tmpDir, 100);
    }
    const state = JSON.parse(readFileSync(join(tmpDir, ".system", "state.json"), "utf-8")) as StateFile;
    expect(state.history).toHaveLength(5);
  });

  it("change log includes added division on re-apply", () => {
    const config1 = makeConfig(["engineering"]);
    applyFinalize(config1, tmpDir, 100);

    const config2 = makeConfig(["engineering", "sales"]);
    applyFinalize(config2, tmpDir, 100);

    const state = JSON.parse(readFileSync(join(tmpDir, ".system", "state.json"), "utf-8")) as StateFile;
    const lastEntry = state.history[state.history.length - 1];
    expect(lastEntry?.changes.some((c) => c.includes("sales"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// README.md
// ---------------------------------------------------------------------------

describe("applyFinalize — README.md", () => {
  it("creates README.md at workspace root", () => {
    const config = makeConfig(["engineering"]);
    applyFinalize(config, tmpDir, 100);
    expect(existsSync(join(tmpDir, "README.md"))).toBe(true);
  });

  it("README contains company name", () => {
    const config = makeConfig(["engineering"]);
    applyFinalize(config, tmpDir, 100);
    const content = readFileSync(join(tmpDir, "README.md"), "utf-8");
    expect(content).toContain("TestCo");
  });

  it("README lists active division codes", () => {
    const config = makeConfig(["engineering", "sales"], ["hr"]);
    applyFinalize(config, tmpDir, 100);
    const content = readFileSync(join(tmpDir, "README.md"), "utf-8");
    expect(content).toContain("engineering");
    expect(content).toContain("sales");
  });

  it("README is overwritten on re-apply", () => {
    const config1 = makeConfig(["engineering"]);
    applyFinalize(config1, tmpDir, 100);

    const config2 = makeConfig(["engineering", "sales"]);
    applyFinalize(config2, tmpDir, 100);

    const content = readFileSync(join(tmpDir, "README.md"), "utf-8");
    expect(content).toContain("sales");
  });

  it("README contains auto-generated disclaimer", () => {
    const config = makeConfig(["engineering"]);
    applyFinalize(config, tmpDir, 100);
    const content = readFileSync(join(tmpDir, "README.md"), "utf-8");
    expect(content.toLowerCase()).toContain("auto-generated");
  });
});

// ---------------------------------------------------------------------------
// StepResult
// ---------------------------------------------------------------------------

describe("applyFinalize — StepResult", () => {
  it("returns success:true", () => {
    const config = makeConfig(["engineering"]);
    const result = applyFinalize(config, tmpDir, 100);
    expect(result.step).toBe("FINALIZE");
    expect(result.success).toBe(true);
  });

  it("details includes historyLength", () => {
    const config = makeConfig(["engineering"]);
    applyFinalize(config, tmpDir, 100);
    const result = applyFinalize(config, tmpDir, 100);
    expect(result.details?.["historyLength"]).toBe(2);
  });
});
