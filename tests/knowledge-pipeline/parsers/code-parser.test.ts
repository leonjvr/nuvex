/**
 * Unit tests: CodeParser
 */

import { describe, it, expect } from "vitest";
import { CodeParser } from "../../../src/knowledge-pipeline/parsers/code-parser.js";

describe("CodeParser", () => {
  const parser = new CodeParser();

  it("detects function boundaries and creates separate sections per function", async () => {
    const code = [
      "// preamble comment",
      "",
      "function greet(name: string): string {",
      "  return `Hello, ${name}!`;",
      "}",
      "",
      "function farewell(name: string): string {",
      "  return `Goodbye, ${name}!`;",
      "}",
    ].join("\n");

    const doc = await parser.parse(code, "greetings.ts");

    // Each function declaration should start a new section
    expect(doc.sections.length).toBeGreaterThanOrEqual(2);

    const allHeadings = doc.sections.map((s) => s.heading ?? "");
    const hasGreet = allHeadings.some((h) => h.includes("greet"));
    const hasFarewell = allHeadings.some((h) => h.includes("farewell"));
    expect(hasGreet).toBe(true);
    expect(hasFarewell).toBe(true);
  });

  it("creates sections with first meaningful line as heading", async () => {
    const code = [
      "export class MyService {",
      "  constructor() {}",
      "  doWork() { return 42; }",
      "}",
    ].join("\n");

    const doc = await parser.parse(code, "service.ts");

    expect(doc.sections.length).toBeGreaterThan(0);
    const firstSection = doc.sections[0]!;
    expect(firstSection.heading).toBeDefined();
    expect(firstSection.heading!.length).toBeGreaterThan(0);
    // Heading should be truncated to 80 chars max
    expect(firstSection.heading!.length).toBeLessThanOrEqual(80);
  });

  it("returns content for a simple file with no boundary patterns", async () => {
    const code = "const x = 1;\nconst y = 2;\nconst z = x + y;";

    const doc = await parser.parse(code, "simple.ts");

    expect(doc.sections.length).toBeGreaterThan(0);
    const allContent = doc.sections.map((s) => s.content).join("\n");
    expect(allContent).toContain("const x = 1");
  });

  it("includes language in document metadata from file extension", async () => {
    const code = "function hello() { return 'hi'; }";
    const doc = await parser.parse(code, "hello.ts");

    expect(doc.metadata).toBeDefined();
    expect(doc.metadata!["language"]).toBe("ts");
  });

  it("section metadata includes line_start and line_end", async () => {
    const code = [
      "function alpha() {",
      "  return 1;",
      "}",
      "function beta() {",
      "  return 2;",
      "}",
    ].join("\n");

    const doc = await parser.parse(code, "lines.ts");

    expect(doc.sections.length).toBeGreaterThan(0);
    const firstSection = doc.sections[0]!;
    expect(firstSection.metadata).toBeDefined();
    expect(firstSection.metadata!["line_start"]).toBeDefined();
    expect(firstSection.metadata!["line_end"]).toBeDefined();
    expect(typeof firstSection.metadata!["line_start"]).toBe("number");
    expect(typeof firstSection.metadata!["line_end"]).toBe("number");
  });

  it("total_tokens is greater than 0 for non-empty code file", async () => {
    const code = "export function add(a: number, b: number): number { return a + b; }";
    const doc = await parser.parse(code, "math.ts");

    expect(doc.total_tokens).toBeGreaterThan(0);
  });

  it("source_file is set to the provided filename", async () => {
    const code = "const PI = 3.14;";
    const doc = await parser.parse(code, "constants.js");

    expect(doc.source_file).toBe("constants.js");
  });

  it("detects class boundaries as section start", async () => {
    const code = [
      "// Header comment",
      "",
      "class Animal {",
      "  name: string;",
      "  constructor(name: string) { this.name = name; }",
      "}",
      "",
      "class Dog extends Animal {",
      "  bark() { return 'woof'; }",
      "}",
    ].join("\n");

    const doc = await parser.parse(code, "animals.ts");

    expect(doc.sections.length).toBeGreaterThanOrEqual(2);
    const allHeadings = doc.sections.map((s) => s.heading ?? "");
    const hasAnimal = allHeadings.some((h) => h.includes("Animal"));
    const hasDog = allHeadings.some((h) => h.includes("Dog"));
    expect(hasAnimal).toBe(true);
    expect(hasDog).toBe(true);
  });
});
