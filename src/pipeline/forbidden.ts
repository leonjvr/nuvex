// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Stage 1: Forbidden Actions
 *
 * Checks the incoming action against the forbidden-actions.yaml config.
 * Fastest stage — simple pattern match with optional condition.
 * No overrides, no exceptions.
 *
 * Returns BLOCK if any rule matches; PASS otherwise.
 */

import type { ActionRequest, ForbiddenRule, StageResult } from "../types/pipeline.js";
import { matchAction } from "./matcher.js";
import { evaluateCondition } from "./condition-parser.js";

/** Source path label used in rule_source fields */
const FORBIDDEN_SOURCE = "governance/boundaries/forbidden-actions.yaml";


/**
 * Stage 1: Check whether the action is explicitly forbidden.
 *
 * @param request  The incoming action request
 * @param rules    Parsed forbidden-actions.yaml content
 * @returns        StageResult with PASS or BLOCK verdict
 */
export function checkForbidden(
  request: ActionRequest,
  rules: ForbiddenRule[],
): StageResult {
  const start = Date.now();
  const checks = [];

  for (const rule of rules) {
    const ruleId = `forbidden.${rule.action}`;

    // Step 1: pattern match
    if (!matchAction(request.action.type, rule.action)) {
      checks.push({
        rule_id:     ruleId,
        rule_source: FORBIDDEN_SOURCE,
        matched:     false,
        verdict:     "PASS" as const,
      });
      continue;
    }

    // Step 2: optional condition check
    if (rule.condition !== undefined) {
      const conditionMet = evaluateCondition(rule.condition, request);
      if (!conditionMet) {
        checks.push({
          rule_id:     ruleId,
          rule_source: FORBIDDEN_SOURCE,
          matched:     false,
          verdict:     "PASS" as const,
          reason:      "Condition not met",
        });
        continue;
      }
    }

    // Action is forbidden — short-circuit
    checks.push({
      rule_id:     ruleId,
      rule_source: FORBIDDEN_SOURCE,
      matched:     true,
      verdict:     "BLOCK" as const,
      reason:      rule.reason,
    });

    return {
      stage:         "forbidden",
      verdict:       "BLOCK",
      duration_ms:   Date.now() - start,
      rules_checked: checks,
    };
  }

  return {
    stage:         "forbidden",
    verdict:       "PASS",
    duration_ms:   Date.now() - start,
    rules_checked: checks,
  };
}
