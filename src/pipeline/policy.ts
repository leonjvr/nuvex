// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Stage 5: Policy Check
 *
 * Evaluates all active policy files against the action.
 * Most flexible stage — supports custom policy YAML via governance/policies/.
 *
 * Verdicts:
 *   PASS  — no applicable rules triggered
 *   WARN  — soft policy violations (action continues, warning emitted)
 *   BLOCK — hard policy violation
 *
 * Rules with check: "always" always trigger for matching action types.
 * Rules with a condition expression trigger when the condition evaluates false
 * (i.e., the action violates the policy).
 *
 * Short-circuit: first hard BLOCK terminates evaluation immediately.
 */

import type { ActionRequest, PolicyConfig, StageResult } from "../types/pipeline.js";
import { matchAction } from "./matcher.js";
import { evaluateCondition } from "./condition-parser.js";


/**
 * Stage 5: Check all active policy files for violations.
 *
 * @param request   The incoming action request
 * @param policies  All loaded PolicyConfig objects (one per YAML file)
 * @returns         StageResult with PASS, WARN, or BLOCK verdict
 */
export function checkPolicy(
  request: ActionRequest,
  policies: PolicyConfig[],
): StageResult {
  const start = Date.now();
  const checks = [];
  let worstVerdict: "PASS" | "WARN" | "BLOCK" = "PASS";

  for (const policy of policies) {
    for (const rule of policy.rules) {
      // Check whether this rule applies to the action type
      const applies = rule.action_types.some((pat) =>
        matchAction(request.action.type, pat),
      );
      if (!applies) continue;

      // Evaluate the check expression
      let violated = false;
      if (rule.check === "always") {
        // "always" means this rule always fires for matching action types
        violated = true;
      } else {
        // A condition check: violation = condition is FALSE
        // (the rule describes what SHOULD be true; false = violation)
        violated = !evaluateCondition(rule.check, request);
      }

      if (violated) {
        const verdict = rule.enforcement === "hard" ? "BLOCK" as const : "WARN" as const;

        checks.push({
          rule_id:     `policy.${rule.id}`,
          rule_source: policy.source_file,
          matched:     true,
          verdict,
          reason:      rule.description,
        });

        if (verdict === "BLOCK") {
          // Short-circuit: first hard violation terminates evaluation
          return {
            stage:         "policy",
            verdict:       "BLOCK",
            duration_ms:   Date.now() - start,
            rules_checked: checks,
          };
        }

        // Soft violation: upgrade worst verdict to WARN if still at PASS
        if (worstVerdict === "PASS") worstVerdict = "WARN";
      } else {
        checks.push({
          rule_id:     `policy.${rule.id}`,
          rule_source: policy.source_file,
          matched:     false,
          verdict:     "PASS" as const,
        });
      }
    }
  }

  return {
    stage:         "policy",
    verdict:       worstVerdict,
    duration_ms:   Date.now() - start,
    rules_checked: checks,
  };
}
