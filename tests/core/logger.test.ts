/**
 * Tests for src/core/logger.ts — Phase 10.8 Component B
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createLogger,
  configureLogger,
  setGlobalLevel,
  setComponentLevel,
  getLoggerStatus,
  resetLogger,
} from "../../src/core/logger.js";

// ---------------------------------------------------------------------------
// Helpers — capture output without hitting stdout/stderr
// ---------------------------------------------------------------------------

function captureOutput(fn: () => void): { stdout: string; stderr: string } {
  const chunks: string[] = [];
  const errChunks: string[] = [];

  const outSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    chunks.push(String(chunk));
    return true;
  });
  const errSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    errChunks.push(String(chunk));
    return true;
  });

  try {
    fn();
  } finally {
    outSpy.mockRestore();
    errSpy.mockRestore();
  }

  return { stdout: chunks.join(""), stderr: errChunks.join("") };
}

beforeEach(() => {
  resetLogger();
  configureLogger({ level: "debug", format: "json" });
});

// ---------------------------------------------------------------------------
// JSON format
// ---------------------------------------------------------------------------

describe("Logger — JSON format", () => {
  it("outputs valid JSON per line", () => {
    const logger = createLogger("test-component");
    const { stdout } = captureOutput(() => {
      logger.info("test_event", "hello world");
    });

    const parsed = JSON.parse(stdout.trim()) as Record<string, unknown>;
    expect(parsed["level"]).toBe("info");
    expect(parsed["component"]).toBe("test-component");
    expect(parsed["event"]).toBe("test_event");
    expect(parsed["message"]).toBe("hello world");
    expect(typeof parsed["timestamp"]).toBe("string");
  });

  it("includes metadata when provided", () => {
    const logger = createLogger("test-component");
    const { stdout } = captureOutput(() => {
      logger.info("evt", "msg", { metadata: { key: "value" } });
    });
    const parsed = JSON.parse(stdout.trim()) as Record<string, unknown>;
    expect(parsed["metadata"]).toEqual({ key: "value" });
  });
});

// ---------------------------------------------------------------------------
// Text format
// ---------------------------------------------------------------------------

describe("Logger — text format", () => {
  it("outputs human-readable text", () => {
    configureLogger({ format: "text" });
    const logger = createLogger("my-module");
    const { stdout } = captureOutput(() => {
      logger.warn("something_happened", "check this");
    });
    expect(stdout).toContain("WARN");
    expect(stdout).toContain("my-module");
    expect(stdout).toContain("something_happened");
    expect(stdout).toContain("check this");
  });
});

// ---------------------------------------------------------------------------
// Level filtering — global
// ---------------------------------------------------------------------------

describe("Logger — global level filtering", () => {
  it("filters out messages below the global level", () => {
    setGlobalLevel("warn");
    const logger = createLogger("filter-test");

    const { stdout } = captureOutput(() => {
      logger.debug("evt", "should be suppressed");
      logger.info("evt", "should be suppressed");
      logger.warn("evt", "should appear");
    });

    expect(stdout).not.toContain("suppressed");
    expect(stdout).toContain("should appear");
  });

  it("passes messages at or above the level", () => {
    setGlobalLevel("info");
    const logger = createLogger("level-test");
    const { stdout } = captureOutput(() => {
      logger.info("evt", "info msg");
      logger.error("evt", "error msg");
    });
    expect(stdout).toContain("info msg");
    // error goes to stderr but captured in our spy — check combined
    // (process.stderr.write captures error)
    const { stderr } = captureOutput(() => {
      logger.error("evt", "error stderr");
    });
    expect(stderr).toContain("error stderr");
  });
});

// ---------------------------------------------------------------------------
// Per-component log level overrides
// ---------------------------------------------------------------------------

describe("Logger — per-component level overrides", () => {
  it("overrides global level for a specific component", () => {
    setGlobalLevel("error");           // global = error (very quiet)
    setComponentLevel("noisy-component", "debug"); // but noisy-component = debug

    const quiet  = createLogger("quiet-component");
    const noisy  = createLogger("noisy-component");

    const { stdout } = captureOutput(() => {
      quiet.debug("evt", "quiet debug — should be filtered");
      noisy.debug("evt", "noisy debug — should appear");
    });

    expect(stdout).not.toContain("quiet debug");
    expect(stdout).toContain("noisy debug");
  });

  it("configureLogger components map applies overrides", () => {
    configureLogger({ components: { "specific-mod": "warn" } });
    setGlobalLevel("debug"); // global is verbose

    const logger = createLogger("specific-mod");
    const { stdout } = captureOutput(() => {
      logger.debug("evt", "debug — suppressed by override");
      logger.warn("evt", "warn — passes override");
    });

    expect(stdout).not.toContain("suppressed by override");
    expect(stdout).toContain("passes override");
  });
});

// ---------------------------------------------------------------------------
// off level — zero output
// ---------------------------------------------------------------------------

describe("Logger — off level produces zero output", () => {
  it("silences a component entirely with off level", () => {
    setComponentLevel("silent-mod", "off");
    const logger = createLogger("silent-mod");

    const { stdout, stderr } = captureOutput(() => {
      logger.debug("e", "should not appear");
      logger.info("e", "should not appear");
      logger.warn("e", "should not appear");
      logger.error("e", "should not appear");
      logger.fatal("e", "should not appear");
    });

    expect(stdout).toBe("");
    expect(stderr).toBe("");
  });

  it("global off silences everything", () => {
    setGlobalLevel("off");
    const logger = createLogger("any-mod");

    const { stdout, stderr } = captureOutput(() => {
      logger.info("e", "info");
      logger.error("e", "error");
    });

    expect(stdout).toBe("");
    expect(stderr).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Child logger
// ---------------------------------------------------------------------------

describe("Logger — child logger", () => {
  it("inherits component from parent", () => {
    const parent = createLogger("parent-component");
    const child  = parent.child({ correlationId: "task-123" });

    const { stdout } = captureOutput(() => {
      child.info("evt", "from child");
    });

    const parsed = JSON.parse(stdout.trim()) as Record<string, unknown>;
    expect(parsed["component"]).toBe("parent-component");
    expect(parsed["correlationId"]).toBe("task-123");
  });

  it("child overrides can set different component", () => {
    const parent = createLogger("parent");
    const child  = parent.child({ component: "child-component" });

    const { stdout } = captureOutput(() => {
      child.info("evt", "msg");
    });

    const parsed = JSON.parse(stdout.trim()) as Record<string, unknown>;
    expect(parsed["component"]).toBe("child-component");
  });
});

// ---------------------------------------------------------------------------
// PII/secret redaction
// ---------------------------------------------------------------------------

describe("Logger — redaction", () => {
  it("strips Bearer tokens", () => {
    const logger = createLogger("auth-mod");
    const { stdout } = captureOutput(() => {
      logger.info("auth_call", "Calling API", {
        metadata: { header: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" },
      });
    });
    expect(stdout).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
    expect(stdout).toContain("[REDACTED]");
  });

  it("strips sk- API keys", () => {
    const logger = createLogger("provider-mod");
    const { stdout } = captureOutput(() => {
      logger.info("api_call", "key=sk-abc123def456");
    });
    expect(stdout).not.toContain("sk-abc123def456");
    expect(stdout).toContain("[REDACTED]");
  });
});

// ---------------------------------------------------------------------------
// Correlation ID
// ---------------------------------------------------------------------------

describe("Logger — correlation ID", () => {
  it("threads correlationId through to log entry", () => {
    const logger = createLogger("task-mod");
    const { stdout } = captureOutput(() => {
      logger.info("task_created", "Task created", { correlationId: "task-abc" });
    });
    const parsed = JSON.parse(stdout.trim()) as Record<string, unknown>;
    expect(parsed["correlationId"]).toBe("task-abc");
  });
});

// ---------------------------------------------------------------------------
// Duration tracking
// ---------------------------------------------------------------------------

describe("Logger — duration tracking", () => {
  it("startTimer returns a number", () => {
    const logger = createLogger("timer-mod");
    const t0 = logger.startTimer();
    expect(typeof t0).toBe("number");
  });

  it("duration_ms is logged when provided", () => {
    const logger = createLogger("perf-mod");
    const t0 = Date.now();
    const { stdout } = captureOutput(() => {
      logger.info("op_complete", "Done", { duration_ms: Date.now() - t0 });
    });
    const parsed = JSON.parse(stdout.trim()) as Record<string, unknown>;
    expect(typeof parsed["duration_ms"]).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// getLoggerStatus
// ---------------------------------------------------------------------------

describe("getLoggerStatus", () => {
  it("returns current global level and component map", () => {
    setGlobalLevel("warn");
    setComponentLevel("foo", "debug");
    const status = getLoggerStatus();
    expect(status.global).toBe("warn");
    expect(status.components["foo"]).toBe("debug");
  });
});

// ---------------------------------------------------------------------------
// D6: redactObject — circular reference protection (FIX-8)
// ---------------------------------------------------------------------------

import { redactObject } from "../../src/core/logger.js";

describe("redactObject — circular reference protection", () => {
  it("handles a direct circular reference without throwing", () => {
    const obj: Record<string, unknown> = { name: "root" };
    obj["self"] = obj; // circular
    expect(() => redactObject(obj)).not.toThrow();
  });

  it("replaces the circular reference with [Circular]", () => {
    const obj: Record<string, unknown> = { name: "root" };
    obj["self"] = obj;
    const result = redactObject(obj) as Record<string, unknown>;
    expect(result["self"]).toBe("[Circular]");
    expect(result["name"]).toBe("root");
  });

  it("handles indirect circular references (A → B → A)", () => {
    const a: Record<string, unknown> = { tag: "A" };
    const b: Record<string, unknown> = { tag: "B", parent: a };
    a["child"] = b;
    expect(() => redactObject(a)).not.toThrow();
    const result = redactObject(a) as Record<string, unknown>;
    const bResult = result["child"] as Record<string, unknown>;
    expect(bResult["parent"]).toBe("[Circular]");
  });

  it("redacts sk- secrets inside nested objects", () => {
    const obj = { credentials: { key: "sk-supersecretkey123" } };
    const result = redactObject(obj) as { credentials: { key: string } };
    expect(result.credentials.key).not.toContain("sk-supersecretkey123");
    expect(result.credentials.key).toContain("[REDACTED]");
  });

  it("redacts sk- secrets inside arrays", () => {
    const arr = ["clean", "sk-anotherapikey456"];
    const result = redactObject(arr) as string[];
    expect(result[0]).toBe("clean");
    expect(result[1]).toContain("[REDACTED]");
  });

  it("passes through non-object primitives unchanged (number, boolean, null)", () => {
    expect(redactObject(42)).toBe(42);
    expect(redactObject(true)).toBe(true);
    expect(redactObject(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// FIX-H1: Sensitive key detection — substring matching (compound keys)
// ---------------------------------------------------------------------------

describe("redactObject — FIX-H1 compound key redaction", () => {
  it("redacts 'db_password' (compound key with password suffix)", () => {
    const obj = { db_password: "s3cr3t" };
    const result = redactObject(obj) as Record<string, unknown>;
    expect(result["db_password"]).toBe("[REDACTED]");
  });

  it("redacts 'authToken' (camelCase with 'token' substring)", () => {
    const obj = { authToken: "tok_abc123" };
    const result = redactObject(obj) as Record<string, unknown>;
    expect(result["authToken"]).toBe("[REDACTED]");
  });

  it("redacts 'aws_secret_access_key' (contains 'secret')", () => {
    const obj = { aws_secret_access_key: "AKIAIOSFODNN7EXAMPLE" };
    const result = redactObject(obj) as Record<string, unknown>;
    expect(result["aws_secret_access_key"]).toBe("[REDACTED]");
  });

  it("redacts 'api-key' key (Tier-1 exact match)", () => {
    // 'api-key' is in the exact-match set (Tier 1)
    const obj = { "api-key": "key_xyz789" };
    const result = redactObject(obj) as Record<string, unknown>;
    expect(result["api-key"]).toBe("[REDACTED]");
  });

  it("does NOT redact safe key 'name' (no sensitive substring)", () => {
    const obj = { name: "Alice", db_password: "redacted!" };
    const result = redactObject(obj) as Record<string, unknown>;
    expect(result["name"]).toBe("Alice");
    expect(result["db_password"]).toBe("[REDACTED]");
  });

  it("does NOT redact 'keyboard' (contains 'key' but is not a secret key field)", () => {
    // 'keyboard' contains 'key' — but 'key' alone isn't a SENSITIVE_SUBSTRING.
    // This confirms we don't match bare 'key' as a substring (avoids false positives).
    const obj = { keyboard: "QWERTY", secretKey: "abc" };
    const result = redactObject(obj) as Record<string, unknown>;
    expect(result["keyboard"]).toBe("QWERTY"); // safe — 'keyboard' doesn't match
    expect(result["secretKey"]).toBe("[REDACTED]"); // 'secret' substring matches
  });
});
