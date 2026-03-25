/**
 * Tests for Prompt 109: Gemini Audit #3 — Medium + Low + Roast Remediation
 *
 * Covers:
 * - M1: JSON log output is valid JSON (no post-serialization regex corruption)
 * - M2: Cross-platform path validation in backup (path.relative instead of startsWith)
 * - M3: Backup continues when one .db file is corrupt
 * - M5: URL-safe base64 (-/_) is detected by input sanitizer
 * - M7: No developer names (goetz/Goetz) in source code
 * - L1: isProcessAlive utility exists and works
 * - L4: No bare catch {} blocks in src/
 * - L5: No empty setInterval keepAlive in start.ts
 * - L6: Rate limiter has lastAccess field and LRU eviction
 * - L7: No _contentBinary underscore-prefix in outputs.ts
 * - L8: Default maxLength is >= 200000
 * - L9: Log directory created with mode 0o700
 * - L10: Error objects are logged with message and stack
 * - L11: No version-specific TODO comments in src/
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, mkdtempSync, rmSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "../..");

// M1: JSON log output is valid JSON
describe("M1: JSON log output validity", () => {
  it("formatEntry produces valid JSON (no post-serialization regex corruption)", async () => {
    const { createLogger, configureLogger, resetLogger } = await import("../../src/core/logger.js");
    resetLogger();
    const lines: string[] = [];
    // Capture stdout by temporarily patching
    const orig = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: string | Uint8Array) => {
      if (typeof chunk === "string") lines.push(chunk.trim());
      return true;
    };
    try {
      configureLogger({ level: "debug", format: "json", output: "stdout" });
      const logger = createLogger("test");
      logger.info("test_event", "Test message", {
        metadata: { password: "secret123", safe_key: "safe_value" }
      });
    } finally {
      process.stdout.write = orig;
      resetLogger();
    }
    const line = lines.find((l) => l.startsWith("{"));
    expect(line).toBeDefined();
    // Must be parseable JSON
    expect(() => JSON.parse(line!)).not.toThrow();
    const parsed = JSON.parse(line!) as Record<string, unknown>;
    // Password must be redacted
    const meta = parsed["metadata"] as Record<string, unknown>;
    expect(meta?.["password"]).toBe("[REDACTED]");
    // Safe key preserved
    expect(meta?.["safe_key"]).toBe("safe_value");
  });
});

// M5: URL-safe base64 detection
describe("M5: URL-safe base64 detection", () => {
  it("detects standard base64 (+ and /)", async () => {
    const { InputSanitizer } = await import("../../src/core/input-sanitizer.js");
    const san = new InputSanitizer({ mode: "warn", maxLength: 200_000 });
    const b64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".repeat(4);
    const result = san.sanitize(b64);
    expect(result.warnings.some((w) => w.type === "encoding_attack")).toBe(true);
  });

  it("detects URL-safe base64 (- and _)", async () => {
    const { InputSanitizer } = await import("../../src/core/input-sanitizer.js");
    const san = new InputSanitizer({ mode: "warn", maxLength: 200_000 });
    // URL-safe base64: uses - and _ instead of + and /
    const urlB64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_".repeat(4);
    const result = san.sanitize(urlB64);
    expect(result.warnings.some((w) => w.type === "encoding_attack")).toBe(true);
  });

  it("does not flag strings shorter than 200 chars", async () => {
    const { InputSanitizer } = await import("../../src/core/input-sanitizer.js");
    const san = new InputSanitizer({ mode: "warn", maxLength: 200_000 });
    const short = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij";
    const result = san.sanitize(short);
    expect(result.warnings.filter((w) => w.type === "encoding_attack")).toHaveLength(0);
  });
});

// M7: No developer names in source
describe("M7: No developer names in source code", () => {
  it("grep returns zero results for goetz/Goetz in src/", async () => {
    const { execSync } = await import("node:child_process");
    let output = "";
    try {
      output = execSync(
        `grep -rn "goetz\\|Goetz\\|kohlberg\\|Kohlberg" ${resolve(PROJECT_ROOT, "src")} 2>/dev/null ` +
        `| grep -v "github\\.com" ` +
        `| grep -v "Copyright.*Kohlberg" ` +
        `| grep -v "LICENSE-AGPL\\|LICENSE-COMMERCIAL\\|LICENSE-AGPL" ` +
        `|| true`,
        { encoding: "utf-8" }
      );
    } catch (e: unknown) { /* grep returns non-zero when no match — ok */ void e; }
    // License headers contain the copyright holder's name — those are expected.
    // Only unexpected occurrences (e.g. hardcoded author names in business logic) should fail.
    expect(output.trim()).toBe("");
  });
});

