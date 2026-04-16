// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — OpenClaw Importer
 *
 * Orchestrates the full OpenClaw → SIDJUA migration:
 *   1. Find + parse openclaw.json
 *   2. Map model
 *   3. Derive agent ID / name
 *   4. Detect name collision
 *   5. Convert / classify skills
 *   6. Migrate credentials
 *   7. Create agent definition in DB
 *   8. Write skill file to disk
 *   9. Apply governance defaults
 *  10. Return ImportResult
 */

import { join, resolve }          from "node:path";
import { mkdir, writeFile }       from "node:fs/promises";
import { existsSync }             from "node:fs";
import { homedir }                from "node:os";
import { openCliDatabase }        from "../cli/utils/db-init.js";
import { AgentRegistry }          from "../agent-lifecycle/agent-registry.js";
import { runMigrations105 }       from "../agent-lifecycle/migration.js";
import { parseOpenClawConfig }    from "./openclaw-config-parser.js";
import { mapOpenClawModel }       from "./openclaw-model-mapper.js";
import {
  convertSkills,
  classifyConfigSkills,
}                                 from "./openclaw-skill-converter.js";
import { migrateCredentials }     from "./openclaw-credential-migrator.js";
import type {
  OpenClawImportOptions,
  ImportResult,
  SkillConvertResult,
  OpenClawChannels,
}                                 from "./openclaw-types.js";
import type { AgentLifecycleDefinition } from "../agent-lifecycle/types.js";
import { createLogger } from "../core/logger.js";

const logger = createLogger("openclaw-importer");


export const DEFAULT_OPENCLAW_CONFIG = join(homedir(), ".openclaw", "openclaw.json");


const GOVERNANCE_DEFAULTS = {
  preActionEnforcement: true,
  auditTrail:           true,
  budgetPerTask:        1.00,
};


/**
 * Derive a SIDJUA agent ID from a human name.
 * "Clawd V2" → "clawd-v2"
 */
export function deriveAgentId(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) // reasonable length limit
    || "imported-agent";
}


function detectChannels(config: { channels?: OpenClawChannels }): string[] {
  if (!config.channels) return [];
  return (Object.keys(config.channels) as Array<keyof OpenClawChannels>).filter(
    (ch) => config.channels![ch] !== null && config.channels![ch] !== undefined,
  );
}


function buildDefaultSkill(agentName: string, description: string): string {
  return [
    "---",
    `name: "${agentName}"`,
    `description: "${description}"`,
    `imported_from: "openclaw"`,
    "tier: 3",
    "role: \"General Purpose Agent\"",
    "---",
    "",
    `# ${agentName}`,
    "",
    "This agent was imported from OpenClaw and is now governed by SIDJUA.",
    "",
    "## Governance",
    "- All actions pass through the SIDJUA Pre-Action Pipeline",
    "- Audit trail is enabled",
    "- Budget limits are enforced",
    "",
    "## Capabilities",
    "- Execute assigned tasks within scope",
    "- Escalate when outside capabilities",
    "- Report results clearly",
    "",
  ].join("\n");
}


/**
 * Run the full OpenClaw import flow.
 * In dry-run mode: no files are created, no DB changes, no credentials stored.
 */
