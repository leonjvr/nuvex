// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Governance selftest checks
 *
 * GovernanceRulesLoadable, PolicyEnforcementFunctional, DivisionConfigConsistent
 */

import { existsSync } from "node:fs";
import { join }       from "node:path";
import type { SelftestCheck, SelftestContext, CheckResult } from "../selftest-runner.js";

const CAT = "governance";

function now(): number { return Date.now(); }


export const GovernanceRulesLoadable: SelftestCheck = {
  name:     "Governance rules loadable",
  category: CAT,

  async run(ctx: SelftestContext): Promise<CheckResult> {
    const t      = now();
    const govDir = join(ctx.workDir, ".system", "governance");

    if (!existsSync(govDir)) {
      return {
        name:     this.name,
        category: CAT,
        status:   "skip",
        message:  "Governance directory not found — run: sidjua apply",
        duration: Date.now() - t,
        fixable:  false,
      };
    }

    try {
      const { loadVersionInfo } = await import("../../governance/rule-loader.js");
      const info = loadVersionInfo(govDir);
      if (info === null) {
        return {
          name:     this.name,
          category: CAT,
          status:   "warn",
          message:  `Governance VERSION file missing in ${govDir}`,
          duration: Date.now() - t,
          fixable:  false,
        };
      }
      return {
        name:     this.name,
        category: CAT,
        status:   "pass",
        message:  `Governance rules loaded — ruleset v${info.ruleset_version ?? "?"}`,
        duration: Date.now() - t,
        fixable:  false,
        details:  ctx.verbose ? `Governance dir: ${govDir}` : undefined,
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        name:     this.name,
        category: CAT,
        status:   "fail",
        message:  `Governance rules load failed: ${msg}`,
        duration: Date.now() - t,
        fixable:  false,
      };
    }
  },
};


export const PolicyEnforcementFunctional: SelftestCheck = {
  name:     "Policy enforcement functional",
  category: CAT,

  async run(ctx: SelftestContext): Promise<CheckResult> {
    const t = now();

    try {
      // Part 1: verify governance config is loadable from disk (when present)
      const { loadGovernanceConfig } = await import("../../../pipeline/config-loader.js");
      const configPath = join(ctx.workDir, ".system", "governance", "governance.yaml");

      if (!existsSync(configPath)) {
        return {
          name:     this.name,
          category: CAT,
          status:   "skip",
          message:  "Governance config not found — run: sidjua apply",
          duration: Date.now() - t,
          fixable:  false,
        };
      }

      loadGovernanceConfig(join(ctx.workDir, ".system", "governance"));

      // Part 2: functional enforcement test — verify evaluateAction() actually BLOCKs
      // forbidden actions, not just that the config loads.
      const { evaluateAction } = await import("../../../pipeline/index.js");
      type GovernanceConfig    = import("../../../types/pipeline.js").GovernanceConfig;
      type ActionRequest       = import("../../../types/pipeline.js").ActionRequest;
      type Database            = import("../../../utils/db.js").Database;

      const BetterSQLite3 = await import("better-sqlite3");
      const DatabaseCtor  = ((BetterSQLite3 as unknown as { default: new (p: string) => Database }).default
        ?? BetterSQLite3) as new (p: string) => Database;

      const testDb = new DatabaseCtor(":memory:");
      testDb.exec(`
        CREATE TABLE audit_trail (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          created_at     TEXT NOT NULL DEFAULT (datetime('now')),
          agent_id       TEXT NOT NULL,
          division_code  TEXT,
          action_type    TEXT NOT NULL,
          action_detail  TEXT NOT NULL,
          governance_check TEXT,
          input_summary  TEXT,
          output_summary TEXT,
          token_count    INTEGER,
          cost_usd       REAL,
          classification TEXT NOT NULL DEFAULT 'INTERNAL',
          parent_task_id TEXT,
          metadata       TEXT
        )
      `);

      const minimalConfig: GovernanceConfig = {
        forbidden: [
          { action: "data.delete", reason: "selftest block", escalate_to: "SYSTEM_BLOCK" },
        ],
        approval:  [],
        budgets:   {},
        classification: {
          levels: [{ code: "PUBLIC", rank: 0, description: "Public" }],
          agent_clearance: {},
        },
        policies:  [],
        loaded_at: new Date().toISOString(),
        file_hashes: {},
      };

      const testRequest: ActionRequest = {
        request_id:    "selftest-enforcement-check",
        timestamp:     new Date().toISOString(),
        agent_id:      "selftest-agent",
        agent_tier:    1,
        division_code: "general",
        action: {
          type:        "data.delete",
          target:      "selftest-target",
          description: "Selftest: verify forbidden action is blocked",
        },
        context: {
          division_code: "general",
          session_id:    "selftest-session",
        },
      };

      const result = evaluateAction(testRequest, minimalConfig, testDb);
      testDb.close();

      if (result.verdict !== "BLOCK" || result.blocking_stage !== "forbidden") {
        return {
          name:     this.name,
          category: CAT,
          status:   "fail",
          message:  `Policy enforcement test FAILED: expected BLOCK/forbidden, got ${result.verdict}/${result.blocking_stage ?? "none"}`,
          duration: Date.now() - t,
          fixable:  false,
        };
      }

      return {
        name:     this.name,
        category: CAT,
        status:   "pass",
        message:  "Pre-action pipeline configuration loadable and enforcement functional",
        duration: Date.now() - t,
        fixable:  false,
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        name:     this.name,
        category: CAT,
        status:   "warn",
        message:  `Policy enforcement check failed (may be expected on fresh install): ${msg}`,
        duration: Date.now() - t,
        fixable:  false,
      };
    }
  },
};


