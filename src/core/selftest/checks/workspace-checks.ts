// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Workspace selftest checks
 *
 * WorkDirExists, ConfigFileValid, DatabasesAccessible, DirectoryStructure
 */

import { existsSync, accessSync, mkdirSync, readdirSync, constants } from "node:fs";
import { join } from "node:path";
import { openDatabase } from "../../../utils/db.js";
import type { SelftestCheck, SelftestContext, CheckResult } from "../selftest-runner.js";

const CAT = "workspace";


function now(): number { return Date.now(); }

function result(
  name: string,
  start: number,
  status: CheckResult["status"],
  message: string,
  extra: Partial<CheckResult> = {},
): CheckResult {
  return { name, category: CAT, status, message, duration: Date.now() - start, fixable: false, ...extra };
}


export const WorkDirExists: SelftestCheck = {
  name:     "Work directory exists and writable",
  category: CAT,

  async run(ctx: SelftestContext): Promise<CheckResult> {
    const t = now();
    if (!existsSync(ctx.workDir)) {
      return result(this.name, t, "fail", `Work directory does not exist: ${ctx.workDir}`, {
        fixable: false,
        fixAction: `Create the work directory: mkdir -p ${ctx.workDir}`,
      });
    }
    try {
      accessSync(ctx.workDir, constants.W_OK);
    } catch (e: unknown) {
      void e;
      return result(this.name, t, "fail", `Work directory is not writable: ${ctx.workDir}`);
    }
    return result(this.name, t, "pass", `Work directory OK: ${ctx.workDir}`);
  },
};


export const ConfigFileValid: SelftestCheck = {
  name:     "Configuration file valid",
  category: CAT,

  async run(ctx: SelftestContext): Promise<CheckResult> {
    const t = now();
    const candidates = [
      join(ctx.workDir, "divisions.yaml"),
      join(ctx.workDir, "config", "divisions.yaml"),
    ];

    const configPath = candidates.find((p) => existsSync(p));
    if (configPath === undefined) {
      return result(this.name, t, "warn", "divisions.yaml not found — run: sidjua init", {
        fixable:   true,
        fixAction: "Create workspace config: sidjua init",
      });
    }

    try {
      const { readFileSync } = await import("node:fs");
      const { parse }        = await import("yaml");
      const raw = readFileSync(configPath, "utf-8");
      const doc = parse(raw) as unknown;
      if (doc === null || typeof doc !== "object") throw new Error("YAML parsed to non-object");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return result(this.name, t, "fail", `Config parse error: ${msg}`);
    }

    return result(this.name, t, "pass", `Configuration file valid: ${configPath}`);
  },
};


export const DatabasesAccessible: SelftestCheck = {
  name:     "Databases accessible",
  category: CAT,

  async run(ctx: SelftestContext): Promise<CheckResult> {
    const t = now();
    const systemDir = join(ctx.workDir, ".system");

    if (!existsSync(systemDir)) {
      return result(this.name, t, "skip", "No .system directory — workspace not yet provisioned");
    }

    const dbFiles = readdirSync(systemDir)
      .filter((f) => f.endsWith(".db"))
      .map((f) => join(systemDir, f));

    if (dbFiles.length === 0) {
      return result(this.name, t, "skip", "No databases found — run: sidjua apply");
    }

    const failures: string[] = [];
    for (const dbPath of dbFiles) {
      try {
        const db = openDatabase(dbPath);
        const row = db.prepare("PRAGMA integrity_check").get() as { integrity_check: string } | undefined;
        db.close();
        if (row?.integrity_check !== "ok") {
          failures.push(`${dbPath}: integrity_check = ${row?.integrity_check}`);
        }
      } catch (e: unknown) {
        failures.push(`${dbPath}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    if (failures.length > 0) {
      return result(this.name, t, "fail", `Database integrity failures:\n  ${failures.join("\n  ")}`, {
        details: failures.join("\n"),
      });
    }

    return result(this.name, t, "pass", `${dbFiles.length} database(s) accessible and healthy`, {
      details: ctx.verbose ? `Checked: ${dbFiles.join(", ")}` : undefined,
    });
  },
};


const EXPECTED_DIRS = ["agents", "divisions", "backups", ".system"];

export const DirectoryStructure: SelftestCheck = {
  name:     "Directory structure",
  category: CAT,

  async run(ctx: SelftestContext): Promise<CheckResult> {
    const t       = now();
    const missing = EXPECTED_DIRS.filter((d) => !existsSync(join(ctx.workDir, d)));

    if (missing.length > 0) {
      return result(this.name, t, "fail", `Missing directories: ${missing.join(", ")}`, {
        fixable:   true,
        fixAction: `Create missing directories: ${missing.map((d) => join(ctx.workDir, d)).join(", ")}`,
        details:   ctx.verbose ? `Expected: ${EXPECTED_DIRS.join(", ")}` : undefined,
      });
    }

    return result(this.name, t, "pass", "Directory structure OK");
  },

  async fix(ctx: SelftestContext): Promise<boolean> {
    const missing = EXPECTED_DIRS.filter((d) => !existsSync(join(ctx.workDir, d)));
    for (const d of missing) {
      mkdirSync(join(ctx.workDir, d), { recursive: true });
    }
    return true;
  },
};
