// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Security regression tests for #531 #519 (H8, H9, H12):
 *
 *   H8:  maskKey fix — show only last 4 characters of API keys
 *   H9:  validateEmbeddingProvider — fail-fast on stub/zero-vector/dimension mismatch
 *   H12: Telemetry privacy — PII re-redaction on flush, default "off", ID rotation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import os   from "node:os";
import path from "node:path";
import fs   from "node:fs";

import { maskKey }                  from "../../src/cli/commands/key.js";
import { validateEmbeddingProvider } from "../../src/cli/commands/migrate-embeddings.js";
import { SidjuaError }              from "../../src/core/error-codes.js";
import { containsPotentialPii }     from "../../src/core/telemetry/pii-redactor.js";
import { redactPii }                from "../../src/core/telemetry/pii-redactor.js";
import {
  TelemetryReporter,
  loadTelemetryConfig,
  saveTelemetryConfig,
  resetTelemetryReporter,
} from "../../src/core/telemetry/telemetry-reporter.js";
import {
  TelemetryBuffer,
  resetTelemetryRateLimit,
} from "../../src/core/telemetry/telemetry-buffer.js";
import { INSTALLATION_ID_TTL_DAYS } from "../../src/core/telemetry/telemetry-types.js";
import type {
  TelemetryConfig,
  TelemetryEvent,
} from "../../src/core/telemetry/telemetry-types.js";
import type { Embedder } from "../../src/knowledge-pipeline/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _tmpDir: string;

function makeTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sidjua-h8h9h12-"));
  fs.mkdirSync(path.join(dir, ".system"), { recursive: true });
  return dir;
}

function makeEmbedder(opts: {
  returnZero?:    boolean;
  dimensions?:    number;
  throws?:        boolean;
}): Embedder {
  const dims = opts.dimensions ?? 1536;
  return {
    dimensions: dims,
    maxTokens:  8191,
    embed: async (texts: string[]): Promise<Float32Array[]> => {
      if (opts.throws === true) throw new Error("Provider not configured");
      return texts.map(() => {
        const arr = new Float32Array(dims);
        if (opts.returnZero !== true) {
          // Non-zero: fill with 0.5
          arr.fill(0.5);
        }
        return arr;
      });
    },
  };
}

function makeEvent(overrides: Partial<TelemetryEvent> = {}): TelemetryEvent {
  return {
    installation_id: "inst-001",
    fingerprint:     "fp-001",
    error_type:      "TypeError",
    error_message:   "test error",
    stack_hash:      "abc123",
    sidjua_version:  "0.10.0",
    node_version:    "v22.0.0",
    os:              "linux",
    arch:            "x64",
    timestamp:       new Date().toISOString(),
    severity:        "error" as TelemetryEvent["severity"],
    ...overrides,
  };
}

// ===========================================================================
// H8: maskKey — last-4-only API key masking
// ===========================================================================

describe("H8 #531: maskKey — last 4 chars only", () => {
  it("empty string → ****", () => {
    expect(maskKey("")).toBe("****");
  });

  it("key ≤ 4 chars → full mask ****", () => {
    expect(maskKey("ab")).toBe("****");
    expect(maskKey("abcd")).toBe("****");
  });

  it("5-char key → 4 asterisks prefix + last 4 chars", () => {
    const result = maskKey("abcde");
    expect(result).toBe("****bcde");
    expect(result.startsWith("****")).toBe(true);
  });

  it("8-char key → 4 asterisks + last 4 chars", () => {
    expect(maskKey("abcdefgh")).toBe("****efgh");
  });

  it("long key shows only last 4 chars with proportional asterisks", () => {
    const key    = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz1234";
    const result = maskKey(key);
    expect(result.endsWith("1234")).toBe(true);
    expect(result.startsWith("****")).toBe(true);
    // No 'sk-' or 'ant' prefix leaked
    expect(result).not.toContain("sk-");
    expect(result).not.toContain("ant");
  });

  it("total masked length = max(key.length - 4, 4) + 4", () => {
    const key    = "abcdefghijklmnop"; // 16 chars
    const result = maskKey(key);
    // 12 asterisks + 4 visible
    expect(result).toBe("*".repeat(12) + "mnop");
    expect(result.length).toBe(16);
  });

  it("does not expose the first 8 characters (old behavior guard)", () => {
    // Old impl: key.slice(0, 8) + '...' + key.slice(-4)
    const key    = "sk-ant-secret1234abcd";
    const result = maskKey(key);
    expect(result).not.toContain("sk-ant-s"); // old first-8 would be "sk-ant-s"
    expect(result.endsWith("abcd")).toBe(true);
  });

  it("minimum 4 asterisks prefix regardless of key length", () => {
    // 5-char key: length - 4 = 1, but min is 4
    const result = maskKey("xyzab");
    expect(result.split("*").join("")).not.toHaveLength(0);
    expect(result.slice(0, 4)).toBe("****");
  });
});

