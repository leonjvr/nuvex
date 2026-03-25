/**
 * Tests for src/provider/audit-logger.ts
 *
 * Covers:
 * - ensureTables creates provider_calls + provider_call_content tables
 * - logCall writes summary row and full content row
 * - logError writes error row + request content, response NULL
 * - Idempotency of ensureTables (safe to call twice)
 * - Transactions: both rows written or neither
 * - call_id UNIQUE constraint
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { openDatabase, runMigrations, tableExists } from "../../src/utils/db.js";
import { MIGRATIONS } from "../../src/apply/database.js";
import { ProviderAuditLogger } from "../../src/provider/audit-logger.js";
import { ProviderError } from "../../src/types/provider.js";
import type { Database } from "../../src/utils/db.js";
import type { ProviderCallRequest, ProviderCallResponse } from "../../src/types/provider.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(overrides: Partial<ProviderCallRequest> = {}): ProviderCallRequest {
  return {
    callId:       randomUUID(),
    agentId:      "agent-1",
    divisionCode: "engineering",
    provider:     "anthropic",
    model:        "claude-sonnet-4-6",
    messages:     [{ role: "user", content: "Hello!" }],
    ...overrides,
  };
}

function makeResponse(request: ProviderCallRequest, overrides: Partial<ProviderCallResponse> = {}): ProviderCallResponse {
  return {
    callId:    request.callId,
    provider:  "anthropic",
    model:     request.model,
    content:   "Hello back!",
    usage:     { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    costUsd:   0.0001,
    latencyMs: 250,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let tmpDir: string;
let db: Database;
let logger: ProviderAuditLogger;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "sidjua-audit-logger-test-"));
  db     = openDatabase(join(tmpDir, "test.db"));
  db.pragma("journal_mode = WAL");
  runMigrations(db, MIGRATIONS);
  logger = new ProviderAuditLogger(db);
});

afterEach(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// ensureTables
// ---------------------------------------------------------------------------

describe("ProviderAuditLogger.ensureTables", () => {
  it("creates provider_calls table", () => {
    expect(tableExists(db, "provider_calls")).toBe(true);
  });

  it("creates provider_call_content table", () => {
    expect(tableExists(db, "provider_call_content")).toBe(true);
  });

  it("is idempotent — calling twice does not throw", () => {
    expect(() => logger.ensureTables()).not.toThrow();
    expect(() => logger.ensureTables()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// logCall — successful call
// ---------------------------------------------------------------------------

describe("ProviderAuditLogger.logCall", () => {
  it("writes a row to provider_calls", () => {
    const req  = makeRequest();
    const resp = makeResponse(req);
    logger.logCall(req, resp);

    const row = db
      .prepare("SELECT * FROM provider_calls WHERE call_id = ?")
      .get(req.callId) as Record<string, unknown> | undefined;

    expect(row).toBeDefined();
    expect(row?.["call_id"]).toBe(req.callId);
    expect(row?.["agent_id"]).toBe("agent-1");
    expect(row?.["division_code"]).toBe("engineering");
    expect(row?.["provider"]).toBe("anthropic");
    expect(row?.["model"]).toBe("claude-sonnet-4-6");
    expect(row?.["input_tokens"]).toBe(10);
    expect(row?.["output_tokens"]).toBe(5);
    expect(row?.["cost_usd"]).toBeCloseTo(0.0001);
    expect(row?.["latency_ms"]).toBe(250);
    expect(row?.["error_code"]).toBeNull();
    expect(row?.["error_message"]).toBeNull();
  });

  it("writes a row to provider_call_content with request and response JSON", () => {
    const req  = makeRequest();
    const resp = makeResponse(req);
    logger.logCall(req, resp);

    const row = db
      .prepare("SELECT * FROM provider_call_content WHERE call_id = ?")
      .get(req.callId) as Record<string, unknown> | undefined;

    expect(row).toBeDefined();
    const requestJson  = JSON.parse(row?.["request_json"]  as string) as ProviderCallRequest;
    const responseJson = JSON.parse(row?.["response_json"] as string) as ProviderCallResponse;

    expect(requestJson.callId).toBe(req.callId);
    expect(responseJson.content).toBe("Hello back!");
  });

  it("stores finish_reason when present", () => {
    const req  = makeRequest();
    const resp = makeResponse(req, { finishReason: "end_turn" });
    logger.logCall(req, resp);

    const row = db
      .prepare("SELECT finish_reason FROM provider_calls WHERE call_id = ?")
      .get(req.callId) as Record<string, unknown>;

    expect(row["finish_reason"]).toBe("end_turn");
  });

  it("stores NULL finish_reason when absent", () => {
    const req  = makeRequest();
    // Response has no finishReason property (not set)
    const resp: ProviderCallResponse = {
      callId: req.callId, provider: "anthropic", model: req.model,
      content: "test", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      costUsd: 0, latencyMs: 1,
    };
    logger.logCall(req, resp);

    const row = db
      .prepare("SELECT finish_reason FROM provider_calls WHERE call_id = ?")
      .get(req.callId) as Record<string, unknown>;

    expect(row["finish_reason"]).toBeNull();
  });

  it("stores task_id when present on request", () => {
    const req  = makeRequest({ taskId: "task-xyz" });
    const resp = makeResponse(req);
    logger.logCall(req, resp);

    const row = db
      .prepare("SELECT task_id FROM provider_calls WHERE call_id = ?")
      .get(req.callId) as Record<string, unknown>;

    expect(row["task_id"]).toBe("task-xyz");
  });

  it("throws on duplicate call_id (UNIQUE constraint)", () => {
    const req  = makeRequest();
    const resp = makeResponse(req);
    logger.logCall(req, resp);
    expect(() => logger.logCall(req, resp)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// logError — failed call
// ---------------------------------------------------------------------------

describe("ProviderAuditLogger.logError", () => {
  it("writes a row to provider_calls with error details", () => {
    const req = makeRequest();
    const err = new ProviderError("anthropic", "429", "Rate limited", true);
    logger.logError(req, err, 150);

    const row = db
      .prepare("SELECT * FROM provider_calls WHERE call_id = ?")
      .get(req.callId) as Record<string, unknown> | undefined;

    expect(row).toBeDefined();
    expect(row?.["error_code"]).toBe("429");
    expect(row?.["error_message"]).toBe("Rate limited");
    expect(row?.["input_tokens"]).toBe(0);
    expect(row?.["output_tokens"]).toBe(0);
    expect(row?.["cost_usd"]).toBe(0);
    expect(row?.["latency_ms"]).toBe(150);
  });

  it("writes request JSON but NULL response_json to provider_call_content", () => {
    const req = makeRequest();
    logger.logError(req, new Error("network error"), 99);

    const row = db
      .prepare("SELECT * FROM provider_call_content WHERE call_id = ?")
      .get(req.callId) as Record<string, unknown> | undefined;

    expect(row).toBeDefined();
    expect(row?.["request_json"]).toBeTruthy();
    expect(row?.["response_json"]).toBeNull();
  });

  it("handles generic Error (not ProviderError)", () => {
    const req = makeRequest();
    logger.logError(req, new Error("timeout"), 500);

    const row = db
      .prepare("SELECT error_code FROM provider_calls WHERE call_id = ?")
      .get(req.callId) as Record<string, unknown>;

    expect(row["error_code"]).toBe("UNKNOWN");
  });

  it("can log multiple errors with different call_ids", () => {
    logger.logError(makeRequest({ callId: randomUUID() }), new Error("e1"), 10);
    logger.logError(makeRequest({ callId: randomUUID() }), new Error("e2"), 20);

    const count = (db.prepare("SELECT COUNT(*) as n FROM provider_calls").get() as { n: number })["n"];
    expect(count).toBe(2);
  });
});
