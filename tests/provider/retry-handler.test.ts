/**
 * Tests for src/provider/retry-handler.ts
 *
 * Covers:
 * - Succeeds on first attempt (no retry)
 * - Retries on retryable ProviderError with backoff
 * - Throws immediately on non-retryable ProviderError
 * - Throws immediately on non-ProviderError
 * - Exhausts all retries and throws last error
 * - TEST_RETRY_CONFIG: fast delays for testing
 */

import { describe, it, expect, vi } from "vitest";
import { RetryHandler, TEST_RETRY_CONFIG } from "../../src/provider/retry-handler.js";
import { ProviderError } from "../../src/types/provider.js";
import { Logger } from "../../src/utils/logger.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const silentLogger = Logger.silent();
const ctx = { provider: "anthropic" as const, callId: "call-001" };

function makeRetryHandler(): RetryHandler {
  return new RetryHandler(TEST_RETRY_CONFIG, silentLogger);
}

function retryableErr(): ProviderError {
  return new ProviderError("anthropic", "429", "Rate limited", true);
}

function nonRetryableErr(): ProviderError {
  return new ProviderError("anthropic", "400", "Bad request", false);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RetryHandler.withRetry — success paths", () => {
  it("returns immediately on first success", async () => {
    const handler = makeRetryHandler();
    let calls = 0;
    const result = await handler.withRetry(async () => {
      calls++;
      return "ok";
    }, ctx);
    expect(result).toBe("ok");
    expect(calls).toBe(1);
  });

  it("returns on second attempt after one retryable failure", async () => {
    const handler = makeRetryHandler();
    let calls = 0;
    const result = await handler.withRetry(async () => {
      calls++;
      if (calls === 1) throw retryableErr();
      return "recovered";
    }, ctx);
    expect(result).toBe("recovered");
    expect(calls).toBe(2);
  });

  it("returns on third (last) attempt after two retryable failures", async () => {
    const handler = makeRetryHandler();
    let calls = 0;
    const result = await handler.withRetry(async () => {
      calls++;
      if (calls < 3) throw retryableErr();
      return "finally";
    }, ctx);
    expect(result).toBe("finally");
    expect(calls).toBe(3);
  });
});

describe("RetryHandler.withRetry — non-retryable failures", () => {
  it("throws immediately on non-retryable ProviderError", async () => {
    const handler = makeRetryHandler();
    let calls = 0;
    await expect(
      handler.withRetry(async () => {
        calls++;
        throw nonRetryableErr();
      }, ctx),
    ).rejects.toThrow("Bad request");
    expect(calls).toBe(1); // no retry
  });

  it("throws immediately on non-ProviderError", async () => {
    const handler = makeRetryHandler();
    let calls = 0;
    await expect(
      handler.withRetry(async () => {
        calls++;
        throw new Error("programming error");
      }, ctx),
    ).rejects.toThrow("programming error");
    expect(calls).toBe(1); // no retry
  });

  it("throws immediately on BudgetExceededError (not a ProviderError)", async () => {
    const handler = makeRetryHandler();
    const budgetErr = new Error("BudgetExceeded: no budget");
    let calls = 0;
    await expect(
      handler.withRetry(async () => {
        calls++;
        throw budgetErr;
      }, ctx),
    ).rejects.toBe(budgetErr);
    expect(calls).toBe(1);
  });
});

describe("RetryHandler.withRetry — exhausted retries", () => {
  it("throws after maxAttempts retryable failures", async () => {
    const handler = makeRetryHandler(); // maxAttempts = 3
    let calls = 0;
    await expect(
      handler.withRetry(async () => {
        calls++;
        throw retryableErr();
      }, ctx),
    ).rejects.toThrow("Rate limited");
    expect(calls).toBe(TEST_RETRY_CONFIG.maxAttempts);
  });

  it("throws the LAST error (not the first)", async () => {
    const handler = makeRetryHandler();
    let calls = 0;
    await expect(
      handler.withRetry(async () => {
        calls++;
        throw new ProviderError("anthropic", String(calls), `Error ${calls}`, true);
      }, ctx),
    ).rejects.toThrow(`Error ${TEST_RETRY_CONFIG.maxAttempts}`);
  });
});

describe("RetryHandler.withRetry — backoff timing", () => {
  it("delays between retries (at least some delay)", async () => {
    const handler = makeRetryHandler(); // initialDelayMs = 10
    let calls = 0;
    const start = Date.now();

    await expect(
      handler.withRetry(async () => {
        calls++;
        if (calls < 3) throw retryableErr();
        return "ok";
      }, ctx),
    ).resolves.toBe("ok");

    const elapsed = Date.now() - start;
    // Should have waited at least 2 delays (10ms + ~20ms = ~30ms total, with jitter)
    // Use conservative lower bound of 15ms (10ms - jitter lower bound)
    expect(elapsed).toBeGreaterThanOrEqual(15);
  });
});

describe("RetryHandler.withRetry — logging", () => {
  it("calls logger.warn on retryable failures", async () => {
    const warnMock = vi.fn();
    const mockLogger = new Logger((entry) => {
      if (entry.level === "warn") warnMock(entry.message);
    });
    const handler = new RetryHandler(TEST_RETRY_CONFIG, mockLogger);
    let calls = 0;

    await handler.withRetry(async () => {
      calls++;
      if (calls === 1) throw retryableErr();
      return "ok";
    }, ctx);

    expect(warnMock).toHaveBeenCalled();
  });
});
