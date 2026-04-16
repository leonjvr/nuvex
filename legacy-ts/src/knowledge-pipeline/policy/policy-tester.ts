// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 10.6: PolicyTester
 * Scenario simulation: "what if agent X does Y?" Runs against active rules.
 */

import type { PolicyRuleDB } from "../types.js";

export interface TestScenario {
  agent_id: string;
  division?: string;
  tier?: number;
  action: string;
  target?: string;
  description?: string;
}

export interface RuleTestResult {
  rule_id: number;
  matched: boolean;
  enforcement: string;
  reason?: string;
}

export interface ScenarioTestResult {
  scenario: TestScenario;
  verdict: "ALLOW" | "BLOCK" | "WARN" | "ASK_FIRST";
  triggered_rules: RuleTestResult[];
  blocking_rule?: RuleTestResult;
}

export class PolicyTester {
  test(scenario: TestScenario, rules: PolicyRuleDB[]): ScenarioTestResult {
    const triggered: RuleTestResult[] = [];

    for (const rule of rules) {
      if (!rule.active) continue;
      if (this._matches(scenario, rule)) {
        triggered.push({
          rule_id: rule.id,
          matched: true,
          enforcement: rule.enforcement,
          ...(rule.reason !== undefined ? { reason: rule.reason } : {}),
        });
      }
    }

    // Determine verdict
    const blocker = triggered.find((t) => t.enforcement === "block");
    const asker = triggered.find((t) => t.enforcement === "ask_first");
    const warner = triggered.find((t) => t.enforcement === "warn");

    let verdict: ScenarioTestResult["verdict"] = "ALLOW";
    let blockingRule: RuleTestResult | undefined;

    if (blocker !== undefined) {
      verdict = "BLOCK";
      blockingRule = blocker;
    } else if (asker !== undefined) {
      verdict = "ASK_FIRST";
      blockingRule = asker;
    } else if (warner !== undefined) {
      verdict = "WARN";
    }

    return {
      scenario,
      verdict,
      triggered_rules: triggered,
      ...(blockingRule !== undefined ? { blocking_rule: blockingRule } : {}),
    };
  }

  testBatch(scenarios: TestScenario[], rules: PolicyRuleDB[]): ScenarioTestResult[] {
    return scenarios.map((s) => this.test(s, rules));
  }

  private _matches(scenario: TestScenario, rule: PolicyRuleDB): boolean {
    if (rule.action_pattern === undefined) return false;

    const pattern = rule.action_pattern;
    const action = scenario.action;

    // Step 1: Check if the action pattern matches.
    // All three checks are tested before conditions so that conditions act as
    // additional filters on top of a confirmed pattern match (not as alternatives).
    let patternMatched = false;
    if (pattern === "*") {
      patternMatched = true;
    } else if (pattern === action) {
      patternMatched = true;
    } else if (pattern.endsWith(".*")) {
      // Wildcard: "data.*" matches "data.delete", "data.export", etc.
      const prefix = pattern.slice(0, -2);
      if (action.startsWith(prefix + ".")) patternMatched = true;
    }

    if (!patternMatched) return false;

    // Step 2: Apply condition filter as an additional restriction on the match.
    // If condition is present and fails, the rule does not apply to this action.
    if (rule.condition !== undefined && scenario.target !== undefined) {
      if (rule.condition.includes("starts_with")) {
        const match = /starts_with '([^']+)'/.exec(rule.condition);
        if (match !== null && !scenario.target.startsWith(match[1]!)) {
          return false;
        }
      }
      if (rule.condition.includes("contains")) {
        const match = /contains '([^']+)'/.exec(rule.condition);
        if (match !== null && !scenario.target.includes(match[1]!)) {
          return false;
        }
      }
    }

    return true;
  }
}