// ===========================================================================
// H9: validateEmbeddingProvider — fail-fast checks
// ===========================================================================

describe("H9 #531: validateEmbeddingProvider", () => {
  it("passes for a real non-zero embedder with matching dimensions", async () => {
    const embedder = makeEmbedder({ returnZero: false, dimensions: 1536 });
    await expect(validateEmbeddingProvider(embedder, 1536)).resolves.toBeUndefined();
  });

  it("passes without dimension check when expectedDimensions is omitted", async () => {
    const embedder = makeEmbedder({ returnZero: false, dimensions: 768 });
    await expect(validateEmbeddingProvider(embedder)).resolves.toBeUndefined();
  });

  it("throws EMB-001 when embed() throws (provider not configured)", async () => {
    const embedder = makeEmbedder({ throws: true });
    await expect(validateEmbeddingProvider(embedder)).rejects.toMatchObject({
      code: "EMB-001",
    });
  });

  it("throws EMB-002 for zero-vector embedder (stub detector)", async () => {
    const embedder = makeEmbedder({ returnZero: true, dimensions: 1536 });
    const err = await validateEmbeddingProvider(embedder).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SidjuaError);
    expect((err as SidjuaError).code).toBe("EMB-002");
  });

  it("throws EMB-003 for dimension mismatch", async () => {
    // embedder returns 768-dim vectors but 1536 expected
    const embedder = makeEmbedder({ returnZero: false, dimensions: 768 });
    const err = await validateEmbeddingProvider(embedder, 1536).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SidjuaError);
    expect((err as SidjuaError).code).toBe("EMB-003");
  });

  it("EMB-003 detail includes actual and expected dimensions", async () => {
    const embedder = makeEmbedder({ returnZero: false, dimensions: 256 });
    const err = await validateEmbeddingProvider(embedder, 1024).catch((e: unknown) => e) as SidjuaError;
    expect(err.message).toMatch(/expected 1024/);
    expect(err.message).toMatch(/got 256/);
  });
});

// ===========================================================================
// H12a: containsPotentialPii
// ===========================================================================

describe("H12a #531: containsPotentialPii", () => {
  it("returns false for clean text with no PII", () => {
    expect(containsPotentialPii("TypeError: cannot read property 'x' of undefined")).toBe(false);
  });

  it("returns true for text containing an API key pattern", () => {
    expect(containsPotentialPii("key failed: sk-ant-api03-secret-value")).toBe(true);
  });

  it("returns true for text containing an email address", () => {
    expect(containsPotentialPii("user@example.com caused the error")).toBe(true);
  });

  it("returns true for text containing a file path", () => {
    expect(containsPotentialPii("Error at /home/sidjua-dev/project/file.ts")).toBe(true);
  });

  it("returns false for already-redacted text (idempotency)", () => {
    // After redactPii, the output should not trigger containsPotentialPii
    const raw      = "sk-ant-api03-mysecret hit /home/user/app error@test.com";
    const redacted = redactPii(raw);
    expect(containsPotentialPii(redacted)).toBe(false);
  });

  it("returns true for Bearer token", () => {
    expect(containsPotentialPii("Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9")).toBe(true);
  });
});

// ===========================================================================
// H12a: drain() re-applies PII redaction
// ===========================================================================

describe("H12a #531: drain() re-applies PII redaction before sending", () => {
  let tmpDir: string;
  let buffer: TelemetryBuffer;

  beforeEach(() => {
    resetTelemetryRateLimit();
    tmpDir = makeTmpDir();
    buffer = new TelemetryBuffer(tmpDir);
    resetTelemetryReporter();
  });

  afterEach(() => {
    buffer.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("drain() re-redacts error_message containing PII before transmission", async () => {
    const config: TelemetryConfig = {
      mode:             "auto",
      primaryEndpoint:  "https://test.invalid/v1/report",
      fallbackEndpoint: "https://test2.invalid/v1/report",
      installationId:   "test-id",
    };

    // Manually store an event that has a raw API key in error_message
    const rawMessage = "sk-ant-api03-leaked-key caused the problem";
    buffer.store(makeEvent({ fingerprint: "fp-pii-test", error_message: rawMessage }));

    const reporter = new TelemetryReporter(config, tmpDir, "0.10.0");

    const sentMessages: string[] = [];
    // Mock fetch to capture what gets sent
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(init?.body as string) as TelemetryEvent;
      sentMessages.push(body.error_message);
      return new Response(null, { status: 200 });
    });

    await reporter.drain();
    fetchSpy.mockRestore();

    // The raw API key should NOT appear in what was sent
    if (sentMessages.length > 0) {
      expect(sentMessages[0]).not.toContain("sk-ant-api03-leaked-key");
      expect(sentMessages[0]).toContain("<api-key>");
    }
  });

  it("drain() passes through already-clean messages without modification", async () => {
    const config: TelemetryConfig = {
      mode:             "auto",
      primaryEndpoint:  "https://test.invalid/v1/report",
      fallbackEndpoint: "https://test2.invalid/v1/report",
      installationId:   "test-id",
    };

    const cleanMessage = "Cannot read property 'x' of undefined";
    buffer.store(makeEvent({ fingerprint: "fp-clean-test", error_message: cleanMessage }));

    const reporter = new TelemetryReporter(config, tmpDir, "0.10.0");

    const sentMessages: string[] = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(init?.body as string) as TelemetryEvent;
      sentMessages.push(body.error_message);
      return new Response(null, { status: 200 });
    });

    await reporter.drain();
    fetchSpy.mockRestore();

    if (sentMessages.length > 0) {
      expect(sentMessages[0]).toBe(cleanMessage);
    }
  });
});

