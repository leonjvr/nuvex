/**
 * Tests for src/core/error-codes.ts — Phase 10.8 Component A
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  ErrorCategory,
  SidjuaError,
  isSidjuaError,
  lookupErrorCode,
  listErrorCodes,
} from "../../src/core/error-codes.js";

// ---------------------------------------------------------------------------
// SidjuaError construction & instanceof checks
// ---------------------------------------------------------------------------

describe("SidjuaError — construction", () => {
  it("extends Error (backward compatible)", () => {
    const err = SidjuaError.from("GOV-001");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(SidjuaError);
  });

  it("has name 'SidjuaError'", () => {
    const err = SidjuaError.from("GOV-001");
    expect(err.name).toBe("SidjuaError");
  });

  it("message contains the registry message", () => {
    const err = SidjuaError.from("GOV-001");
    expect(err.message).toContain("Action forbidden by policy");
  });

  it("appends detail to message when provided", () => {
    const err = SidjuaError.from("TASK-002", "injection detected in header");
    expect(err.message).toContain("Task description blocked");
    expect(err.message).toContain("injection detected in header");
    expect(err.detail).toBe("injection detected in header");
  });

  it("stores context object", () => {
    const err = SidjuaError.from("SYS-001", "write failed", { table: "tasks" });
    expect(err.context).toEqual({ table: "tasks" });
  });

  it("throws for unknown error code", () => {
    expect(() => SidjuaError.from("INVALID-999")).toThrow(/unknown error code/i);
  });
});

// ---------------------------------------------------------------------------
// recoverable flag
// ---------------------------------------------------------------------------

describe("SidjuaError — recoverable flag", () => {
  it("GOV-001 (forbidden by policy) is NOT recoverable", () => {
    expect(SidjuaError.from("GOV-001").recoverable).toBe(false);
  });

  it("GOV-002 (approval required) IS recoverable", () => {
    expect(SidjuaError.from("GOV-002").recoverable).toBe(true);
  });

  it("TASK-002 (blocked injection) is NOT recoverable", () => {
    expect(SidjuaError.from("TASK-002").recoverable).toBe(false);
  });

  it("AGT-003 (agent crashed) IS recoverable", () => {
    expect(SidjuaError.from("AGT-003").recoverable).toBe(true);
  });

  it("PROV-004 (all providers exhausted) is NOT recoverable", () => {
    expect(SidjuaError.from("PROV-004").recoverable).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// suggestion field
// ---------------------------------------------------------------------------

describe("SidjuaError — suggestion field", () => {
  it("recoverable codes have a suggestion", () => {
    const err = SidjuaError.from("GOV-002");
    expect(err.suggestion).toBeDefined();
    expect(err.suggestion!.length).toBeGreaterThan(0);
  });

  it("non-recoverable codes may also have a suggestion", () => {
    const err = SidjuaError.from("GOV-001");
    expect(err.suggestion).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// category
// ---------------------------------------------------------------------------

describe("SidjuaError — category", () => {
  it("GOV-xxx codes have GOVERNANCE category", () => {
    expect(SidjuaError.from("GOV-003").category).toBe(ErrorCategory.GOVERNANCE);
  });

  it("TASK-xxx codes have TASK category", () => {
    expect(SidjuaError.from("TASK-001").category).toBe(ErrorCategory.TASK);
  });

  it("TOOL-xxx codes have TOOL category", () => {
    expect(SidjuaError.from("TOOL-005").category).toBe(ErrorCategory.TOOL);
  });

  it("INPUT-xxx codes have INPUT category", () => {
    expect(SidjuaError.from("INPUT-001").category).toBe(ErrorCategory.INPUT);
  });
});

// ---------------------------------------------------------------------------
// JSON serialization
// ---------------------------------------------------------------------------

describe("SidjuaError — toJSON", () => {
  it("serializes to plain object with required fields", () => {
    const json = SidjuaError.from("GOV-001").toJSON();
    expect(json["code"]).toBe("GOV-001");
    expect(json["category"]).toBe("GOV");
    expect(json["message"]).toBeDefined();
    expect(json["recoverable"]).toBe(false);
  });

  it("JSON.stringify round-trips without throwing", () => {
    const err = SidjuaError.from("TASK-002", "detail here", { field: "description" });
    const str = JSON.stringify(err);
    const parsed = JSON.parse(str) as Record<string, unknown>;
    expect(parsed["code"]).toBe("TASK-002");
    expect(parsed["detail"]).toBe("detail here");
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

describe("isSidjuaError / lookupErrorCode / listErrorCodes", () => {
  it("isSidjuaError returns true for SidjuaError", () => {
    expect(isSidjuaError(SidjuaError.from("SYS-001"))).toBe(true);
  });

  it("isSidjuaError returns false for plain Error", () => {
    expect(isSidjuaError(new Error("plain"))).toBe(false);
  });

  it("lookupErrorCode finds a known code", () => {
    const entry = lookupErrorCode("GOV-008");
    expect(entry).toBeDefined();
    expect(entry!.recoverable).toBe(true);
  });

  it("lookupErrorCode returns undefined for unknown code", () => {
    expect(lookupErrorCode("FAKE-999")).toBeUndefined();
  });

  it("listErrorCodes returns all codes including INPUT-003", () => {
    const codes = listErrorCodes().map((e) => e.code);
    expect(codes).toContain("GOV-001");
    expect(codes).toContain("INPUT-003");
    expect(codes).toContain("SYS-004");
    // Should have at least 31 codes from spec
    expect(codes.length).toBeGreaterThanOrEqual(31);
  });

  it("listErrorCodes includes SYS-009 (security violation)", () => {
    const codes = listErrorCodes().map((e) => e.code);
    expect(codes).toContain("SYS-009");
  });
});

// ---------------------------------------------------------------------------
// D7: toJSON() context stripping — SIDJUA_DEBUG gate
// ---------------------------------------------------------------------------

describe("SidjuaError — toJSON context stripping", () => {
  const originalDebug = process.env["SIDJUA_DEBUG"];

  afterEach(() => {
    if (originalDebug === undefined) {
      delete process.env["SIDJUA_DEBUG"];
    } else {
      process.env["SIDJUA_DEBUG"] = originalDebug;
    }
  });

  it("omits context from toJSON() when SIDJUA_DEBUG is unset", () => {
    delete process.env["SIDJUA_DEBUG"];
    const err  = SidjuaError.from("SYS-001", "disk full", { table: "tasks" });
    const json = err.toJSON();
    expect(json["context"]).toBeUndefined();
  });

  it("omits context from toJSON() when SIDJUA_DEBUG=0", () => {
    process.env["SIDJUA_DEBUG"] = "0";
    const err  = SidjuaError.from("SYS-001", "disk full", { table: "tasks" });
    const json = err.toJSON();
    expect(json["context"]).toBeUndefined();
  });

  it("includes context in toJSON() when SIDJUA_DEBUG=1", () => {
    process.env["SIDJUA_DEBUG"] = "1";
    const err  = SidjuaError.from("SYS-001", "disk full", { table: "tasks" });
    const json = err.toJSON();
    expect(json["context"]).toEqual({ table: "tasks" });
  });

  it("context is always accessible on the error object itself (not gated)", () => {
    delete process.env["SIDJUA_DEBUG"];
    const err = SidjuaError.from("GOV-001", undefined, { agentId: "agent-7" });
    // The property is accessible programmatically (internal use)
    expect(err.context).toEqual({ agentId: "agent-7" });
  });
});
