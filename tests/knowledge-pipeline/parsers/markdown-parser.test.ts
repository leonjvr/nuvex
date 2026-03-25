/**
 * Unit tests: MarkdownParser
 */

import { describe, it, expect } from "vitest";
import { MarkdownParser } from "../../../src/knowledge-pipeline/parsers/markdown-parser.js";

describe("MarkdownParser", () => {
  const parser = new MarkdownParser();

  it("parses document with multiple headings into sections with correct heading and level", async () => {
    const content = [
      "# Introduction",
      "This is the intro.",
      "",
      "## Background",
      "Some background text here.",
      "",
      "### Details",
      "Detailed information.",
    ].join("\n");

    const doc = await parser.parse(content, "test.md");

    expect(doc.sections).toHaveLength(3);

    expect(doc.sections[0]!.heading).toBe("Introduction");
    expect(doc.sections[0]!.level).toBe(1);
    expect(doc.sections[0]!.content).toContain("This is the intro.");

    expect(doc.sections[1]!.heading).toBe("Background");
    expect(doc.sections[1]!.level).toBe(2);
    expect(doc.sections[1]!.content).toContain("Some background text here.");

    expect(doc.sections[2]!.heading).toBe("Details");
    expect(doc.sections[2]!.level).toBe(3);
    expect(doc.sections[2]!.content).toContain("Detailed information.");
  });

  it("document without headings returns single section with all content", async () => {
    const content = [
      "This is a plain paragraph.",
      "",
      "Another paragraph without any heading markers.",
    ].join("\n");

    const doc = await parser.parse(content, "plain.md");

    expect(doc.sections).toHaveLength(1);
    expect(doc.sections[0]!.heading).toBeUndefined();
    expect(doc.sections[0]!.level).toBeUndefined();
    expect(doc.sections[0]!.content).toContain("This is a plain paragraph.");
    expect(doc.sections[0]!.content).toContain("Another paragraph without any heading markers.");
  });

  it("page breaks (\\f) increment page_number for content flushed after the break", async () => {
    // The parser increments currentPage when a line containing \f is processed.
    // page_number is captured at flush time. A section whose content lines include a \f
    // is flushed at the incremented page number.
    //
    // Trace:
    //   "# Section One"       → flush (nothing), heading="Section One"
    //   "Content page 1."     → currentLines=["Content page 1."]
    //   "# Section Two"       → flush Section One at currentPage=1 → page_number 1
    //                            heading="Section Two"
    //   "Intro text.\fmore"   → contains \f → currentPage=2; pushed to currentLines
    //   "# Section Three"     → flush Section Two at currentPage=2 → page_number 2
    //                            heading="Section Three"
    //   "Content page 2."     → currentLines=["Content page 2."]
    //   (end)                 → flush Section Three at currentPage=2 → page_number 2
    const content = [
      "# Section One",
      "Content page 1.",
      "# Section Two",
      "Intro text.\fmore text.",
      "# Section Three",
      "Content page 2.",
    ].join("\n");

    const doc = await parser.parse(content, "paged.md");

    const sectionOne = doc.sections.find((s) => s.heading === "Section One");
    expect(sectionOne).toBeDefined();
    expect(sectionOne!.page_number).toBe(1);

    // Section Two body contains a \f → flushed at page 2
    const sectionTwo = doc.sections.find((s) => s.heading === "Section Two");
    expect(sectionTwo).toBeDefined();
    expect(sectionTwo!.page_number).toBe(2);

    // Section Three also on page 2 (page did not advance again)
    const sectionThree = doc.sections.find((s) => s.heading === "Section Three");
    expect(sectionThree).toBeDefined();
    expect(sectionThree!.page_number).toBe(2);
  });

  it("total_tokens is greater than 0 for non-empty document", async () => {
    const content = "# Title\nSome meaningful content here with multiple words.";
    const doc = await parser.parse(content, "tokens.md");

    expect(doc.total_tokens).toBeGreaterThan(0);
  });

  it("source_file is set to the provided filename", async () => {
    const doc = await parser.parse("# Hello\nWorld", "my-file.md");
    expect(doc.source_file).toBe("my-file.md");
  });

  it("empty content returns no sections and zero total_tokens", async () => {
    const doc = await parser.parse("", "empty.md");
    expect(doc.sections).toHaveLength(0);
    expect(doc.total_tokens).toBe(0);
  });

  it("accepts Buffer input and parses correctly", async () => {
    const content = "# Buffered\nContent from a buffer.";
    const doc = await parser.parse(Buffer.from(content, "utf-8"), "buf.md");

    expect(doc.sections).toHaveLength(1);
    expect(doc.sections[0]!.heading).toBe("Buffered");
    expect(doc.sections[0]!.content).toContain("Content from a buffer.");
  });
});
