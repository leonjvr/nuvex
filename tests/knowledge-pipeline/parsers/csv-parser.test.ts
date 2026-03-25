/**
 * Unit tests: CsvParser
 */

import { describe, it, expect } from "vitest";
import { CsvParser } from "../../../src/knowledge-pipeline/parsers/csv-parser.js";

describe("CsvParser", () => {
  const parser = new CsvParser();

  it("parses simple CSV into sections with content", async () => {
    const csv = [
      "name,age,city",
      "Alice,30,New York",
      "Bob,25,London",
    ].join("\n");

    const doc = await parser.parse(csv, "people.csv");

    expect(doc.sections.length).toBeGreaterThan(0);
    const allContent = doc.sections.map((s) => s.content).join("\n");
    expect(allContent).toContain("Alice");
    expect(allContent).toContain("Bob");
  });

  it("handles CSV with headers and includes header names in content", async () => {
    const csv = [
      "product,price,quantity",
      "Widget,9.99,100",
      "Gadget,24.99,50",
    ].join("\n");

    const doc = await parser.parse(csv, "inventory.csv");

    expect(doc.sections.length).toBeGreaterThan(0);
    // The parser formats content as "header: value | header: value"
    const allContent = doc.sections.map((s) => s.content).join("\n");
    expect(allContent).toContain("product");
    expect(allContent).toContain("Widget");
    expect(allContent).toContain("price");
    expect(allContent).toContain("9.99");
  });

  it("returns sections with heading indicating row range", async () => {
    const csv = [
      "id,value",
      "1,alpha",
      "2,beta",
      "3,gamma",
    ].join("\n");

    const doc = await parser.parse(csv, "data.csv");

    expect(doc.sections.length).toBeGreaterThan(0);
    // Each section should have a heading like "Rows 1–3"
    const headings = doc.sections.map((s) => s.heading ?? "");
    expect(headings.some((h) => h.startsWith("Rows"))).toBe(true);
  });

  it("empty CSV returns no sections and zero total_tokens", async () => {
    const doc = await parser.parse("", "empty.csv");

    expect(doc.sections).toHaveLength(0);
    expect(doc.total_tokens).toBe(0);
  });

  it("CSV with only headers (no data rows) returns no sections", async () => {
    const csv = "name,age,city";
    const doc = await parser.parse(csv, "headers-only.csv");

    // No data rows — no sections should be emitted
    expect(doc.sections).toHaveLength(0);
  });

  it("source_file is set to the provided filename", async () => {
    const csv = "a,b\n1,2";
    const doc = await parser.parse(csv, "my-data.csv");

    expect(doc.source_file).toBe("my-data.csv");
  });

  it("large CSV with more than 20 rows produces multiple sections", async () => {
    const headerRow = "id,value";
    const dataRows = Array.from({ length: 25 }, (_, i) => `${i + 1},item-${i + 1}`);
    const csv = [headerRow, ...dataRows].join("\n");

    const doc = await parser.parse(csv, "large.csv");

    // 25 data rows at 20 per chunk = 2 sections
    expect(doc.sections.length).toBeGreaterThan(1);
  });

  it("section metadata includes row_start and row_end", async () => {
    const csv = [
      "col1,col2",
      "a,b",
      "c,d",
    ].join("\n");

    const doc = await parser.parse(csv, "meta.csv");

    expect(doc.sections.length).toBeGreaterThan(0);
    const section = doc.sections[0]!;
    expect(section.metadata).toBeDefined();
    expect(section.metadata!["row_start"]).toBe(1);
    expect(section.metadata!["row_end"]).toBe(2);
  });
});
