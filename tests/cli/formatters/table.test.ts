/**
 * Tests for src/cli/formatters/table.ts
 */

import { describe, it, expect } from "vitest";
import { formatTable } from "../../../src/cli/formatters/table.js";
import type { TableConfig } from "../../../src/cli/formatters/table.js";

const SIMPLE_CONFIG: TableConfig = {
  columns: [
    { header: "ID",     key: "id"     },
    { header: "STATUS", key: "status" },
    { header: "TITLE",  key: "title"  },
  ],
  maxWidth: 200,
};

describe("formatTable — basic output", () => {
  it("returns empty string for empty rows", () => {
    expect(formatTable([], SIMPLE_CONFIG)).toBe("");
  });

  it("produces header and separator and data rows", () => {
    const rows = [
      { id: "task-1", status: "RUNNING", title: "Do work" },
    ];
    const out = formatTable(rows, SIMPLE_CONFIG);
    const lines = out.split("\n");

    expect(lines).toHaveLength(3); // header, separator, 1 data row
    expect(lines[0]).toContain("ID");
    expect(lines[0]).toContain("STATUS");
    expect(lines[0]).toContain("TITLE");
    expect(lines[1]).toContain("─");
    expect(lines[2]).toContain("task-1");
    expect(lines[2]).toContain("RUNNING");
    expect(lines[2]).toContain("Do work");
  });

  it("produces correct number of data rows for multiple entries", () => {
    const rows = [
      { id: "1", status: "DONE",    title: "A" },
      { id: "2", status: "RUNNING", title: "B" },
      { id: "3", status: "QUEUED",  title: "C" },
    ];
    const lines = formatTable(rows, SIMPLE_CONFIG).split("\n");
    expect(lines).toHaveLength(5); // header + sep + 3 rows
  });
});

describe("formatTable — column alignment", () => {
  it("right-aligns numeric columns", () => {
    const config: TableConfig = {
      columns: [
        { header: "COST",   key: "cost",   align: "right" },
        { header: "TOKENS", key: "tokens", align: "right" },
      ],
      maxWidth: 200,
    };
    const rows = [
      { cost: "$4.23", tokens: "892,100" },
      { cost: "$0.12", tokens: "12,000"  },
    ];
    const out = formatTable(rows, config);
    const lines = out.split("\n");
    // Both rows should contain their respective values
    expect(lines[2]).toContain("$4.23");
    expect(lines[3]).toContain("$0.12");
  });

  it("auto-calculates column width from data", () => {
    const config: TableConfig = {
      columns: [
        { header: "X", key: "x" },
      ],
      maxWidth: 200,
    };
    const rows = [{ x: "very-long-value-here" }];
    const out = formatTable(rows, config);
    expect(out).toContain("very-long-value-here");
  });

  it("respects fixed column width", () => {
    const config: TableConfig = {
      columns: [
        { header: "TITLE", key: "title", width: 10 },
      ],
      maxWidth: 200,
    };
    const rows = [{ title: "short" }];
    const lines = formatTable(rows, config).split("\n");
    // Header column padded to 10
    expect(lines[0]!.startsWith("TITLE     ")).toBe(true);
  });

  it("truncates long cell values with ellipsis when fixed width set", () => {
    const config: TableConfig = {
      columns: [
        { header: "T", key: "t", width: 8 },
      ],
      maxWidth: 200,
    };
    const rows = [{ t: "abcdefghij" }]; // 10 chars, width 8 → 7 + …
    const lines = formatTable(rows, config).split("\n");
    expect(lines[2]!.trimEnd()).toHaveLength(8);
    expect(lines[2]!.trimEnd().endsWith("…")).toBe(true);
  });
});

describe("formatTable — custom formatters", () => {
  it("applies custom format function to cells", () => {
    const config: TableConfig = {
      columns: [
        {
          header: "COST",
          key:    "cost_usd",
          format: (v) => `$${(v as number).toFixed(2)}`,
        },
      ],
      maxWidth: 200,
    };
    const rows = [{ cost_usd: 4.234 }];
    const out = formatTable(rows, config);
    expect(out).toContain("$4.23");
  });

  it("renders null values as empty string by default", () => {
    const rows = [{ id: "x", status: null, title: undefined }];
    const out = formatTable(rows, SIMPLE_CONFIG);
    expect(out).toContain("x");
    // null/undefined → "" (no crash)
  });
});

describe("formatTable — maxWidth", () => {
  it("trims each line to maxWidth", () => {
    const config: TableConfig = {
      columns: [
        { header: "A", key: "a" },
        { header: "B", key: "b" },
        { header: "C", key: "c" },
      ],
      maxWidth: 10,
    };
    const rows = [{ a: "aaa", b: "bbb", c: "ccc" }];
    const lines = formatTable(rows, config).split("\n");
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(10);
    }
  });
});