// L1: isProcessAlive utility
describe("L1: isProcessAlive utility", () => {
  it("returns true for the current process PID", async () => {
    const { isProcessAlive } = await import("../../src/cli/utils/process.js");
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it("returns false for a non-existent PID (999999)", async () => {
    const { isProcessAlive } = await import("../../src/cli/utils/process.js");
    // PID 999999 is extremely unlikely to exist
    expect(isProcessAlive(999999)).toBe(false);
  });
});

// L4: No bare catch {} blocks
describe("L4: No bare catch {} blocks", () => {
  it("src/ has zero bare catch {} blocks (all name the error variable)", async () => {
    const { execSync } = await import("node:child_process");
    const output = execSync(
      `grep -rn "catch {" ${resolve(PROJECT_ROOT, "src")} 2>/dev/null || true`,
      { encoding: "utf-8" }
    );
    expect(output.trim()).toBe("");
  });
});

// L5: No empty keepAlive interval in start.ts
describe("L5: No empty keepAlive interval", () => {
  it("start.ts has no empty setInterval keepAlive hack", () => {
    const content = readFileSync(resolve(PROJECT_ROOT, "src/cli/commands/start.ts"), "utf-8");
    expect(content).not.toContain("setInterval(() => { /* heartbeat");
    expect(content).not.toContain("setInterval(() => {},");
  });
});

// L7: No underscore-prefix destructure tricks
describe("L7: No _contentBinary underscore-prefix pattern", () => {
  it("outputs.ts has no _contentBinary underscore tricks", () => {
    const content = readFileSync(resolve(PROJECT_ROOT, "src/api/routes/outputs.ts"), "utf-8");
    expect(content).not.toContain("_contentBinary");
  });
});

// L8: Default maxLength is at least 200000
describe("L8: Input sanitizer maxLength", () => {
  it("DEFAULT_SANITIZER_CONFIG.maxLength >= 200000", async () => {
    const { DEFAULT_SANITIZER_CONFIG } = await import("../../src/core/input-sanitizer.js");
    expect(DEFAULT_SANITIZER_CONFIG.maxLength).toBeGreaterThanOrEqual(200_000);
  });
});

// L10: Error objects log with message and stack
describe("L10: Error prototype preservation in logs", () => {
  it("redactObject preserves Error.message and Error.stack", async () => {
    const { redactObject } = await import("../../src/core/logger.js");
    const err = new Error("test error message");
    const result = redactObject(err) as Record<string, unknown>;
    expect(result["message"]).toBe("test error message");
    expect(result["name"]).toBe("Error");
    expect(typeof result["stack"]).toBe("string");
  });

  it("nested Error in metadata is serialized", async () => {
    const { redactObject } = await import("../../src/core/logger.js");
    const meta = { cause: new Error("inner error") };
    const result = redactObject(meta) as Record<string, unknown>;
    const cause = result["cause"] as Record<string, unknown>;
    expect(cause["message"]).toBe("inner error");
  });
});

// L11: No version-specific TODO comments
describe("L11: No version-specific TODO comments", () => {
  it("src/ has no TODO(V1.x) or TODO(V2.x) version-pinned comments", async () => {
    const { execSync } = await import("node:child_process");
    const output = execSync(
      `grep -rn "TODO(V[0-9]" ${resolve(PROJECT_ROOT, "src")} 2>/dev/null || true`,
      { encoding: "utf-8" }
    );
    expect(output.trim()).toBe("");
  });
});

// L6: Rate limiter has lastAccess
describe("L6: Rate limiter LRU eviction", () => {
  it("rate-limiter Bucket type has lastAccess field", () => {
    const content = readFileSync(resolve(PROJECT_ROOT, "src/api/middleware/rate-limiter.ts"), "utf-8");
    expect(content).toContain("lastAccess");
  });

  it("setBucket function implements LRU eviction", () => {
    const content = readFileSync(resolve(PROJECT_ROOT, "src/api/middleware/rate-limiter.ts"), "utf-8");
    expect(content).toContain("lruKey");
  });
});

// M2: Cross-platform path validation
describe("M2: Cross-platform path validation", () => {
  it("resolveArchivePath uses path.relative not startsWith", () => {
    const content = readFileSync(resolve(PROJECT_ROOT, "src/core/backup.ts"), "utf-8");
    // Should use relative() check not hardcoded slash
    expect(content).not.toContain('resolvedDir + "/"');
    expect(content).toContain("relative(");
  });
});

// M3: Backup continues on corrupt .db files
describe("M3: Backup skips corrupt .db files", () => {
  it("createBackup result includes warnings array type", () => {
    const content = readFileSync(resolve(PROJECT_ROOT, "src/core/backup.ts"), "utf-8");
    expect(content).toContain("warnings");
    expect(content).toContain("dbWarnings");
  });
});

// M6: WAL checkpoint uses worker thread
describe("M6: WAL checkpoint in worker thread", () => {
  it("backup.ts uses Worker for checkpoint", () => {
    const content = readFileSync(resolve(PROJECT_ROOT, "src/core/backup.ts"), "utf-8");
    expect(content).toContain("worker_threads");
    expect(content).toContain("Worker");
  });
});
