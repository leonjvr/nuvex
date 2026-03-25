// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Tests for src/core/selftest/selftest-runner.ts
 */

import { describe, it, expect } from "vitest";
import { SelftestRunner } from "../../../src/core/selftest/selftest-runner.js";
import type { SelftestCheck, SelftestContext, CheckResult } from "../../../src/core/selftest/selftest-runner.js";

function makeCtx(overrides: Partial<SelftestContext> = {}): SelftestContext {
  return { workDir: "/tmp/test", verbose: false, fix: false, ...overrides };
}

function makeCheck(
  name: string,
  status: CheckResult["status"],
  extra: Partial<CheckResult> = {},
): SelftestCheck {
  return {
    name,
    category: "test",
    async run(): Promise<CheckResult> {
      return {
        name,
        category: "test",
        status,
        message:  `Check ${name}: ${status}`,
        duration: 1,
        fixable:  false,
        ...extra,
      };
    },
  };
}

// ---------------------------------------------------------------------------

describe("SelftestRunner", () => {
  it("collects results from multiple checks", async () => {
    const runner = new SelftestRunner();
    runner.registerCheck(makeCheck("alpha", "pass"));
    runner.registerCheck(makeCheck("beta",  "fail"));

    const report = await runner.run(makeCtx());
    expect(report.checks).toHaveLength(2);
    expect(report.checks.map((c) => c.name)).toContain("alpha");
    expect(report.checks.map((c) => c.name)).toContain("beta");
  });

  it("health score = 100 when all checks pass", async () => {
    const runner = new SelftestRunner();
    runner.registerCheck(makeCheck("a", "pass"));
    runner.registerCheck(makeCheck("b", "pass"));

    const report = await runner.run(makeCtx());
    expect(report.healthScore).toBe(100);
  });

  it("health score = 0 when all checks fail", async () => {
    const runner = new SelftestRunner();
    runner.registerCheck(makeCheck("a", "fail"));
    runner.registerCheck(makeCheck("b", "fail"));

    const report = await runner.run(makeCtx());
    expect(report.healthScore).toBe(0);
  });

  it("health score = 50 for one pass, one fail", async () => {
    const runner = new SelftestRunner();
    runner.registerCheck(makeCheck("a", "pass"));
    runner.registerCheck(makeCheck("b", "fail"));

    const report = await runner.run(makeCtx());
    expect(report.healthScore).toBe(50);
  });

  it("warn counts as 0.5 pass in health score", async () => {
    const runner = new SelftestRunner();
    runner.registerCheck(makeCheck("a", "warn"));
    runner.registerCheck(makeCheck("b", "warn"));

    const report = await runner.run(makeCtx());
    // 2 warns = 2 * 0.5 = 1 out of 2 → 50%
    expect(report.healthScore).toBe(50);
  });

  it("skipped checks are excluded from health score denominator", async () => {
    const runner = new SelftestRunner();
    runner.registerCheck(makeCheck("a", "pass"));
    runner.registerCheck(makeCheck("b", "skip"));

    const report = await runner.run(makeCtx());
    // 1 pass, 1 skip → 1/1 = 100
    expect(report.healthScore).toBe(100);
  });

  it("all skipped → health score = 100 (no eligible checks)", async () => {
    const runner = new SelftestRunner();
    runner.registerCheck(makeCheck("a", "skip"));
    runner.registerCheck(makeCheck("b", "skip"));

    const report = await runner.run(makeCtx());
    expect(report.healthScore).toBe(100);
  });

  it("summary counts are correct", async () => {
    const runner = new SelftestRunner();
    runner.registerCheck(makeCheck("a", "pass"));
    runner.registerCheck(makeCheck("b", "pass"));
    runner.registerCheck(makeCheck("c", "warn"));
    runner.registerCheck(makeCheck("d", "fail"));
    runner.registerCheck(makeCheck("e", "skip"));

    const report = await runner.run(makeCtx());
    expect(report.summary.total).toBe(5);
    expect(report.summary.passed).toBe(2);
    expect(report.summary.warned).toBe(1);
    expect(report.summary.failed).toBe(1);
    expect(report.summary.skipped).toBe(1);
  });

  it("report includes version and platform", async () => {
    const runner = new SelftestRunner();
    const report = await runner.run(makeCtx());
    expect(report.version).toBeTruthy();
    expect(report.nodeVersion).toMatch(/^v\d+/);
    expect(report.platform).toBeTruthy();
    expect(report.timestamp).toBeTruthy();
  });

  it("fix mode: failed fixable check runs fix then re-checks", async () => {
    let fixCalled = false;
    let runCount  = 0;

    const runner = new SelftestRunner();
    runner.registerCheck({
      name:     "fixable-check",
      category: "test",
      async run(): Promise<CheckResult> {
        runCount++;
        const status = fixCalled ? "pass" : "fail";
        return {
          name:     "fixable-check",
          category: "test",
          status,
          message:  `run #${runCount}: ${status}`,
          duration: 1,
          fixable:  true,
          fixAction: "do something",
        };
      },
      async fix(): Promise<boolean> {
        fixCalled = true;
        return true;
      },
    });

    const report = await runner.run(makeCtx({ fix: true }));
    expect(fixCalled).toBe(true);
    expect(runCount).toBe(2);
    expect(report.checks[0]!.status).toBe("pass");
  });

  it("fix mode skips fix() when check is not fixable", async () => {
    let fixCalled = false;

    const runner = new SelftestRunner();
    runner.registerCheck({
      name:     "not-fixable",
      category: "test",
      async run(): Promise<CheckResult> {
        return { name: "not-fixable", category: "test", status: "fail", message: "nope", duration: 1, fixable: false };
      },
      async fix(): Promise<boolean> {
        fixCalled = true;
        return true;
      },
    });

    await runner.run(makeCtx({ fix: true }));
    expect(fixCalled).toBe(false);
  });

  it("recommendations include fixAction from failed checks", async () => {
    const runner = new SelftestRunner();
    runner.registerCheck(makeCheck("a", "fail", { fixable: true, fixAction: "run sidjua apply" }));

    const report = await runner.run(makeCtx());
    expect(report.recommendations).toContain("run sidjua apply");
  });

  it("checks run sequentially (registration order preserved)", async () => {
    const order: number[] = [];
    const runner = new SelftestRunner();

    for (let i = 0; i < 3; i++) {
      const idx = i;
      runner.registerCheck({
        name:     `check-${idx}`,
        category: "test",
        async run(): Promise<CheckResult> {
          order.push(idx);
          return { name: `check-${idx}`, category: "test", status: "pass", message: "ok", duration: 1, fixable: false };
        },
      });
    }

    await runner.run(makeCtx());
    expect(order).toEqual([0, 1, 2]);
  });

  it("check that throws is caught and recorded as fail", async () => {
    const runner = new SelftestRunner();
    runner.registerCheck({
      name:     "throwing-check",
      category: "test",
      async run(): Promise<CheckResult> {
        throw new Error("unexpected error");
      },
    });

    const report = await runner.run(makeCtx());
    expect(report.checks[0]!.status).toBe("fail");
    expect(report.checks[0]!.message).toContain("unexpected error");
  });

  it("empty runner returns healthScore 100 with empty summary", async () => {
    const runner = new SelftestRunner();
    const report = await runner.run(makeCtx());
    expect(report.healthScore).toBe(100);
    expect(report.checks).toHaveLength(0);
    expect(report.summary.total).toBe(0);
  });
});
