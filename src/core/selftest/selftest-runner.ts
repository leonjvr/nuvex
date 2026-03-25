// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Selftest Check Framework
 *
 * Extensible registry of health checks. Each check is independent,
 * categorised, and optionally fixable. The runner collects results,
 * computes a health score, and surfaces recommendations.
 */

import { SIDJUA_VERSION } from "../../version.js";


export type CheckStatus = "pass" | "warn" | "fail" | "skip";

export interface CheckResult {
  name:                string;
  category:            string;
  status:              CheckStatus;
  message:             string;
  duration:            number;     // ms
  fixable:             boolean;
  fixAction?:          string | undefined;
  details?:            string | undefined;
}

export interface SelftestReport {
  timestamp:   string;
  version:     string;
  nodeVersion: string;
  platform:    string;
  healthScore: number;   // 0-100
  checks:      CheckResult[];
  summary: {
    total:   number;
    passed:  number;
    warned:  number;
    failed:  number;
    skipped: number;
  };
  recommendations: string[];
}

export interface SelftestContext {
  workDir: string;
  verbose: boolean;
  fix:     boolean;
  /**
   * When true, ProviderConnectivity will make live network requests to test
   * provider reachability. Opt-in to avoid unexpected network calls in CI/CD
   * or air-gapped environments. Also controlled by SIDJUA_SELFTEST_CONNECTIVITY=1.
   */
  checkConnectivity?: boolean;
}

export interface SelftestCheck {
  name:     string;
  category: string;
  run(ctx: SelftestContext): Promise<CheckResult>;
  fix?(ctx: SelftestContext): Promise<boolean>;
}


export class SelftestRunner {
  private readonly _checks: SelftestCheck[] = [];

  registerCheck(check: SelftestCheck): void {
    this._checks.push(check);
  }

  async run(ctx: SelftestContext): Promise<SelftestReport> {
    const results: CheckResult[] = [];

    for (const check of this._checks) {
      const start = Date.now();
      let result  = await this._runSafe(check, ctx, start);

      // If fix mode and check failed and has a fix function — fix then re-run
      if (ctx.fix && result.status === "fail" && result.fixable && check.fix !== undefined) {
        try {
          const fixed = await check.fix(ctx);
          if (fixed) {
            result = await this._runSafe(check, ctx, Date.now());
          }
        } catch (e: unknown) { void e; }
      }

      results.push(result);
    }

    return this._buildReport(results);
  }

  private async _runSafe(
    check: SelftestCheck,
    ctx:   SelftestContext,
    start: number,
  ): Promise<CheckResult> {
    try {
      return await check.run(ctx);
    } catch (e: unknown) {
      return {
        name:     check.name,
        category: check.category,
        status:   "fail",
        message:  e instanceof Error ? e.message : String(e),
        duration: Date.now() - start,
        fixable:  false,
      };
    }
  }

  private _buildReport(results: CheckResult[]): SelftestReport {
    const total   = results.length;
    const passed  = results.filter((r) => r.status === "pass").length;
    const warned  = results.filter((r) => r.status === "warn").length;
    const failed  = results.filter((r) => r.status === "fail").length;
    const skipped = results.filter((r) => r.status === "skip").length;

    const eligible   = total - skipped;
    const healthScore = eligible === 0
      ? 100
      : Math.min(100, Math.max(0, Math.round(((passed + warned * 0.5) / eligible) * 100)));

    // Recommendations: fixActions from failed checks, then warn checks
    const recommendations: string[] = [];
    for (const r of results) {
      if (r.status === "fail" && r.fixAction !== undefined) {
        recommendations.push(r.fixAction);
      }
    }
    for (const r of results) {
      if (r.status === "warn" && r.fixAction !== undefined) {
        recommendations.push(r.fixAction);
      }
    }

    return {
      timestamp:   new Date().toISOString(),
      version:     SIDJUA_VERSION,
      nodeVersion: process.version,
      platform:    process.platform,
      healthScore,
      checks:      results,
      summary:     { total, passed, warned, failed, skipped },
      recommendations,
    };
  }
}
