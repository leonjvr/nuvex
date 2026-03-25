/**
 * Tests for src/cli/formatters/json.ts
 */

import { describe, it, expect } from "vitest";
import { formatJson } from "../../../src/cli/formatters/json.js";

describe("formatJson", () => {
  it("produces valid JSON", () => {
    const out = formatJson({ key: "value", n: 42 });
    expect(() => JSON.parse(out)).not.toThrow();
  });

  it("uses 2-space indent", () => {
    const out = formatJson({ a: 1 });
    expect(out).toBe('{\n  "a": 1\n}');
  });

  it("handles arrays", () => {
    const out = formatJson([1, 2, 3]);
    const parsed = JSON.parse(out);
    expect(parsed).toEqual([1, 2, 3]);
  });

  it("handles null", () => {
    expect(formatJson(null)).toBe("null");
  });

  it("handles nested objects", () => {
    const data = { tasks: [{ id: "t1", status: "DONE" }] };
    const out  = formatJson(data);
    const parsed = JSON.parse(out);
    expect(parsed.tasks[0].id).toBe("t1");
  });

  it("handles strings", () => {
    expect(formatJson("hello")).toBe('"hello"');
  });

  it("handles numbers", () => {
    expect(formatJson(42)).toBe("42");
  });
});
