// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

import { describe, it, expect } from "vitest";
import {
  redactPii,
  extractStackPattern,
  generateFingerprint,
  classifySeverity,
} from "../../../src/core/telemetry/pii-redactor.js";

// ---------------------------------------------------------------------------
// redactPii
// ---------------------------------------------------------------------------

describe("redactPii", () => {
  it("strips sk- API keys", () => {
    expect(redactPii("key is sk-abc123XYZ456")).toContain("<api-key>");
    expect(redactPii("key is sk-abc123XYZ456")).not.toContain("sk-abc123");
  });

  it("strips Bearer tokens", () => {
    const result = redactPii("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload");
    expect(result).toContain("Bearer <redacted>");
    expect(result).not.toContain("eyJhbGci");
  });

  it("strips keyword-preceded long tokens", () => {
    const result = redactPii("apikey=ABCDEFGHIJKLMNOPQRSTU12345");
    expect(result).toContain("<redacted>");
    expect(result).not.toContain("ABCDEFGHIJKLMNOPQRSTU");
  });

  it("strips key= patterns", () => {
    const result = redactPii("token: mysupersecrettoken12345678");
    expect(result).toContain("<redacted>");
  });

  it("replaces Unix file paths with <path>", () => {
    const result = redactPii("Error loading /home/alice/project/config.yaml");
    expect(result).toContain("<path>");
    expect(result).not.toContain("/home/alice");
  });

  it("replaces /Users/ file paths with <path>", () => {
    const result = redactPii("File not found: /Users/bob/documents/secret.txt");
    expect(result).toContain("<path>");
    expect(result).not.toContain("/Users/bob");
  });

  it("replaces Windows file paths with <path>", () => {
    const result = redactPii("Error reading C:\\Users\\alice\\data.json");
    expect(result).toContain("<path>");
    expect(result).not.toContain("C:\\Users");
  });

  it("replaces IPv4 addresses with <ip>", () => {
    const result = redactPii("Connection to 192.168.1.100 failed");
    expect(result).toContain("<ip>");
    expect(result).not.toContain("192.168.1.100");
  });

  it("replaces IPv6 addresses with <ip>", () => {
    const result = redactPii("Connecting to 2001:db8:85a3:0000:0000:8a2e:0370:7334");
    expect(result).toContain("<ip>");
    expect(result).not.toContain("2001:db8");
  });

  it("replaces email addresses with <email>", () => {
    const result = redactPii("Sent to user@example.com for confirmation");
    expect(result).toContain("<email>");
    expect(result).not.toContain("user@example.com");
  });

  it("replaces URLs with auth credentials with <url-redacted>", () => {
    const result = redactPii("Connecting to https://admin:pass123@db.example.com/data");
    expect(result).toContain("<url-redacted>");
    expect(result).not.toContain("admin:pass123");
  });

  it("leaves clean strings unchanged", () => {
    const clean = "TypeError: Cannot read property 'length' of undefined";
    expect(redactPii(clean)).toBe(clean);
  });

  it("is idempotent: redactPii(redactPii(x)) === redactPii(x)", () => {
    const dirty =
      "sk-abc123 at /home/user/app.ts user@test.com 192.168.0.1";
    const once  = redactPii(dirty);
    const twice = redactPii(once);
    expect(twice).toBe(once);
  });

  it("handles real-world mixed PII error message", () => {
    const msg =
      "Failed to connect to https://admin:s3cr3t@db.internal.example.com:5432 " +
      "from 10.0.0.1 — token: sk-proj-ABCDEFGHIJ1234567890 — " +
      "config at /home/ci/workspace/.env — notified user@corp.com";
    const result = redactPii(msg);
    expect(result).not.toContain("s3cr3t");
    expect(result).not.toContain("sk-proj-ABCDEFGHIJ");
    expect(result).not.toContain("/home/ci");
    expect(result).not.toContain("user@corp.com");
    expect(result).not.toContain("10.0.0.1");
  });

  it("handles empty string", () => {
    expect(redactPii("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// extractStackPattern
// ---------------------------------------------------------------------------

describe("extractStackPattern", () => {
  const stackA = `TypeError: Cannot read properties of null
    at Object.getByRoot (/home/alice/sidjua/src/tasks/store.ts:142:12)
    at TelemetryReporter.report (/home/alice/sidjua/src/core/telemetry/reporter.ts:88:5)`;

  const stackB = `TypeError: Cannot read properties of null
    at Object.getByRoot (/home/bob/workspace/sidjua/src/tasks/store.ts:199:7)
    at TelemetryReporter.report (/home/bob/workspace/sidjua/src/core/telemetry/reporter.ts:99:3)`;

  it("normalises paths and line numbers to stable placeholders", () => {
    const patA = extractStackPattern(stackA);
    const patB = extractStackPattern(stackB);
    expect(patA).toBe(patB);
  });

  it("keeps error type and function names", () => {
    const pattern = extractStackPattern(stackA);
    expect(pattern).toContain("TypeError");
    expect(pattern).toContain("getByRoot");
    expect(pattern).toContain("TelemetryReporter.report");
  });

  it("removes file paths", () => {
    const pattern = extractStackPattern(stackA);
    expect(pattern).not.toContain("/home/alice");
    expect(pattern).not.toContain("store.ts");
  });
});

// ---------------------------------------------------------------------------
// generateFingerprint
// ---------------------------------------------------------------------------

describe("generateFingerprint", () => {
  const stackA = `TypeError: null
    at Object.getByRoot (/home/alice/src/tasks/store.ts:142:12)`;
  const stackB = `TypeError: null
    at Object.getByRoot (/home/bob/src/tasks/store.ts:999:3)`;

  it("produces same fingerprint for same error from different paths", () => {
    const fpA = generateFingerprint("TypeError", stackA);
    const fpB = generateFingerprint("TypeError", stackB);
    expect(fpA).toBe(fpB);
  });

  it("produces different fingerprints for different error types", () => {
    const fpA = generateFingerprint("TypeError", stackA);
    const fpB = generateFingerprint("RangeError", stackA);
    expect(fpA).not.toBe(fpB);
  });

  it("is deterministic: same input always same output", () => {
    const fp1 = generateFingerprint("SyntaxError", stackA);
    const fp2 = generateFingerprint("SyntaxError", stackA);
    expect(fp1).toBe(fp2);
  });

  it("returns a 64-char hex string (SHA-256)", () => {
    const fp = generateFingerprint("Error", "Error: foo\n  at bar");
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ---------------------------------------------------------------------------
// classifySeverity
// ---------------------------------------------------------------------------

describe("classifySeverity", () => {
  it("classifies override 'critical' as critical", () => {
    expect(classifySeverity("Error", "anything", "critical")).toBe("critical");
  });

  it("classifies override 'high' as high", () => {
    expect(classifySeverity("Error", "anything", "high")).toBe("high");
  });

  it("classifies override 'low' as low", () => {
    expect(classifySeverity("Error", "anything", "low")).toBe("low");
  });

  it("classifies DatabaseError type as high", () => {
    expect(classifySeverity("DatabaseError", "unable to open")).toBe("high");
  });

  it("classifies timeout message as low", () => {
    expect(classifySeverity("Error", "request timeout exceeded")).toBe("low");
  });

  it("classifies governance bypass message as critical", () => {
    expect(classifySeverity("Error", "governance bypass detected")).toBe("critical");
  });

  it("falls back to medium for generic errors", () => {
    expect(classifySeverity("Error", "something went wrong")).toBe("medium");
  });
});
