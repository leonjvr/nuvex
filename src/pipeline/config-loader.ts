// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Governance config loader
 *
 * Loads all governance YAML files from a governance/ base directory into a
 * single GovernanceConfig object suitable for passing to evaluateAction().
 *
 * Design:
 *   - Missing files → graceful fallback (empty rules / defaults)
 *   - Invalid YAML  → throws GovernanceError (keep previous config in caller)
 *   - File hashes tracked for optional change detection
 *   - Personal mode reads a single my-rules.yaml and converts to GovernanceConfig
 */

import { existsSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import type {
  ClassificationConfig,
  ClassificationLevel,
  ForbiddenRule,
  GovernanceConfig,
  MyRulesConfig,
  PersonalMemoryConfig,
  PersonalRule,
  PolicyConfig,
  PolicyRule,
  ScheduledPolicy,
  ApprovalWorkflow,
  SecurityConfig,
} from "../types/pipeline.js";
import { readYamlFile, readYamlFileWithHash } from "../utils/yaml.js";
import { GovernanceError } from "./errors.js";
import { createLogger } from "../core/logger.js";

const logger = createLogger("config-loader");


export const DEFAULT_CLASSIFICATION_LEVELS: ClassificationLevel[] = [
  { code: "PUBLIC",       rank: 0, description: "No restrictions" },
  { code: "INTERNAL",     rank: 1, description: "Company employees/agents only" },
  { code: "CONFIDENTIAL", rank: 2, description: "Need-to-know basis" },
  { code: "SECRET",       rank: 3, description: "Named individuals only" },
  { code: "FYEO",         rank: 4, description: "For Your Eyes Only — human only" },
];

export const DEFAULT_AGENT_CLEARANCE: Record<string, string> = {
  tier_1: "SECRET",
  tier_2: "CONFIDENTIAL",
  tier_3: "INTERNAL",
};

export const PERSONAL_CLASSIFICATION_DEFAULTS: ClassificationConfig = {
  levels: [
    { code: "PUBLIC",  rank: 0, description: "No restrictions" },
    { code: "PRIVATE", rank: 1, description: "Owner only" },
  ],
  agent_clearance: {
    tier_1: "PRIVATE",
    tier_2: "PRIVATE",
    tier_3: "PUBLIC",
  },
};


/**
 * Load all governance config from `basePath` (the governance/ directory).
 *
 * Expected structure:
 *   boundaries/forbidden-actions.yaml
 *   boundaries/approval-workflows.yaml
 *   classification/levels.yaml
 *   classification/rules.yaml
 *   policies/**\/*.yaml
 *
 * @throws GovernanceError with code CONFIG_INVALID if validation fails
 */
export function loadGovernanceConfig(basePath: string): GovernanceConfig {
  const fileHashes: Record<string, string> = {};

  // ---- Stage 1: Forbidden -------------------------------------------------
  const forbiddenPath = join(basePath, "boundaries", "forbidden-actions.yaml");
  let forbidden: ForbiddenRule[] = [];
  if (existsSync(forbiddenPath)) {
    const { parsed, contentHash } = loadYamlSafe(forbiddenPath, "forbidden-actions.yaml");
    fileHashes[relPath(basePath, forbiddenPath)] = contentHash;
    const raw = parsed as { forbidden?: unknown } | null;
    if (raw !== null && Array.isArray(raw?.forbidden)) {
      forbidden = raw.forbidden as ForbiddenRule[];
    }
  }

  // ---- Stage 2: Approval --------------------------------------------------
  const approvalPath = join(basePath, "boundaries", "approval-workflows.yaml");
  let approval: ApprovalWorkflow[] = [];
  if (existsSync(approvalPath)) {
    const { parsed, contentHash } = loadYamlSafe(approvalPath, "approval-workflows.yaml");
    fileHashes[relPath(basePath, approvalPath)] = contentHash;
    const raw = parsed as { workflows?: unknown } | null;
    if (raw !== null && Array.isArray(raw?.workflows)) {
      approval = raw.workflows as ApprovalWorkflow[];
    }
  }

  // ---- Stage 4: Classification --------------------------------------------
  const levelsPath = join(basePath, "classification", "levels.yaml");
  const rulesPath  = join(basePath, "classification", "rules.yaml");

  let classificationLevels = DEFAULT_CLASSIFICATION_LEVELS;
  let agentClearance       = DEFAULT_AGENT_CLEARANCE;
  let divisionOverrides: Record<string, Record<string, string>> | undefined;

  if (existsSync(levelsPath)) {
    const { parsed, contentHash } = loadYamlSafe(levelsPath, "levels.yaml");
    fileHashes[relPath(basePath, levelsPath)] = contentHash;
    const raw = parsed as { levels?: unknown } | null;
    if (raw !== null && Array.isArray(raw?.levels)) {
      classificationLevels = raw.levels as ClassificationLevel[];
    }
  }

  if (existsSync(rulesPath)) {
    const { parsed, contentHash } = loadYamlSafe(rulesPath, "rules.yaml");
    fileHashes[relPath(basePath, rulesPath)] = contentHash;
    const raw = parsed as {
      agent_clearance?: unknown;
      division_overrides?: unknown;
    } | null;
    if (raw !== null) {
      if (raw.agent_clearance !== null && typeof raw.agent_clearance === "object") {
        agentClearance = raw.agent_clearance as Record<string, string>;
      }
      if (raw.division_overrides !== null && typeof raw.division_overrides === "object") {
        divisionOverrides = raw.division_overrides as Record<string, Record<string, string>>;
      }
    }
  }

  // ---- Stage 5: Policies --------------------------------------------------
  const policiesDir = join(basePath, "policies");
  const policies    = loadAllPolicies(policiesDir, fileHashes, basePath);

  // ---- Stage 0: Security filter (optional — missing file = skipped) --------
  const securityPath = join(basePath, "security", "security.yaml");
  let security: SecurityConfig | undefined;
  if (existsSync(securityPath)) {
    const { parsed, contentHash } = loadYamlSafe(securityPath, "security/security.yaml");
    fileHashes[relPath(basePath, securityPath)] = contentHash;
    const raw = parsed as { filter?: unknown } | null;
    if (raw !== null && raw.filter !== null && typeof raw.filter === "object") {
      security = raw as SecurityConfig;
    }
  }

  const config: GovernanceConfig = {
    forbidden,
    approval,
    budgets:        {},
    classification: {
      levels:            classificationLevels,
      agent_clearance:   agentClearance,
      ...(divisionOverrides !== undefined ? { division_overrides: divisionOverrides } : {}),
    },
    policies,
    ...(security !== undefined ? { security } : {}),
    loaded_at:   new Date().toISOString(),
    file_hashes: fileHashes,
  };

  validateGovernanceConfig(config);
  return config;
}


/**
 * Load personal governance config from a single my-rules.yaml file.
 *
 * Personal mode uses a simplified classification scheme (PUBLIC/PRIVATE only)
 * and no separate policy files — all rules are in my-rules.yaml.
 */
export function loadPersonalGovernanceConfig(basePath: string): GovernanceConfig {
  const myRulesPath = join(basePath, "my-rules.yaml");

  if (!existsSync(myRulesPath)) {
    return {
      forbidden:      [],
      approval:       [],
      budgets:        {},
      classification: PERSONAL_CLASSIFICATION_DEFAULTS,
      policies:       [],
      loaded_at:      new Date().toISOString(),
      file_hashes:    {},
    };
  }

  const { parsed, contentHash } = loadYamlSafe(myRulesPath, "my-rules.yaml");
  const raw = parsed as MyRulesConfig | null;
  const rules: PersonalRule[] = raw?.my_rules ?? [];

  const forbidden: ForbiddenRule[] = rules
    .filter((r) => r.enforce === "block")
    .map(ruleToForbidden);

  const approval: ApprovalWorkflow[] = rules
    .filter((r) => r.enforce === "ask_first")
    .map(ruleToApproval);

  const policies: PolicyConfig[] = rules
    .filter((r) => r.enforce === "warn")
    .length > 0
    ? [{
        source_file: myRulesPath,
        rules:       rules
          .filter((r) => r.enforce === "warn")
          .map(ruleToPolicy),
      }]
    : [];

  return {
    forbidden,
    approval,
    budgets:        {},
    classification: PERSONAL_CLASSIFICATION_DEFAULTS,
    policies,
    loaded_at:      new Date().toISOString(),
    file_hashes:    { [relPath(basePath, myRulesPath)]: contentHash },
  };
}


/**
 * Recursively load all *.yaml files from `policiesDir`.
 * Each file becomes a PolicyConfig with the source_file path and its rules.
 */
function loadAllPolicies(
  policiesDir: string,
  fileHashes: Record<string, string>,
  basePath: string,
): PolicyConfig[] {
  if (!existsSync(policiesDir)) return [];

  const yamlFiles = listYamlFiles(policiesDir);
  const result: PolicyConfig[] = [];

  for (const filePath of yamlFiles) {
    const { parsed, contentHash } = loadYamlSafe(filePath, filePath);
    fileHashes[relPath(basePath, filePath)] = contentHash;
    const raw = parsed as { rules?: unknown } | null;
    const rules: PolicyRule[] = Array.isArray(raw?.rules)
      ? (raw.rules as PolicyRule[])
      : [];
    result.push({ source_file: filePath, rules });
  }

  return result;
}


/**
 * Extract all policies that have a `schedule` section from the policies directory.
 *
 * Scheduled policies are loaded by the ITBootstrapAgent/scheduler for cron
 * triggering. The same rules are also loaded by loadAllPolicies() for Stage 5.
 *
 * @param policiesDir  Path to governance/policies/ directory
 * @returns            Array of ScheduledPolicy objects (may be empty)
 */
export function loadScheduledPolicies(policiesDir: string): ScheduledPolicy[] {
  if (!existsSync(policiesDir)) return [];

  const yamlFiles = listYamlFiles(policiesDir);
  const result: ScheduledPolicy[] = [];

  for (const filePath of yamlFiles) {
    const { parsed } = loadYamlSafe(filePath, filePath);
    const raw = parsed as Record<string, unknown> | null;

    if (raw === null || raw["schedule"] === undefined) continue;

    const rules: PolicyRule[] = Array.isArray(raw["rules"])
      ? (raw["rules"] as PolicyRule[])
      : [];

    result.push({
      source_file: filePath,
      schedule:    raw["schedule"] as ScheduledPolicy["schedule"],
      thresholds:  (raw["thresholds"] as Record<string, unknown>) ?? {},
      retention:   (raw["retention"] as Record<string, unknown>) ?? {},
      archival:    (raw["archival"] as Record<string, unknown>) ?? {},
      compaction:  (raw["compaction"] as Record<string, unknown>) ?? {},
      rules,
    });
  }

  return result;
}


/**
 * Load the `memory:` section from a personal my-rules.yaml file.
 *
 * Returns null if the file does not exist or has no memory section.
 * Personal mode uses this instead of the full memory-hygiene.yaml.
 *
 * @param basePath  Directory containing my-rules.yaml
 */
export function loadPersonalMemoryConfig(basePath: string): PersonalMemoryConfig | null {
  const myRulesPath = join(basePath, "my-rules.yaml");

  if (!existsSync(myRulesPath)) return null;

  const { parsed } = loadYamlSafe(myRulesPath, "my-rules.yaml");
  const raw = parsed as MyRulesConfig | null;

  return raw?.memory ?? null;
}


/**
 * Read and parse a YAML file, converting errors into GovernanceError.
 */
function loadYamlSafe(
  filePath: string,
  label: string,
): { parsed: unknown; contentHash: string } {
  try {
    return readYamlFileWithHash(filePath);
  } catch (err) {
    throw new GovernanceError(
      "CONFIG_LOAD_FAILED",
      `Failed to load governance file "${label}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Recursively list all *.yaml files under a directory (non-symlinks only).
 */
function listYamlFiles(dir: string): string[] {
  const results: string[] = [];
  collectYamlFiles(dir, results);
  return results.sort(); // Deterministic order
}

function collectYamlFiles(dir: string, out: string[]): void {
  if (!existsSync(dir)) return;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch (e: unknown) {
    logger.debug("config-loader", "Could not read config directory — skipping", { metadata: { error: e instanceof Error ? e.message : String(e) } });
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    // Skip hidden files/dirs
    if (entry.startsWith(".")) continue;
    try {
      // Check if directory using readdirSync catching errors
      const subEntries = readdirSync(full);
      // It's a directory
      collectYamlFiles(full, out);
      void subEntries; // suppress unused
    } catch (e: unknown) { void e; /* cleanup-ignore: file vs directory detection — continue is control flow */
      // It's a file
      if (entry.endsWith(".yaml") || entry.endsWith(".yml")) {
        out.push(full);
      }
    }
  }
}

/** Compute a relative path label for file_hashes keys. */
function relPath(basePath: string, filePath: string): string {
  return relative(basePath, filePath);
}

/** Convert a PersonalRule with enforce=block to a ForbiddenRule. */
function ruleToForbidden(rule: PersonalRule): ForbiddenRule {
  return {
    action:      rule.action,
    reason:      rule.reason,
    escalate_to: "SYSTEM_BLOCK",
    ...(rule.condition !== undefined ? { condition: rule.condition } : {}),
  };
}

/** Convert a PersonalRule with enforce=ask_first to an ApprovalWorkflow. */
function ruleToApproval(rule: PersonalRule): ApprovalWorkflow {
  return {
    trigger: {
      action: rule.action,
      ...(rule.condition !== undefined ? { condition: rule.condition } : {}),
    },
    require:       "human",
    timeout_hours: 24,
  };
}

/** Convert a PersonalRule with enforce=warn to a PolicyRule. */
function ruleToPolicy(rule: PersonalRule): PolicyRule {
  return {
    id:           `personal.${rule.action}`,
    description:  rule.reason,
    action_types: [rule.action],
    check:        rule.condition ?? "always",
    enforcement:  "soft",
  };
}


/**
 * Validate the loaded governance config.
 * @throws GovernanceError with code CONFIG_INVALID on any violation
 */
function validateGovernanceConfig(config: GovernanceConfig): void {
  // Classification levels must have unique ranks
  const ranks = config.classification.levels.map((l) => l.rank);
  const uniqueRanks = new Set(ranks);
  if (ranks.length !== uniqueRanks.size) {
    throw new GovernanceError(
      "CONFIG_INVALID",
      "Classification levels must have unique ranks",
    );
  }

  // Each forbidden rule must have an action field
  for (const rule of config.forbidden) {
    if (!rule.action || typeof rule.action !== "string") {
      throw new GovernanceError(
        "CONFIG_INVALID",
        "Each forbidden rule must have a non-empty action field",
      );
    }
  }

  // Each approval workflow must have a trigger action
  for (const wf of config.approval) {
    if (!wf.trigger?.action || typeof wf.trigger.action !== "string") {
      throw new GovernanceError(
        "CONFIG_INVALID",
        "Each approval workflow must have a trigger.action field",
      );
    }
  }
}

/**
 * Re-export readYamlFile for callers that need raw YAML loading.
 */
export { readYamlFile };
