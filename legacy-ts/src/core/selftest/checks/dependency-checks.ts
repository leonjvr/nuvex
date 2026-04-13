// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Dependency selftest checks
 *
 * NodeModulesPresent, CriticalDepsVersions
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SelftestCheck, SelftestContext, CheckResult } from "../selftest-runner.js";

const CAT = "dependency";

/** Minimum expected package count in node_modules (sanity threshold). */
const MIN_PACKAGE_COUNT = 50;

/** Critical deps whose versions we validate. */
const CRITICAL_DEPS = ["commander", "hono", "better-sqlite3", "yaml"];

function now(): number { return Date.now(); }

/** Find the project root (directory containing node_modules) by walking up. */
function findNodeModulesDir(startDir: string): string | undefined {
  let current = startDir;
  for (let i = 0; i < 8; i++) {
    const candidate = join(current, "node_modules");
    if (existsSync(candidate)) return candidate;
    const parent = join(current, "..");
    if (parent === current) break;
    current = parent;
  }
  return undefined;
}


export const NodeModulesPresent: SelftestCheck = {
  name:     "Node modules present",
  category: CAT,

  async run(ctx: SelftestContext): Promise<CheckResult> {
    const t      = now();
    const nmDir  = findNodeModulesDir(ctx.workDir) ?? findNodeModulesDir(process.cwd());

    if (nmDir === undefined) {
      return {
        name:      this.name,
        category:  CAT,
        status:    "fail",
        message:   "node_modules directory not found — run: npm install",
        duration:  Date.now() - t,
        fixable:   false,
        fixAction: "Install dependencies: npm install",
      };
    }

    const pkgCount = readdirSync(nmDir).filter((e) => !e.startsWith(".")).length;

    if (pkgCount < MIN_PACKAGE_COUNT) {
      return {
        name:      this.name,
        category:  CAT,
        status:    "warn",
        message:   `node_modules has only ${pkgCount} packages (expected ≥ ${MIN_PACKAGE_COUNT}) — run: npm install`,
        duration:  Date.now() - t,
        fixable:   false,
        fixAction: "Re-install dependencies: npm install",
      };
    }

    return {
      name:     this.name,
      category: CAT,
      status:   "pass",
      message:  `${pkgCount} packages installed`,
      duration: Date.now() - t,
      fixable:  false,
      details:  ctx.verbose ? `node_modules: ${nmDir}` : undefined,
    };
  },
};


export const CriticalDepsVersions: SelftestCheck = {
  name:     "Critical dependency versions",
  category: CAT,

  async run(ctx: SelftestContext): Promise<CheckResult> {
    const t     = now();
    const nmDir = findNodeModulesDir(ctx.workDir) ?? findNodeModulesDir(process.cwd());

    if (nmDir === undefined) {
      return {
        name:     this.name,
        category: CAT,
        status:   "skip",
        message:  "node_modules not found",
        duration: Date.now() - t,
        fixable:  false,
      };
    }

    const missing: string[]   = [];
    const found:   string[]   = [];

    for (const dep of CRITICAL_DEPS) {
      const pkgJson = join(nmDir, dep, "package.json");
      if (!existsSync(pkgJson)) {
        missing.push(dep);
        continue;
      }
      try {
        const meta = JSON.parse(readFileSync(pkgJson, "utf-8")) as { version?: string };
        found.push(`${dep}@${meta.version ?? "?"}`);
      } catch (e: unknown) {
        void e;
        missing.push(dep);
      }
    }

    if (missing.length > 0) {
      return {
        name:      this.name,
        category:  CAT,
        status:    "fail",
        message:   `Missing critical dependencies: ${missing.join(", ")}`,
        duration:  Date.now() - t,
        fixable:   false,
        fixAction: `Install missing packages: npm install ${missing.join(" ")}`,
      };
    }

    return {
      name:     this.name,
      category: CAT,
      status:   "pass",
      message:  found.join(", "),
      duration: Date.now() - t,
      fixable:  false,
      details:  ctx.verbose ? found.join("\n") : undefined,
    };
  },
};
