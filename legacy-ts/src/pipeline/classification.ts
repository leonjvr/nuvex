// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Stage 4: Data Classification Check
 *
 * Determines the data classification of the action and verifies that the
 * requesting agent has sufficient clearance.
 *
 * Rules:
 *   - FYEO always blocks ALL agents (human-only data)
 *   - Agent clearance is determined by tier + optional division override
 *   - Cross-division access auto-elevates to CONFIDENTIAL minimum
 *   - Unknown classification → CONFIDENTIAL (fail-safe: restrict unknown)
 */

import type {
  ActionRequest,
  ClassificationConfig,
  ClassificationLevel,
  StageResult,
} from "../types/pipeline.js";
import { ACTION_TYPES } from "../types/pipeline.js";

const CLASSIFICATION_SOURCE = "governance/classification/rules.yaml";


/**
 * Stage 4: Verify the agent has clearance for the data classification of the action.
 *
 * @param request  The incoming action request
 * @param config   Classification levels + agent clearance config
 * @returns        StageResult with PASS or BLOCK verdict
 */
export function checkClassification(
  request: ActionRequest,
  config: ClassificationConfig,
): StageResult {
  const start = Date.now();
  const checks = [];

  const dataClass = resolveClassification(request, config);

  // FYEO is absolute — all agents blocked
  if (dataClass === "FYEO") {
    checks.push({
      rule_id:     "classification.fyeo",
      rule_source: CLASSIFICATION_SOURCE,
      matched:     true,
      verdict:     "BLOCK" as const,
      reason:      "FYEO data requires human access — agents cannot access this",
    });
    return {
      stage:         "classification",
      verdict:       "BLOCK",
      duration_ms:   Date.now() - start,
      rules_checked: checks,
    };
  }

  // Determine agent clearance (division override > tier default)
  const tierKey  = `tier_${request.agent_tier}`;
  let clearance: string;

  const divOverride = config.division_overrides?.[request.division_code];
  const overrideValue = divOverride !== undefined ? divOverride[tierKey] : undefined;

  if (overrideValue !== undefined) {
    clearance = overrideValue;
  } else {
    clearance = config.agent_clearance[tierKey] ?? "PUBLIC";
  }

  const dataRank      = getRank(dataClass,  config.levels);
  const clearanceRank = getRank(clearance,  config.levels);

  if (dataRank > clearanceRank) {
    checks.push({
      rule_id:     "classification.insufficient_clearance",
      rule_source: CLASSIFICATION_SOURCE,
      matched:     true,
      verdict:     "BLOCK" as const,
      reason:      `Agent tier ${request.agent_tier} (clearance: ${clearance}) cannot access ${dataClass} data`,
    });
    return {
      stage:         "classification",
      verdict:       "BLOCK",
      duration_ms:   Date.now() - start,
      rules_checked: checks,
    };
  }

  checks.push({
    rule_id:     "classification.check",
    rule_source: CLASSIFICATION_SOURCE,
    matched:     false,
    verdict:     "PASS" as const,
    reason:      `Agent clearance ${clearance} >= data classification ${dataClass}`,
  });

  return {
    stage:         "classification",
    verdict:       "PASS",
    duration_ms:   Date.now() - start,
    rules_checked: checks,
  };
}


/**
 * Determine the data classification of the action.
 *
 * Priority:
 *   1. Explicitly set in action descriptor
 *   2. Cross-division access → CONFIDENTIAL minimum
 *   3. Default from ACTION_TYPES registry
 *   4. Unknown action type → CONFIDENTIAL (fail-safe)
 */
export function resolveClassification(
  request: ActionRequest,
  config: ClassificationConfig,
): string {
  // 1. Explicit classification in the request
  if (request.action.data_classification !== undefined) {
    return request.action.data_classification;
  }

  // 2. Cross-division access auto-elevates to CONFIDENTIAL
  if (
    request.context.target_division !== undefined &&
    request.context.target_division !== request.context.division_code
  ) {
    return "CONFIDENTIAL";
  }

  // 3. Look up from ACTION_TYPES registry
  const actionType = request.action.type as keyof typeof ACTION_TYPES;
  const fromRegistry = actionType in ACTION_TYPES
    ? ACTION_TYPES[actionType].default_classification
    : "CONFIDENTIAL";

  // 4. Validate resolved classification against configured levels.
  //    If this mode doesn't define the classification (e.g. personal mode has
  //    only PUBLIC/PRIVATE but ACTION_TYPES returns INTERNAL), fall back to
  //    the most permissive known level so the mode's intent is preserved.
  if (config.levels.find((l) => l.code === fromRegistry) !== undefined) {
    return fromRegistry;
  }

  const minLevel = config.levels.reduce<ClassificationLevel | undefined>(
    (min, l) => (min === undefined || l.rank < min.rank ? l : min),
    undefined,
  );
  return minLevel?.code ?? "PUBLIC";
}


/**
 * Return the numeric rank of a classification code.
 * Unknown codes get rank 99 (most restricted = safest default).
 */
export function getRank(code: string, levels: ClassificationLevel[]): number {
  const level = levels.find((l) => l.code === code);
  return level !== undefined ? level.rank : 99;
}