// ===========================================================================
// H12b: Default mode "off"
// ===========================================================================

describe("H12b #531: telemetry default mode is 'off'", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loadTelemetryConfig creates default config with mode='off'", async () => {
    const config = await loadTelemetryConfig(tmpDir);
    expect(config.mode).toBe("off");
  });

  it("loadTelemetryConfig falls back to 'off' when config has no mode field", async () => {
    const cfgPath = path.join(tmpDir, ".system", "telemetry.json");
    // Write a config with no mode field
    fs.writeFileSync(cfgPath, JSON.stringify({
      primaryEndpoint:  "https://example.com",
      fallbackEndpoint: "https://example2.com",
      installationId:   "test-uuid",
    }), "utf-8");

    const config = await loadTelemetryConfig(tmpDir);
    expect(config.mode).toBe("off");
  });

  it("loadTelemetryConfig preserves an explicitly-set mode", async () => {
    const cfgPath = path.join(tmpDir, ".system", "telemetry.json");
    fs.writeFileSync(cfgPath, JSON.stringify({
      mode:             "auto",
      primaryEndpoint:  "https://example.com",
      fallbackEndpoint: "https://example2.com",
      installationId:   "test-uuid",
    }), "utf-8");

    const config = await loadTelemetryConfig(tmpDir);
    expect(config.mode).toBe("auto");
  });
});

// ===========================================================================
// H12c: Installation ID rotation after 90 days
// ===========================================================================

describe("H12c #531: installation ID rotation", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("INSTALLATION_ID_TTL_DAYS is 90", () => {
    expect(INSTALLATION_ID_TTL_DAYS).toBe(90);
  });

  it("fresh config writes installationIdCreatedAt", async () => {
    const config = await loadTelemetryConfig(tmpDir);
    expect(config.installationIdCreatedAt).toBeDefined();
    expect(typeof config.installationIdCreatedAt).toBe("string");
    // Should parse as a valid date
    expect(Number.isNaN(new Date(config.installationIdCreatedAt!).getTime())).toBe(false);
  });

  it("ID is NOT rotated when createdAt is recent (< 90 days)", async () => {
    const originalId = "original-uuid-12345";
    const recentDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(); // 10 days ago

    const cfgPath = path.join(tmpDir, ".system", "telemetry.json");
    await saveTelemetryConfig(tmpDir, {
      mode:                   "off",
      primaryEndpoint:        "https://example.com",
      fallbackEndpoint:       "https://example2.com",
      installationId:         originalId,
      installationIdCreatedAt: recentDate,
    });

    const loaded = await loadTelemetryConfig(tmpDir);
    expect(loaded.installationId).toBe(originalId); // unchanged
  });

  it("ID is rotated when createdAt is ≥ 90 days old", async () => {
    const originalId = "old-uuid-to-rotate";
    const oldDate    = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString(); // 91 days ago

    const cfgPath = path.join(tmpDir, ".system", "telemetry.json");
    await saveTelemetryConfig(tmpDir, {
      mode:                   "off",
      primaryEndpoint:        "https://example.com",
      fallbackEndpoint:       "https://example2.com",
      installationId:         originalId,
      installationIdCreatedAt: oldDate,
    });

    const loaded = await loadTelemetryConfig(tmpDir);
    // ID should be a new UUID
    expect(loaded.installationId).not.toBe(originalId);
    // New createdAt should be recent (within last minute)
    const newAgeMs = Date.now() - new Date(loaded.installationIdCreatedAt!).getTime();
    expect(newAgeMs).toBeLessThan(60_000);
  });

  it("rotated config is persisted to disk", async () => {
    const originalId = "persisted-rotation-test";
    const oldDate    = new Date(Date.now() - 95 * 24 * 60 * 60 * 1000).toISOString();

    await saveTelemetryConfig(tmpDir, {
      mode:                   "off",
      primaryEndpoint:        "https://example.com",
      fallbackEndpoint:       "https://example2.com",
      installationId:         originalId,
      installationIdCreatedAt: oldDate,
    });

    const first  = await loadTelemetryConfig(tmpDir);
    const second = await loadTelemetryConfig(tmpDir); // load again — should get same new ID

    expect(first.installationId).not.toBe(originalId);
    expect(second.installationId).toBe(first.installationId); // stable after rotation
  });
});
