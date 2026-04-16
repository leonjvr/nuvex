// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 10.6: PolicyValidator
 * Conflict detection (two rules contradict), dead rule detection.
 * Pure logic — no LLM calls.
 */

import type { PolicyRuleDB, PolicyRuleInput } from "../types.js";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  conflicts: ConflictInfo[];
  dead_rules: number[];
}

export interface ConflictInfo {
  rule_a_id: number | string;
  rule_b_id: number | string;
  reason: string;
}

export class PolicyValidator {
  validate(rules: PolicyRuleDB[], newRule?: PolicyRuleInput): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const conflicts: ConflictInfo[] = [];
    const deadRules: number[] = [];

    // Check for conflicts between existing rules
    for (let i = 0; i < rules.length; i++) {
      for (let j = i + 1; j < rules.length; j++) {
        const ruleA = rules[i]!;
        const ruleB = rules[j]!;
        const conflict = this._detectConflict(ruleA, ruleB);
        if (conflict !== null) {
          conflicts.push({ rule_a_id: ruleA.id, rule_b_id: ruleB.id, reason: conflict });
        }
      }
    }

    // Check new rule against existing rules
    if (newRule !== undefined) {
      for (const existing of rules) {
        const conflict = this._detectConflictWithInput(existing, newRule);
        if (conflict !== null) {
          conflicts.push({ rule_a_id: existing.id, rule_b_id: "new", reason: conflict });
        }
      }
    }

    // Dead rule detection: rules with contradictory conditions
    for (const rule of rules) {
      if (this._isDeadRule(rule, rules)) {
        deadRules.push(rule.id);
        warnings.push(
          `Rule #${rule.id} appears to be a dead rule (never matches due to conflicting conditions)`,
        );
      }
    }

    if (conflicts.length > 0) {
      errors.push(`Found ${conflicts.length} conflicting rule pair(s)`);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      conflicts,
      dead_rules: deadRules,
    };
  }

  private _detectConflict(a: PolicyRuleDB, b: PolicyRuleDB): string | null {
    // Same action pattern, contradictory enforcement
    if (
      a.action_pattern === b.action_pattern &&
      a.action_pattern !== undefined &&
      a.active &&
      b.active
    ) {
      if (
        (a.enforcement === "block" && b.enforcement === "log") ||
        (a.enforcement === "log" && b.enforcement === "block")
      ) {
        return `Rules conflict: one blocks '${a.action_pattern}', another only logs it`;
      }
    }
    return null;
  }

  private _detectConflictWithInput(existing: PolicyRuleDB, newRule: PolicyRuleInput): string | null {
    if (
      existing.action_pattern === newRule.action_pattern &&
      newRule.action_pattern !== undefined &&
      existing.active
    ) {
      if (
        (existing.enforcement === "block" && newRule.enforcement === "log") ||
        (existing.enforcement === "log" && newRule.enforcement === "block")
      ) {
        return `New rule conflicts with rule #${existing.id}: contradictory enforcement for '${newRule.action_pattern}'`;
      }
    }
    return null;
  }

  private _isDeadRule(rule: PolicyRuleDB, allRules: PolicyRuleDB[]): boolean {
    // A rule is dead if it is inactive
    if (!rule.active) return true;

    if (rule.action_pattern === undefined) return false;

    // Check if blocked by a wildcarded rule
    const wildcardBlockers = allRules.filter(
      (r) =>
        r.id !== rule.id &&
        r.active &&
        r.action_pattern === "*" &&
        r.enforcement === "block" &&
        rule.enforcement !== "block",
    );
    return wildcardBlockers.length > 0;
  }
}
