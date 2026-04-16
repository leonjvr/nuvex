// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Governance Rule Loader (Extension Pattern)
 *
 * Loads and merges system (mandatory baseline) and user governance rules.
 *
 * Rules:
 *   - System rules are IMMUTABLE — users can never disable or weaken them
 *   - User rules may only ADD new rule IDs (extend the baseline)
 *   - ID collision → system wins; user rule is ignored with a logged conflict
 *   - User rule in same category as mandatory system rule with enforcement=advisory
 *     → rejected (categories with mandatory system rules require mandatory enforcement)
 *   - mergedRules = systemRules + validUserRules (conflicts excluded)
 *
 * Loading sources:
 *   system/governance/*.yaml    → system rules (tagged source: 'system')
 *   data/governance/policies/*.yaml
 *   data/governance/policies/custom/*.yaml → user rules (tagged source: 'user')
 */

import { existsSync, readdirSync, readFileSync, lstatSync } from "node:fs";
import { join }                                  from "node:path";
import { parse as parseYaml }                    from "yaml";
import { createLogger }                          from "../logger.js";
import { reportError }                           from "../telemetry/telemetry-reporter.js";

const logger = createLogger("rule-loader");


export type RuleSeverity   = "critical" | "high" | "medium" | "low";
export type RuleEnforcement = "mandatory" | "advisory";
export type RuleSource      = "system" | "user";

export interface GovernanceRule {
  id:          string;
  name:        string;
  description: string;
  enforcement: RuleEnforcement;
  severity:    RuleSeverity;
  category:    string;
  source:      RuleSource;
  /** YAML file this rule was loaded from */
  sourceFile:  string;
}

export interface RuleConflict {
  systemRule: GovernanceRule;
  userRule:   Omit<GovernanceRule, "source">;
  reason:     string;
}

export interface GovernanceRuleset {
  systemRules:     GovernanceRule[];
  userRules:       GovernanceRule[];
  mergedRules:     GovernanceRule[];
  rulesetVersion:  string;
  conflicts:       RuleConflict[];
}

export interface GovernanceVersionInfo {
  ruleset_version:         string;
  compatible_sidjua_min:   string;
  compatible_sidjua_max:   string;
  released:                string;
  rules_count:             number;
  changelog:               string;
}


interface RawRule {
  id:          unknown;
  name:        unknown;
  description: unknown;
  enforcement: unknown;
  severity:    unknown;
  category:    unknown;
}

interface RawGovernanceFile {
  rules?: unknown;
}


/**
 * Load and merge system + user governance rules.
 *
 * @param systemGovernanceDir  Path to system/governance/ (from SidjuaPaths)
 * @param dataGovernanceDir    Path to data/governance/ (from SidjuaPaths)
 */
export function loadGovernanceRuleset(
  systemGovernanceDir: string,
  dataGovernanceDir:   string,
): GovernanceRuleset {
  const rulesetVersion = loadRulesetVersion(systemGovernanceDir);
  const systemRules    = loadRulesFromDir(systemGovernanceDir, "system");
  const userRulesRaw   = loadUserRules(dataGovernanceDir);

  const conflicts: RuleConflict[] = [];
  const validUserRules: GovernanceRule[] = [];

  // Build lookup structures for conflict detection
  const systemRuleIds = new Set(systemRules.map((r) => r.id));
  const mandatoryCategories = new Set(
    systemRules
      .filter((r) => r.enforcement === "mandatory")
      .map((r) => r.category),
  );

  for (const userRule of userRulesRaw) {
    // Conflict: same ID as system rule
    if (systemRuleIds.has(userRule.id)) {
      const systemRule = systemRules.find((r) => r.id === userRule.id)!;
      const conflict: RuleConflict = {
        systemRule,
        userRule,
        reason: `User rule uses same ID as system rule "${userRule.id}" — system rule takes precedence`,
      };
      conflicts.push(conflict);
      logger.warn("rule-loader", `CONFLICT: ${conflict.reason}`, {
        metadata: { user_file: userRule.sourceFile },
      });
      continue;
    }

    // Conflict: user rule tries to set enforcement=advisory for a mandatory category
    if (
      userRule.enforcement === "advisory" &&
      mandatoryCategories.has(userRule.category)
    ) {
      const systemRule = systemRules.find((r) => r.category === userRule.category && r.enforcement === "mandatory")!;
      const conflict: RuleConflict = {
        systemRule,
        userRule,
        reason:
          `User rule "${userRule.id}" sets enforcement=advisory in category ` +
          `"${userRule.category}" which has mandatory system rules — user rule ignored`,
      };
      conflicts.push(conflict);
      logger.warn("rule-loader", `CONFLICT: ${conflict.reason}`, {
        metadata: { user_file: userRule.sourceFile },
      });
      continue;
    }

    validUserRules.push({ ...userRule, source: "user" });
  }

  const mergedRules = [...systemRules, ...validUserRules];

  logger.info("rule-loader", "Governance ruleset loaded", {
    metadata: {
      system_rules:    systemRules.length,
      user_rules:      validUserRules.length,
      conflicts:       conflicts.length,
      ruleset_version: rulesetVersion,
    },
  });

  return {
    systemRules,
    userRules:   validUserRules,
    mergedRules,
    rulesetVersion,
    conflicts,
  };
}


