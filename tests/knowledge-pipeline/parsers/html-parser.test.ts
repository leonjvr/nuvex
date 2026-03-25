/**
 * Unit tests: HtmlParser
 * Note: HtmlParser is async (uses dynamic import of cheerio).
 */

import { describe, it, expect } from "vitest";
import { HtmlParser } from "../../../src/knowledge-pipeline/parsers/html-parser.js";

describe("HtmlParser", () => {
  const parser = new HtmlParser();

  it("strips script and style tags and preserves paragraph text", async () => {
    const html = `
      <html>
        <head>
          <style>body { color: red; }</style>
        </head>
        <body>
          <script>alert("xss");</script>
          <p>Visible paragraph content.</p>
        </body>
      </html>
    `;

    const doc = await parser.parse(html, "test.html");

    const allContent = doc.sections.map((s) => s.content).join(" ");
    expect(allContent).not.toContain("alert");
    expect(allContent).not.toContain("color: red");
    expect(allContent).toContain("Visible paragraph content.");
  });

  it("heading tags (h1-h6) create new sections with correct heading text and level", async () => {
    const html = `
      <html><body>
        <h1>Main Title</h1>
        <p>Intro paragraph.</p>
        <h2>Subsection</h2>
        <p>Subsection content.</p>
        <h3>Sub-subsection</h3>
        <p>Deeper content.</p>
      </body></html>
    `;

    const doc = await parser.parse(html, "headings.html");

    expect(doc.sections.length).toBeGreaterThanOrEqual(2);

    const h1Section = doc.sections.find((s) => s.heading === "Main Title");
    expect(h1Section).toBeDefined();
    expect(h1Section!.level).toBe(1);

    const h2Section = doc.sections.find((s) => s.heading === "Subsection");
    expect(h2Section).toBeDefined();
    expect(h2Section!.level).toBe(2);

    const h3Section = doc.sections.find((s) => s.heading === "Sub-subsection");
    expect(h3Section).toBeDefined();
    expect(h3Section!.level).toBe(3);
  });

  it("falls back to body text when no structured elements are found", async () => {
    const html = `<html><body>Just some plain body text with no block elements.</body></html>`;

    const doc = await parser.parse(html, "plain.html");

    expect(doc.sections.length).toBeGreaterThanOrEqual(1);
    const allContent = doc.sections.map((s) => s.content).join(" ");
    expect(allContent).toContain("plain body text");
  });

  it("total_tokens is greater than 0 for non-empty HTML", async () => {
    const html = `<html><body><p>This document has some content words.</p></body></html>`;
    const doc = await parser.parse(html, "tokens.html");

    expect(doc.total_tokens).toBeGreaterThan(0);
  });

  it("source_file is set to the provided filename", async () => {
    const html = `<html><body><p>Hello.</p></body></html>`;
    const doc = await parser.parse(html, "my-page.html");

    expect(doc.source_file).toBe("my-page.html");
  });

  it("section content includes paragraph text under its heading", async () => {
    const html = `
      <html><body>
        <h2>Getting Started</h2>
        <p>Follow these steps to get started quickly.</p>
      </body></html>
    `;

    const doc = await parser.parse(html, "guide.html");

    const section = doc.sections.find((s) => s.heading === "Getting Started");
    expect(section).toBeDefined();
    expect(section!.content).toContain("Follow these steps");
  });

  it("accepts Buffer input", async () => {
    const html = `<html><body><h1>Buffered</h1><p>Buffer content.</p></body></html>`;
    const doc = await parser.parse(Buffer.from(html, "utf-8"), "buf.html");

    expect(doc.sections.length).toBeGreaterThanOrEqual(1);
    const heading = doc.sections.find((s) => s.heading === "Buffered");
    expect(heading).toBeDefined();
  });
});
