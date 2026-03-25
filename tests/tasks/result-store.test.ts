/**
 * Tests for src/tasks/result-store.ts
 *
 * Covers:
 * - Write creates directory + file
 * - Write produces valid YAML frontmatter + Markdown body
 * - Read parses frontmatter correctly
 * - Read returns full content
 * - ReadFrontmatter returns only frontmatter
 * - ListResults returns all task IDs with results
 * - DeleteResult removes file and directory
 * - Non-existent result returns null
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ResultStore } from "../../src/tasks/result-store.js";
import type { ResultFrontmatter } from "../../src/tasks/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFrontmatter(overrides: Partial<ResultFrontmatter> = {}): ResultFrontmatter {
  return {
    task_id:       "task-abc",
    parent_task:   "task-parent",
    root_task:     "task-root",
    agent:         "sonnet-devlead",
    division:      "engineering",
    tier:          2,
    type:          "delegation",
    confidence:    0.87,
    status:        "complete",
    tokens_used:   4200,
    cost_usd:      0.012,
    timestamp:     "2026-02-28T00:00:00.000Z",
    classification: "internal",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let tmpDir: string;
let resultStore: ResultStore;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "sidjua-result-store-test-"));
  resultStore = new ResultStore(tmpDir);
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// writeResult
// ---------------------------------------------------------------------------

describe("ResultStore.writeResult", () => {
  it("creates directory and result.md file", async () => {
    await resultStore.writeResult("task-abc", "engineering", makeFrontmatter(), "# Result");

    const expectedPath = join(tmpDir, "divisions", "engineering", "results", "task-abc", "result.md");
    expect(existsSync(expectedPath)).toBe(true);
  });

  it("returns the file path", async () => {
    const path = await resultStore.writeResult("task-abc", "engineering", makeFrontmatter(), "# Result");
    expect(path).toContain("task-abc");
    expect(path).toContain("result.md");
  });

  it("produces file with YAML frontmatter delimiters", async () => {
    await resultStore.writeResult("task-abc", "engineering", makeFrontmatter(), "# Result");
    const result = await resultStore.readResult("task-abc", "engineering");
    expect(result).not.toBeNull();
  });

  it("is idempotent (overwrite existing result)", async () => {
    await resultStore.writeResult("task-abc", "engineering", makeFrontmatter(), "v1");
    await resultStore.writeResult("task-abc", "engineering", makeFrontmatter(), "v2");
    const result = await resultStore.readResult("task-abc", "engineering");
    expect(result?.content).toContain("v2");
  });
});

// ---------------------------------------------------------------------------
// readResult
// ---------------------------------------------------------------------------

describe("ResultStore.readResult", () => {
  it("returns null for non-existent task", async () => {
    const result = await resultStore.readResult("ghost", "engineering");
    expect(result).toBeNull();
  });

  it("parses frontmatter correctly", async () => {
    const fm = makeFrontmatter({ confidence: 0.95, tokens_used: 1000 });
    await resultStore.writeResult("task-abc", "engineering", fm, "body");

    const result = await resultStore.readResult("task-abc", "engineering");
    expect(result).not.toBeNull();
    expect(result?.frontmatter.task_id).toBe("task-abc");
    expect(result?.frontmatter.confidence).toBe(0.95);
    expect(result?.frontmatter.tokens_used).toBe(1000);
    expect(result?.frontmatter.division).toBe("engineering");
  });

  it("returns Markdown body content", async () => {
    const body = "## Analysis\n\nThis is the full result.\n\nWith multiple paragraphs.";
    await resultStore.writeResult("task-abc", "engineering", makeFrontmatter(), body);

    const result = await resultStore.readResult("task-abc", "engineering");
    expect(result?.content).toContain("Analysis");
    expect(result?.content).toContain("multiple paragraphs");
  });

  it("handles body that contains ---  (not frontmatter delimiter)", async () => {
    const body = "## Section 1\nText\n\n## Section 2\nMore text";
    await resultStore.writeResult("task-abc", "engineering", makeFrontmatter(), body);

    const result = await resultStore.readResult("task-abc", "engineering");
    expect(result?.content).toContain("Section 1");
    expect(result?.content).toContain("Section 2");
  });

  it("preserves null parent_task in frontmatter", async () => {
    const fm = makeFrontmatter({ parent_task: null });
    await resultStore.writeResult("task-abc", "engineering", fm, "body");

    const result = await resultStore.readResult("task-abc", "engineering");
    expect(result?.frontmatter.parent_task).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// readFrontmatter
// ---------------------------------------------------------------------------

describe("ResultStore.readFrontmatter", () => {
  it("returns only frontmatter", async () => {
    await resultStore.writeResult("task-abc", "engineering", makeFrontmatter(), "body");
    const fm = await resultStore.readFrontmatter("task-abc", "engineering");
    expect(fm?.task_id).toBe("task-abc");
  });

  it("returns null for non-existent task", async () => {
    expect(await resultStore.readFrontmatter("ghost", "engineering")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// listResults
// ---------------------------------------------------------------------------

describe("ResultStore.listResults", () => {
  it("returns empty array when no results", async () => {
    const ids = await resultStore.listResults("engineering");
    expect(ids).toHaveLength(0);
  });

  it("returns task IDs for all result files", async () => {
    await resultStore.writeResult("task-001", "engineering", makeFrontmatter({ task_id: "task-001" }), "body");
    await resultStore.writeResult("task-002", "engineering", makeFrontmatter({ task_id: "task-002" }), "body");

    const ids = await resultStore.listResults("engineering");
    expect(ids).toContain("task-001");
    expect(ids).toContain("task-002");
    expect(ids).toHaveLength(2);
  });

  it("does not include results from other divisions", async () => {
    await resultStore.writeResult("task-001", "engineering", makeFrontmatter(), "body");
    await resultStore.writeResult("task-002", "sales",       makeFrontmatter(), "body");

    const engIds = await resultStore.listResults("engineering");
    expect(engIds).toContain("task-001");
    expect(engIds).not.toContain("task-002");
  });
});

// ---------------------------------------------------------------------------
// deleteResult
// ---------------------------------------------------------------------------

describe("ResultStore.deleteResult", () => {
  it("removes result file and directory", async () => {
    await resultStore.writeResult("task-abc", "engineering", makeFrontmatter(), "body");

    const dir = join(tmpDir, "divisions", "engineering", "results", "task-abc");
    expect(existsSync(dir)).toBe(true);

    await resultStore.deleteResult("task-abc", "engineering");
    expect(existsSync(dir)).toBe(false);
  });

  it("is safe to call on non-existent result", async () => {
    await expect(
      resultStore.deleteResult("ghost", "engineering"),
    ).resolves.toBeUndefined();
  });

  it("removed result no longer appears in listResults", async () => {
    await resultStore.writeResult("task-abc", "engineering", makeFrontmatter(), "body");
    await resultStore.deleteResult("task-abc", "engineering");

    const ids = await resultStore.listResults("engineering");
    expect(ids).not.toContain("task-abc");
  });
});
