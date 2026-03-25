// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync }    from "node:fs";
import { tmpdir }                                            from "node:os";
import { join }                                              from "node:path";
import {
  TelemetryReporter,
  resetTelemetryReporter,
  reportError,
  initTelemetryReporter,
} from "../../../src/core/telemetry/telemetry-reporter.js";
import type { TelemetryConfig } from "../../../src/core/telemetry/telemetry-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

function makeConfig(overrides: Partial<TelemetryConfig> = {}): TelemetryConfig {
  return {
    mode:             "auto",
    primaryEndpoint:  "http://localhost:19999/primary",
    fallbackEndpoint: "http://localhost:19999/fallback",
    installationId:   "test-uuid-1234",
    ...overrides,
  };
}

function makeReporter(config: Partial<TelemetryConfig> = {}): TelemetryReporter {
  return new TelemetryReporter(makeConfig(config), tmpDir, "0.10.0");
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "sidjua-reporter-test-"));
  mkdirSync(join(tmpDir, ".system"), { recursive: true });
  resetTelemetryReporter();
  vi.restoreAllMocks();
});

afterEach(() => {
  resetTelemetryReporter();
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Fetch mock helpers
// ---------------------------------------------------------------------------

function mockFetchOk(): void {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 }));
}

function mockFetchFail(): void {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));
}

function mockFetchFirstFails(): void {
  let calls = 0;
  vi.stubGlobal("fetch", vi.fn().mockImplementation(() => {
    calls++;
    if (calls === 1) return Promise.reject(new Error("primary down"));
    return Promise.resolve({ ok: true, status: 200 });
  }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TelemetryReporter.report", () => {
  it("stores event locally (mode=auto, network ok)", async () => {
    mockFetchOk();
    const reporter = makeReporter();
    await reporter.report(new Error("test error"));

    // Give async send time to settle
    await new Promise((r) => setTimeout(r, 50));

    const stats = reporter.getBuffer().getStats();
    // May be sent or still pending depending on timing — but total must be >= 1
    expect(stats.total).toBeGreaterThanOrEqual(1);
    reporter.getBuffer().close();
  });

  it("stores locally even when mode=off (no remote send)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const reporter = makeReporter({ mode: "off" });
    await reporter.report(new Error("silent error"));

    const stats = reporter.getBuffer().getStats();
    expect(stats.total).toBe(1);
    expect(stats.pending).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
    reporter.getBuffer().close();
  });

  it("logs to stderr and does not send when mode=ask", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const reporter = makeReporter({ mode: "ask" });
    await reporter.report(new Error("ask mode error"));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("sidjua telemetry enable"));

    reporter.getBuffer().close();
    stderrSpy.mockRestore();
  });

  it("mode=ask only logs the prompt once", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const reporter = makeReporter({ mode: "ask" });
    await reporter.report(new Error("err 1"));
    await reporter.report(new Error("err 2"));

    const telNotices = stderrSpy.mock.calls.filter(
      (args) => String(args[0]).includes("sidjua telemetry enable"),
    );
    expect(telNotices).toHaveLength(1);

    reporter.getBuffer().close();
    stderrSpy.mockRestore();
  });

  it("never throws even with broken config", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network broken")));
    const reporter = makeReporter();
    await expect(reporter.report(new Error("boom"))).resolves.toBeUndefined();
    reporter.getBuffer().close();
  });

  it("never throws with null/undefined error message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    const reporter = makeReporter();
    const weirdErr = new Error();
    await expect(reporter.report(weirdErr)).resolves.toBeUndefined();
    reporter.getBuffer().close();
  });
});

describe("TelemetryReporter.drain", () => {
  it("sends pending events sequentially, returns counts", async () => {
    const reporter = makeReporter({ mode: "off" }); // store locally only

    // Store 3 events without sending
    await reporter.report(new Error("err 1"));
    await reporter.report(new Error("err 2"));
    await reporter.report(new Error("err 3"));

    expect(reporter.getBuffer().getStats().pending).toBe(3);

    // Now enable sending and drain
    mockFetchOk();
    reporter.updateConfig({ mode: "auto" });
    const { sent, failed } = await reporter.drain();

    expect(sent).toBe(3);
    expect(failed).toBe(0);
    reporter.getBuffer().close();
  });

  it("stops on first failure and returns failed count", async () => {
    const reporter = makeReporter({ mode: "off" });

    await reporter.report(new Error("err 1"));
    await reporter.report(new Error("err 2"));

    expect(reporter.getBuffer().getStats().pending).toBe(2);

    mockFetchFail();
    reporter.updateConfig({ mode: "auto" });

    const { sent, failed } = await reporter.drain();
    expect(sent).toBe(0);
    expect(failed).toBe(1);
    reporter.getBuffer().close();
  });

  it("returns 0/0 on empty buffer", async () => {
    mockFetchOk();
    const reporter = makeReporter();
    const { sent, failed } = await reporter.drain();
    expect(sent).toBe(0);
    expect(failed).toBe(0);
    reporter.getBuffer().close();
  });
});

describe("TelemetryReporter.updateConfig", () => {
  it("changes mode dynamically", () => {
    const reporter = makeReporter({ mode: "off" });
    reporter.updateConfig({ mode: "auto" });
    expect(reporter.getConfig().mode).toBe("auto");
    reporter.getBuffer().close();
  });
});

describe("singleton: reportError", () => {
  it("is a no-op if not initialized", () => {
    resetTelemetryReporter();
    // Should not throw
    reportError(new Error("test"));
  });

  it("calls report on initialized singleton", async () => {
    mkdirSync(join(tmpDir, ".system"), { recursive: true });
    const config = makeConfig({ mode: "off" });
    const reporter = initTelemetryReporter(config, tmpDir, "0.10.0");

    reportError(new Error("singleton test"));
    // Give async time to settle
    await new Promise((r) => setTimeout(r, 30));

    const stats = reporter.getBuffer().getStats();
    expect(stats.total).toBeGreaterThanOrEqual(1);
    reporter.getBuffer().close();
  });
});
