/**
 * Tests for src/cli/output.ts
 *
 * Covers:
 * - formatMs: millisecond formatting
 * - formatStepLine: success/failure, step name padding, duration
 * - printApplyResult: all steps + summary line, verbose details
 * - printDryRunPlan: correct line format
 * - printStatus: displays all state fields
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  formatMs,
  formatStepLine,
  printApplyResult,
  printDryRunPlan,
  printStatus,
} from "../../src/cli/output.js";
import type { StepResult, ApplyResult, FilesystemOp, StateFile } from "../../src/types/apply.js";

// ---------------------------------------------------------------------------
// stdout capture helper
// ---------------------------------------------------------------------------

let captured = "";

beforeEach(() => {
  captured = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    captured += String(chunk);
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// formatMs
// ---------------------------------------------------------------------------

describe("formatMs", () => {
  it("formats 0ms correctly", () => {
    expect(formatMs(0)).toBe("0ms");
  });

  it("formats sub-second durations as ms", () => {
    expect(formatMs(42)).toBe("42ms");
    expect(formatMs(500)).toBe("500ms");
    expect(formatMs(999)).toBe("999ms");
  });

  it("formats 1000ms as 1.0s", () => {
    expect(formatMs(1000)).toBe("1.0s");
  });

  it("formats 1500ms as 1.5s", () => {
    expect(formatMs(1500)).toBe("1.5s");
  });

  it("formats 847ms as 847ms", () => {
    expect(formatMs(847)).toBe("847ms");
  });
});

// ---------------------------------------------------------------------------
// formatStepLine
// ---------------------------------------------------------------------------

function makeStep(
  step: StepResult["step"],
  success: boolean,
  summary: string,
  duration_ms = 42,
): StepResult {
  return { step, success, summary, duration_ms };
}

describe("formatStepLine", () => {
  it("uses ✓ for successful steps", () => {
    const line = formatStepLine(makeStep("VALIDATE", true, "12 active"));
    expect(line).toContain("✓");
    expect(line).not.toContain("✗");
  });

  it("uses ✗ for failed steps", () => {
    const line = formatStepLine(makeStep("DATABASE", false, "disk full"));
    expect(line).toContain("✗");
    expect(line).not.toContain("✓");
  });

  it("contains the step name", () => {
    const line = formatStepLine(makeStep("VALIDATE", true, "ok"));
    expect(line).toContain("VALIDATE");
  });

  it("contains the step summary", () => {
    const line = formatStepLine(makeStep("VALIDATE", true, "12 active, 2 inactive"));
    expect(line).toContain("12 active, 2 inactive");
  });

  it("contains the duration in brackets", () => {
    const line = formatStepLine(makeStep("VALIDATE", true, "ok", 250));
    expect(line).toContain("[250ms]");
  });

  it("COST_CENTERS (longest step name) does not break alignment", () => {
    const line = formatStepLine(makeStep("COST_CENTERS", true, "14 budgets"));
    // Should still contain name + summary
    expect(line).toContain("COST_CENTERS");
    expect(line).toContain("14 budgets");
  });

  it("line starts with two spaces", () => {
    const line = formatStepLine(makeStep("VALIDATE", true, "ok"));
    expect(line.startsWith("  ")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// printApplyResult
// ---------------------------------------------------------------------------

function makeResult(
  success: boolean,
  steps: StepResult[],
  duration_ms = 847,
): ApplyResult {
  return {
    success,
    steps,
    // config is not used by printApplyResult
    config: {} as ApplyResult["config"],
    duration_ms,
  };
}

describe("printApplyResult", () => {
  it("prints one line per step", () => {
    const steps = [
      makeStep("VALIDATE", true, "ok"),
      makeStep("FILESYSTEM", true, "dirs created"),
    ];
    printApplyResult(makeResult(true, steps));
    const lines = captured.trimEnd().split("\n");
    // 2 steps + 1 summary line = 3 lines
    expect(lines).toHaveLength(3);
  });

  it("prints 'Applied in Xms.' on success", () => {
    printApplyResult(makeResult(true, [makeStep("VALIDATE", true, "ok")], 500));
    expect(captured).toContain("Applied in 500ms.");
  });

  it("prints 'Failed in Xms.' on failure", () => {
    printApplyResult(makeResult(false, [makeStep("VALIDATE", false, "bad")], 100));
    expect(captured).toContain("Failed in 100ms.");
  });

  it("prints all step summaries", () => {
    const steps = [
      makeStep("VALIDATE", true, "12 active"),
      makeStep("FILESYSTEM", true, "24 dirs"),
      makeStep("DATABASE", true, "6 tables"),
    ];
    printApplyResult(makeResult(true, steps));
    expect(captured).toContain("12 active");
    expect(captured).toContain("24 dirs");
    expect(captured).toContain("6 tables");
  });

  it("verbose=false does not print details", () => {
    const step: StepResult = {
      ...makeStep("VALIDATE", true, "ok"),
      details: { errors: [], warnings: [] },
    };
    printApplyResult(makeResult(true, [step]), false);
    expect(captured).not.toContain('"errors"');
  });

  it("verbose=true prints details below each step", () => {
    const step: StepResult = {
      ...makeStep("VALIDATE", true, "ok"),
      details: { errors: [], warnings: ["w1"] },
    };
    printApplyResult(makeResult(true, [step]), true);
    expect(captured).toContain("errors");
    expect(captured).toContain("warnings");
  });

  it("verbose=true skips details for steps with no details", () => {
    const step = makeStep("VALIDATE", true, "ok"); // no details field
    printApplyResult(makeResult(true, [step]), true);
    // Should not throw and should still print the summary line
    expect(captured).toContain("Applied in");
  });
});

// ---------------------------------------------------------------------------
// printDryRunPlan
// ---------------------------------------------------------------------------

describe("printDryRunPlan", () => {
  it("prints the validation summary line", () => {
    const ops: FilesystemOp[] = [];
    printDryRunPlan("12 active, 2 inactive", ops);
    expect(captured).toContain("12 active, 2 inactive");
  });

  it("prints '[dry-run]' prefix on both lines", () => {
    printDryRunPlan("ok", []);
    expect(captured).toContain("[dry-run]");
  });

  it("counts mkdir ops correctly", () => {
    const ops: FilesystemOp[] = [
      { type: "mkdir", path: "/a", overwrite: false },
      { type: "mkdir", path: "/b", overwrite: false },
    ];
    printDryRunPlan("ok", ops);
    expect(captured).toContain("2 directories");
  });

  it("counts write and copy_template as file ops", () => {
    const ops: FilesystemOp[] = [
      { type: "write", path: "/a.txt", overwrite: true },
      { type: "copy_template", path: "/b.txt", overwrite: false },
    ];
    printDryRunPlan("ok", ops);
    expect(captured).toContain("2 files");
  });

  it("counts skip_existing ops correctly", () => {
    const ops: FilesystemOp[] = [
      { type: "skip_existing", path: "/x", overwrite: false },
      { type: "skip_existing", path: "/y", overwrite: false },
      { type: "skip_existing", path: "/z", overwrite: false },
    ];
    printDryRunPlan("ok", ops);
    expect(captured).toContain("3 would skip");
  });

  it("prints '(dry-run: no changes made)'", () => {
    printDryRunPlan("ok", []);
    expect(captured).toContain("(dry-run: no changes made)");
  });
});

// ---------------------------------------------------------------------------
// printStatus
// ---------------------------------------------------------------------------

function makeStateFile(overrides: Partial<StateFile["last_apply"]> = {}): StateFile {
  return {
    schema_version: "1.0",
    last_apply: {
      timestamp: "2026-02-27T00:00:00.000Z",
      divisions_yaml_hash: "sha256:abc123",
      governance_hash: "sha256:def456",
      mode: "business",
      active_divisions: ["engineering", "sales"],
      inactive_divisions: [],
      db_version: "1.0.0",
      agent_count: 2,
      apply_duration_ms: 847,
      ...overrides,
    },
    history: [
      { timestamp: "2026-02-27T00:00:00.000Z", action: "apply", changes: ["initial setup"] },
    ],
  };
}

describe("printStatus", () => {
  it("displays the last_apply timestamp", () => {
    printStatus(makeStateFile());
    expect(captured).toContain("2026-02-27T00:00:00.000Z");
  });

  it("displays the mode", () => {
    printStatus(makeStateFile({ mode: "personal" }));
    expect(captured).toContain("personal");
  });

  it("displays active divisions", () => {
    printStatus(makeStateFile());
    expect(captured).toContain("engineering");
    expect(captured).toContain("sales");
  });

  it("displays inactive divisions when present", () => {
    printStatus(makeStateFile({ inactive_divisions: ["hr", "legal"] }));
    expect(captured).toContain("hr");
    expect(captured).toContain("legal");
  });

  it("does not print Inactive line when inactive_divisions is empty", () => {
    printStatus(makeStateFile({ inactive_divisions: [] }));
    expect(captured).not.toContain("Inactive:");
  });

  it("displays agent count", () => {
    printStatus(makeStateFile({ agent_count: 3 }));
    expect(captured).toContain("3");
  });

  it("displays duration in ms", () => {
    printStatus(makeStateFile({ apply_duration_ms: 847 }));
    expect(captured).toContain("847ms");
  });

  it("displays history run count", () => {
    const state = makeStateFile();
    state.history.push({ timestamp: "t", action: "apply", changes: [] });
    printStatus(state);
    expect(captured).toContain("2 run(s)");
  });

  it("displays DB version", () => {
    printStatus(makeStateFile({ db_version: "1.0.0" }));
    expect(captured).toContain("1.0.0");
  });
});
