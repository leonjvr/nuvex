/**
 * Unit tests: ToolValidator
 */

import { describe, it, expect } from "vitest";
import { ToolValidator, ToolValidationError } from "../../src/tool-integration/tool-validator.js";
import type { CreateToolInput, ToolType } from "../../src/tool-integration/types.js";

describe("ToolValidator", () => {
  const validator = new ToolValidator();

  it("validates a valid shell tool config without throwing", () => {
    const input: CreateToolInput = {
      id: "my-shell",
      name: "My Shell",
      type: "shell",
      config: { type: "shell" },
    };

    expect(() => validator.validate(input)).not.toThrow();
  });

  it("throws ToolValidationError for invalid type", () => {
    const input: CreateToolInput = {
      id: "x",
      name: "X",
      type: "invalid" as ToolType,
      config: { type: "invalid" as unknown as "shell" },
    };

    let caughtError: unknown;
    try {
      validator.validate(input);
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(ToolValidationError);
    const validationError = caughtError as ToolValidationError;
    expect(validationError.field).toContain("type");
  });

  it("throws ToolValidationError for missing required field (rest missing base_url)", () => {
    const input: CreateToolInput = {
      id: "x",
      name: "X",
      type: "rest",
      config: { type: "rest", base_url: "" },
    };

    let caughtError: unknown;
    try {
      validator.validate(input);
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(ToolValidationError);
    const validationError = caughtError as ToolValidationError;
    expect(validationError.field).toContain("base_url");
  });
});