/**
 * Read the governance VERSION file and return the ruleset_version string.
 * Returns "unknown" if the file is missing or malformed.
 */
export function loadRulesetVersion(systemGovernanceDir: string): string {
  const versionPath = join(systemGovernanceDir, "VERSION");
  if (!existsSync(versionPath)) return "unknown";

  try {
    const raw  = readFileSync(versionPath, "utf-8");
    const info = JSON.parse(raw) as GovernanceVersionInfo;
    return info.ruleset_version ?? "unknown";
  } catch (e: unknown) {
    logger.debug("rule-loader", "Governance VERSION file parse failed — returning unknown", { metadata: { error: e instanceof Error ? e.message : String(e), versionPath } });
    return "unknown";
  }
}

/**
 * Read and return the full governance VERSION info object.
 * Returns null if the file is missing or malformed.
 */
export function loadVersionInfo(systemGovernanceDir: string): GovernanceVersionInfo | null {
  const versionPath = join(systemGovernanceDir, "VERSION");
  if (!existsSync(versionPath)) return null;

  try {
    const raw = readFileSync(versionPath, "utf-8");
    return JSON.parse(raw) as GovernanceVersionInfo;
  } catch (e: unknown) {
    logger.debug("rule-loader", "Governance VERSION info parse failed — returning null", { metadata: { error: e instanceof Error ? e.message : String(e), versionPath } });
    return null;
  }
}


/**
 * Load all governance rules from *.yaml files in the given directory.
 * Skips malformed files (logs a warning) rather than throwing.
 */
function loadRulesFromDir(dir: string, source: RuleSource): GovernanceRule[] {
  if (!existsSync(dir)) return [];

  const yamlFiles = listYamlFiles(dir);
  const rules: GovernanceRule[] = [];

  for (const filePath of yamlFiles) {
    try {
      const content = readFileSync(filePath, "utf-8");
      const parsed  = parseYaml(content) as RawGovernanceFile | null;

      if (parsed === null || !Array.isArray(parsed.rules)) continue;

      for (const raw of parsed.rules as RawRule[]) {
        if (!validateRuleSchema(raw, filePath)) continue;
        const rule = parseRule(raw, filePath, source);
        if (rule !== null) {
          rules.push(rule);
        }
      }
    } catch (e: unknown) {
      logger.warn("rule-loader", `Failed to load governance file "${filePath}"`, {
        error: { code: "LOAD_FAILED", message: e instanceof Error ? e.message : String(e) },
      });
      reportError(e instanceof Error ? e : new Error(String(e)), 'high');
    }
  }

  return rules;
}


/**
 * Load user rules from data/governance/policies/ and
 * data/governance/policies/custom/.
 */
