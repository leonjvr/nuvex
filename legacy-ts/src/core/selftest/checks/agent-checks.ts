// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Agent selftest checks
 *
 * AgentDatabaseIntegrity, AgentConfigValid
 * Skipped when no agents exist.
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { openDatabase } from "../../../utils/db.js";
import type { SelftestCheck, SelftestContext, CheckResult } from "../selftest-runner.js";

const CAT = "agent";

function now(): number { return Date.now(); }

function getAgentDirs(workDir: string): string[] {
  const agentsDir = join(workDir, "agents");
  if (!existsSync(agentsDir)) return [];
  return readdirSync(agentsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => join(agentsDir, e.name));
}


export const AgentDatabaseIntegrity: SelftestCheck = {
  name:     "Agent database integrity",
  category: CAT,

  async run(ctx: SelftestContext): Promise<CheckResult> {
    const t         = now();
    const agentDirs = getAgentDirs(ctx.workDir);

    if (agentDirs.length === 0) {
      return {
        name:     this.name,
        category: CAT,
        status:   "skip",
        message:  "No agents found",
        duration: Date.now() - t,
        fixable:  false,
      };
    }

    const failures: string[] = [];

    for (const agentDir of agentDirs) {
      const dbFiles = readdirSync(agentDir)
        .filter((f) => f.endsWith(".db"))
        .map((f) => join(agentDir, f));

      for (const dbPath of dbFiles) {
        try {
          const db  = openDatabase(dbPath);
          const row = db.prepare("PRAGMA integrity_check").get() as { integrity_check: string } | undefined;
          db.close();
          if (row?.integrity_check !== "ok") {
            failures.push(`${dbPath}: ${row?.integrity_check}`);
          }
        } catch (e: unknown) {
          failures.push(`${dbPath}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }

    if (failures.length > 0) {
      return {
        name:     this.name,
        category: CAT,
        status:   "fail",
        message:  `Agent DB integrity failures: ${failures.join("; ")}`,
        duration: Date.now() - t,
        fixable:  false,
        details:  ctx.verbose ? failures.join("\n") : undefined,
      };
    }

    return {
      name:     this.name,
      category: CAT,
      status:   "pass",
      message:  `${agentDirs.length} agent database(s) healthy`,
      duration: Date.now() - t,
      fixable:  false,
    };
  },
};


export const AgentConfigValid: SelftestCheck = {
  name:     "Agent configuration valid",
  category: CAT,

  async run(ctx: SelftestContext): Promise<CheckResult> {
    const t         = now();
    const agentDirs = getAgentDirs(ctx.workDir);

    if (agentDirs.length === 0) {
      return {
        name:     this.name,
        category: CAT,
        status:   "skip",
        message:  "No agents found",
        duration: Date.now() - t,
        fixable:  false,
      };
    }

    const invalid: string[] = [];

    for (const agentDir of agentDirs) {
      const configPath = join(agentDir, "agent.yaml");
      if (!existsSync(configPath)) {
        // Some agents may not have a standalone config file (config in DB)
        continue;
      }
      try {
        const { readFileSync } = await import("node:fs");
        const { parse }        = await import("yaml");
        const raw = readFileSync(configPath, "utf-8");
        const cfg = parse(raw) as Record<string, unknown> | null;
        if (cfg === null || typeof cfg !== "object") {
          invalid.push(`${agentDir}: parsed to non-object`);
        } else if (!cfg["id"] && !cfg["name"]) {
          invalid.push(`${agentDir}: missing id/name field`);
        }
      } catch (e: unknown) {
        invalid.push(`${agentDir}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    if (invalid.length > 0) {
      return {
        name:     this.name,
        category: CAT,
        status:   "fail",
        message:  `Invalid agent configs: ${invalid.join("; ")}`,
        duration: Date.now() - t,
        fixable:  false,
        details:  ctx.verbose ? invalid.join("\n") : undefined,
      };
    }

    return {
      name:     this.name,
      category: CAT,
      status:   "pass",
      message:  `${agentDirs.length} agent(s) configuration OK`,
      duration: Date.now() - t,
      fixable:  false,
    };
  },
};