export async function importOpenClaw(options: OpenClawImportOptions): Promise<ImportResult> {
  const {
    configPath,
    skillsPath,
    workDir,
    dryRun,
    noSecrets,
    budgetUsd,
    tier,
    division,
    nameOverride,
    modelOverride,
  } = options;

  // ── Step 1: Parse config ─────────────────────────────────────────────────
  const config = await parseOpenClawConfig(configPath);

  // ── Step 2: Map model ────────────────────────────────────────────────────
  const rawModel = modelOverride
    ?? config.agent?.model?.primary
    ?? config.agent?.model?.fallback;

  if (!rawModel) {
    throw new Error(
      "No model configured in OpenClaw. " +
      "Specify with: sidjua import openclaw --model anthropic/claude-sonnet-4-5",
    );
  }
  const { provider, model } = mapOpenClawModel(rawModel);

  // Fallback model mapping
  const rawFallback = config.agent?.model?.fallback;
  let fallbackProvider: string | undefined;
  let fallbackModel:    string | undefined;
  if (rawFallback && rawFallback !== rawModel) {
    try {
      const fb = mapOpenClawModel(rawFallback);
      fallbackProvider = fb.provider;
      fallbackModel    = fb.model;
    } catch (e: unknown) {
      logger.debug("openclaw-importer", "Fallback model not mappable — using primary model only", { metadata: { error: e instanceof Error ? e.message : String(e) } });
    }
  }

  // ── Step 3: Derive agent ID / name ───────────────────────────────────────
  const rawName = nameOverride ?? config.identity?.name ?? "imported-agent";
  const agentId = deriveAgentId(rawName);
  const agentName = rawName;

  // ── Step 4: Name collision detection ─────────────────────────────────────
  if (!dryRun) {
    const db = openCliDatabase({ workDir });
    if (db === null) throw new Error("Database not found. Run 'sidjua apply' first.");
    db.pragma("foreign_keys = ON");
    runMigrations105(db);
    const registry = new AgentRegistry(db);
    const existing = registry.getById(agentId);
    if (existing) {
      throw new Error(
        `Agent '${agentId}' already exists. Use --name to specify a different name.`,
      );
    }
    db.close();
  }

  // ── Step 5: Classify / convert skills ────────────────────────────────────
  const skillResults: SkillConvertResult[] = [];

  // Skills directory scan (if path given or auto-detected from workspace)
  const autoSkillsDir = config.agent?.workspace
    ? join(config.agent.workspace, "skills")
    : null;
  const resolvedSkillsDir = skillsPath
    ?? (autoSkillsDir && existsSync(autoSkillsDir) ? autoSkillsDir : null);

  const destSkillDir = join(workDir, ".system", "imported-agents", agentId, "skills");

  if (resolvedSkillsDir && existsSync(resolvedSkillsDir)) {
    const fsResults = await convertSkills(resolvedSkillsDir, destSkillDir, dryRun);
    skillResults.push(...fsResults);
  } else if (config.skills?.entries) {
    // No filesystem directory — classify from config entries
    const configResults = classifyConfigSkills(config.skills.entries);
    skillResults.push(...configResults);
  }

  // ── Step 6: Migrate credentials ──────────────────────────────────────────
  const credResult = await migrateCredentials(config, workDir, noSecrets || dryRun);

  // ── Step 7 + 8: Write skill file + create agent in DB ────────────────────
  const agentSkillDir  = join(workDir, ".system", "imported-agents", agentId);
  const agentSkillPath = join(agentSkillDir, "main.skill.md");

  if (!dryRun) {
    // Write skill file
    await mkdir(agentSkillDir, { recursive: true });
    const skillContent = buildDefaultSkill(
      agentName,
      `Imported from OpenClaw — governed by SIDJUA`,
    );
    await writeFile(agentSkillPath, skillContent, "utf-8");

    // ── Step 9: Create agent definition ─────────────────────────────────────
    const def: AgentLifecycleDefinition = {
      schema_version: "1.0",
      id:             agentId,
      name:           agentName,
      description:    `Imported from OpenClaw. Original identity: ${config.identity?.name ?? "unknown"}`,
      tier,
      division,
      provider,
      model,
      capabilities:   ["execute", "escalate"],
      skill:          resolve(agentSkillPath),
      budget: {
        per_task_usd:  GOVERNANCE_DEFAULTS.budgetPerTask,
        per_hour_usd:  budgetUsd / 720,   // monthly → hourly (720h/mo)
        per_month_usd: budgetUsd,
      },
      max_classification: "CONFIDENTIAL",
      created_by: "openclaw-import",
    };

    if (fallbackProvider) def.fallback_provider = fallbackProvider;
    if (fallbackModel)    def.fallback_model    = fallbackModel;

    const db = openCliDatabase({ workDir });
    if (db === null) throw new Error("Database not found. Run 'sidjua apply' first.");
    db.pragma("foreign_keys = ON");
    runMigrations105(db);
    const registry = new AgentRegistry(db);
    registry.create(def, "openclaw-import");
    db.close();
  }

  // ── Step 10: Build result ─────────────────────────────────────────────────
  const imported       = skillResults.filter((s) => s.disposition === "imported").map((s) => s.name);
  const moduleRequired = skillResults
    .filter((s) => s.disposition === "module_required")
    .map((s) => ({ skill: s.name, module: s.moduleId! }));
  const skipped = skillResults.filter((s) => s.disposition === "skipped").map((s) => s.name);

  const channels = detectChannels(config);

  return {
    agent: { id: agentId, name: agentName, tier, division, provider, model },
    skills: { imported, moduleRequired, skipped },
    credentials: credResult,
    channels,
    governance: {
      ...GOVERNANCE_DEFAULTS,
      budgetMonthly: budgetUsd,
    },
  };
}