function loadUserRules(dataGovernanceDir: string): (Omit<GovernanceRule, "source">)[] {
  const policiesDir = join(dataGovernanceDir, "policies");
  const customDir   = join(dataGovernanceDir, "policies", "custom");

  const dirs = [policiesDir, customDir];
  const rules: (Omit<GovernanceRule, "source">)[] = [];

  for (const dir of dirs) {
    if (!existsSync(dir)) continue;

    const yamlFiles = listYamlFiles(dir, false); // non-recursive — process dirs explicitly
    for (const filePath of yamlFiles) {
      try {
        const content = readFileSync(filePath, "utf-8");
        const parsed  = parseYaml(content) as RawGovernanceFile | null;

        if (parsed === null || !Array.isArray(parsed.rules)) continue;

        for (const raw of parsed.rules as RawRule[]) {
          if (!validateRuleSchema(raw, filePath)) continue;
          const rule = parseRule(raw, filePath, "user");
          if (rule !== null) {
            rules.push(rule);
          }
        }
      } catch (e: unknown) {
        logger.warn("rule-loader", `Failed to load user governance file "${filePath}"`, {
          error: { code: "LOAD_FAILED", message: e instanceof Error ? e.message : String(e) },
        });
      }
    }
  }

  return rules;
}


const VALID_ENFORCEMENTS = new Set<string>(["mandatory", "advisory"]);

/**
 * Check that a raw rule object has the minimum required fields and valid values.
 * Logs a warning and returns false for any rule that fails — parseRule is
 * not called for invalid rules so malformed YAML cannot cause partial state.
 *
 * `id` is the only truly required field; all other fields have safe defaults in parseRule.
 * If `enforcement` is present it must be a valid value — invalid values produce a warning.
 */
function validateRuleSchema(raw: unknown, filePath: string): boolean {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    logger.warn("rule-loader", `Rule entry is not an object in "${filePath}" — skipping`);
    return false;
  }
  const rule = raw as Record<string, unknown>;

  if (typeof rule["id"] !== "string" || (rule["id"] as string).trim() === "") {
    logger.warn("rule-loader", `Rule missing required 'id' field in "${filePath}" — skipping`);
    return false;
  }

  // If enforcement is present, validate it; if absent, parseRule will default to 'advisory'
  if ("enforcement" in rule && !VALID_ENFORCEMENTS.has(rule["enforcement"] as string)) {
    logger.warn("rule-loader", `Rule '${rule["id"]}' has invalid enforcement '${rule["enforcement"]}' in "${filePath}" — skipping`);
    return false;
  }

  return true;
}


const VALID_SEVERITIES = new Set<string>(["critical", "high", "medium", "low"]);

function parseRule(
  raw: RawRule,
  sourceFile: string,
  source: RuleSource,
): GovernanceRule | null {
  if (typeof raw.id !== "string" || raw.id.trim().length === 0) return null;

  const enforcement = typeof raw.enforcement === "string" && VALID_ENFORCEMENTS.has(raw.enforcement)
    ? (raw.enforcement as RuleEnforcement)
    : "advisory";

  const severity = typeof raw.severity === "string" && VALID_SEVERITIES.has(raw.severity)
    ? (raw.severity as RuleSeverity)
    : "medium";

  return {
    id:          raw.id.trim(),
    name:        typeof raw.name        === "string" ? raw.name.trim()        : raw.id.trim(),
    description: typeof raw.description === "string" ? raw.description.trim() : "",
    enforcement,
    severity,
    category:    typeof raw.category === "string" ? raw.category.trim() : "general",
    source,
    sourceFile,
  };
}


/**
 * List *.yaml / *.yml files in a directory (non-recursive by default).
 */
function listYamlFiles(dir: string, recursive = false): string[] {
  if (!existsSync(dir)) return [];

  const results: string[] = [];
  collectYaml(dir, results, recursive, 0);
  return results.sort();
}

function collectYaml(dir: string, out: string[], recursive: boolean, depth: number): void {
  if (depth > 5) return; // circular-reference / excessive depth guard

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch (e: unknown) {
    logger.debug("rule-loader", "Could not read governance directory — skipping", {
      metadata: { error: e instanceof Error ? e.message : String(e), dir },
    });
    return;
  }

  for (const entry of entries) {
    if (entry.startsWith(".")) continue;
    const full = join(dir, entry);

    let isDir = false;
    try {
      isDir = lstatSync(full).isDirectory();
    } catch (_e) {
      continue; // cleanup-ignore: lstatSync failure means entry is inaccessible — skip (race condition, permission error)
    }

    if (isDir) {
      if (recursive) {
        collectYaml(full, out, recursive, depth + 1);
      }
    } else if (entry.endsWith(".yaml") || entry.endsWith(".yml")) {
      out.push(full);
    }
  }
}