export const DivisionConfigConsistent: SelftestCheck = {
  name:     "Division configuration consistent",
  category: CAT,

  async run(ctx: SelftestContext): Promise<CheckResult> {
    const t = now();

    const candidates = [
      join(ctx.workDir, "divisions.yaml"),
      join(ctx.workDir, "config", "divisions.yaml"),
    ];
    const configPath = candidates.find((p) => existsSync(p));

    if (configPath === undefined) {
      return {
        name:     this.name,
        category: CAT,
        status:   "skip",
        message:  "divisions.yaml not found",
        duration: Date.now() - t,
        fixable:  false,
      };
    }

    try {
      const { readFileSync } = await import("node:fs");
      const { parse }        = await import("yaml");
      const raw  = readFileSync(configPath, "utf-8");
      const doc  = parse(raw) as Record<string, unknown> | null;

      if (doc === null || typeof doc !== "object") {
        return {
          name:     this.name,
          category: CAT,
          status:   "fail",
          message:  "divisions.yaml does not parse to an object",
          duration: Date.now() - t,
          fixable:  false,
        };
      }

      const divisions = doc["divisions"];
      if (!Array.isArray(divisions) || divisions.length === 0) {
        return {
          name:     this.name,
          category: CAT,
          status:   "warn",
          message:  "No divisions defined in divisions.yaml",
          duration: Date.now() - t,
          fixable:  false,
        };
      }

      const problems: string[] = [];
      for (const div of divisions as Array<Record<string, unknown>>) {
        if (!div["id"] && !div["name"]) {
          problems.push(`Division missing id/name: ${JSON.stringify(div).slice(0, 60)}`);
        }
      }

      if (problems.length > 0) {
        return {
          name:     this.name,
          category: CAT,
          status:   "fail",
          message:  `Division config issues: ${problems.join("; ")}`,
          duration: Date.now() - t,
          fixable:  false,
          details:  ctx.verbose ? problems.join("\n") : undefined,
        };
      }

      return {
        name:     this.name,
        category: CAT,
        status:   "pass",
        message:  `${(divisions as unknown[]).length} division(s) configured and consistent`,
        duration: Date.now() - t,
        fixable:  false,
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        name:     this.name,
        category: CAT,
        status:   "fail",
        message:  `Config consistency check failed: ${msg}`,
        duration: Date.now() - t,
        fixable:  false,
      };
    }
  },
};
