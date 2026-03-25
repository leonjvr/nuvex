// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 10.5: AgentValidator
 *
 * 12-check validation suite for AgentLifecycleDefinition.
 *
 * Checks:
 *  1  schema        — required fields present, correct types
 *  2  provider      — referenced provider registered
 *  3  model         — model available from that provider
 *  4  division      — division exists in divisions table
 *  5  budget        — agent budget ≤ division budget
 *  6  tier          — tier matches reports_to hierarchy
 *  7  skill         — skill file exists + valid (uses SkillValidator)
 *  8  capability    — capabilities not restricted by tier
 *  9  classification— max_classification ≤ division max_classification
 * 10  tool          — Phase 10.7 stub (warn if tools referenced, not error)
 * 11  knowledge     — Phase 10.6 stub (warn if knowledge referenced, not error)
 * 12  circular-dep  — no agent reports to itself or creates loops
 */

import type { Database } from "../utils/db.js";
import type { AgentLifecycleDefinition, AgentValidationResult } from "./types.js";
import { SkillValidator } from "./skill-validator.js";
import { resolveSkillPath } from "./agent-template.js";
import { createLogger } from "../core/logger.js";

const logger = createLogger("agent-validator");


const CLASSIFICATION_ORDER: Record<string, number> = {
  PUBLIC: 0,
  INTERNAL: 1,
  CONFIDENTIAL: 2,
  SECRET: 3,
  "TOP-SECRET": 4,
};


export class AgentValidator {
  private readonly skillValidator = new SkillValidator();

  constructor(private readonly db: Database) {}

  /**
   * Run all 12 validation checks against the given agent definition.
   */
  async validate(
    def: AgentLifecycleDefinition,
    opts: { workDir?: string } = {},
  ): Promise<AgentValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const checksPassed: string[] = [];
    const checksFailed: string[] = [];

    const pass = (check: string): void => { checksPassed.push(check); };
    const fail = (check: string, msg: string): void => {
      checksFailed.push(check);
      errors.push(msg);
    };
    const warn = (check: string, msg: string): void => {
      checksPassed.push(check);
      warnings.push(msg);
    };

    // ── Check 1: Schema ────────────────────────────────────────────────────
    {
      const schemaErrors: string[] = [];
      if (!def.id || typeof def.id !== "string" || def.id.trim() === "") {
        schemaErrors.push("id is required (non-empty string)");
      }
      if (!def.name || typeof def.name !== "string" || def.name.trim() === "") {
        schemaErrors.push("name is required (non-empty string)");
      }
      if (typeof def.tier !== "number" || def.tier < 1 || def.tier > 7 || !Number.isInteger(def.tier)) {
        schemaErrors.push("tier must be integer 1-7");
      }
      if (!def.division || typeof def.division !== "string" || def.division.trim() === "") {
        schemaErrors.push("division is required (non-empty string)");
      }
      if (!def.provider || typeof def.provider !== "string" || def.provider.trim() === "") {
        schemaErrors.push("provider is required (non-empty string)");
      }
      if (!def.model || typeof def.model !== "string" || def.model.trim() === "") {
        schemaErrors.push("model is required (non-empty string)");
      }
      if (!Array.isArray(def.capabilities)) {
        schemaErrors.push("capabilities must be an array");
      }

      if (schemaErrors.length > 0) {
        for (const e of schemaErrors) fail("schema", e);
      } else {
        pass("schema");
      }
    }

    // Stop early if schema is invalid — later checks depend on valid fields
    if (checksFailed.includes("schema")) {
      return { valid: false, errors, warnings, checks_passed: checksPassed, checks_failed: checksFailed };
    }

    // ── Check 2: Provider ──────────────────────────────────────────────────
    {
      const providerExists = this.checkProviderExists(def.provider);
      if (!providerExists) {
        fail("provider", `Provider "${def.provider}" is not registered. Run: sidjua provider add ${def.provider.toLowerCase()}`);
      } else {
        pass("provider");
      }
    }

    // ── Check 3: Model ─────────────────────────────────────────────────────
    {
      const modelAvailable = this.checkModelAvailable(def.provider, def.model);
      if (!modelAvailable) {
        warn("model", `Model "${def.model}" not found in provider_configs for "${def.provider}". Proceeding — model list may be outdated.`);
      } else {
        pass("model");
      }
    }

    // ── Check 4: Division ──────────────────────────────────────────────────
    {
      const divisionExists = this.checkDivisionExists(def.division);
      if (!divisionExists) {
        fail("division", `Division "${def.division}" not found in divisions table. Run: sidjua apply`);
      } else {
        pass("division");
      }
    }

    // ── Check 5: Budget ────────────────────────────────────────────────────
    {
      const budgetWarning = this.checkBudgetConstraints(def);
      if (budgetWarning !== null) {
        warn("budget", budgetWarning);
      } else {
        pass("budget");
      }
    }

    // ── Check 6: Tier hierarchy ────────────────────────────────────────────
    {
      const tierError = this.checkTierHierarchy(def);
      if (tierError !== null) {
        fail("tier", tierError);
      } else {
        pass("tier");
      }
    }

    // ── Check 7: Skill file (optional — skip when no skill path provided) ───
    {
      if (def.skill && def.skill.trim() !== "") {
        let resolvedSkillPath: string | null = null;
        try {
          resolvedSkillPath = resolveSkillPath(opts.workDir ?? process.cwd(), def.skill);
        } catch (_e) {
          // SEC-010: path traversal or absolute path — treat as validation failure, not a throw
          fail("skill", `Skill path "${def.skill}" is invalid: must be a relative path within the work directory`);
        }

        if (resolvedSkillPath !== null) {
          const skillResult = await this.skillValidator.validateFile(resolvedSkillPath);
          if (!skillResult.valid) {
            for (const e of skillResult.errors) {
              fail("skill", `Skill file: ${e}`);
            }
          } else {
            pass("skill");
            for (const w of skillResult.warnings) {
              warnings.push(`Skill file: ${w}`);
            }
          }
        }
      } else {
        pass("skill");  // no skill defined — pass silently
      }
    }

    // ── Check 8: Capabilities ──────────────────────────────────────────────
    {
      const capError = this.checkCapabilityRestrictions(def);
      if (capError !== null) {
        fail("capability", capError);
      } else {
        pass("capability");
      }
    }

    // ── Check 9: Classification ────────────────────────────────────────────
    {
      const classError = this.checkClassification(def);
      if (classError !== null) {
        fail("classification", classError);
      } else {
        pass("classification");
      }
    }

    // ── Check 10: Tools (Phase 10.7 stub) ─────────────────────────────────
    {
      if (def.tools !== undefined && def.tools.length > 0) {
        warn("tool", `Tool bindings declared but Phase 10.7 (Tools) is not yet implemented. Tools will be ignored at runtime.`);
      } else {
        pass("tool");
      }
    }

    // ── Check 11: Knowledge (Phase 10.6 stub) ─────────────────────────────
    {
      if (def.knowledge !== undefined && def.knowledge.length > 0) {
        warn("knowledge", `Knowledge collections declared but Phase 10.6 (Knowledge Pipeline) is not yet implemented. Knowledge will be ignored at runtime.`);
      } else {
        pass("knowledge");
      }
    }

    // ── Check 12: Circular dependency ─────────────────────────────────────
    {
      const circularError = this.checkCircularDependency(def);
      if (circularError !== null) {
        fail("circular-dep", circularError);
      } else {
        pass("circular-dep");
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      checks_passed: checksPassed,
      checks_failed: checksFailed,
    };
  }

  // ---------------------------------------------------------------------------
  // Individual check helpers
  // ---------------------------------------------------------------------------

  private checkProviderExists(provider: string): boolean {
    try {
      const row = this.db
        .prepare<[string], { id: string }>(
          "SELECT id FROM provider_configs WHERE LOWER(id) = LOWER(?)",
        )
        .get(provider);
      return row !== undefined;
    } catch (e: unknown) {
      logger.warn("agent-validator", "Provider config DB query failed — provider validation failed", { metadata: { error: e instanceof Error ? e.message : String(e) } });
      return false;
    }
  }

  private checkModelAvailable(provider: string, model: string): boolean {
    try {
      const row = this.db
        .prepare<[string], { config_yaml: string }>(
          "SELECT config_yaml FROM provider_configs WHERE LOWER(id) = LOWER(?)",
        )
        .get(provider);
      if (row === undefined) return false;

      // Check if model name appears in the config YAML
      return row.config_yaml.includes(model);
    } catch (e: unknown) {
      logger.warn("agent-validator", "Model validation DB query failed — model validation failed", { metadata: { error: e instanceof Error ? e.message : String(e) } });
      return false;
    }
  }

  private checkDivisionExists(division: string): boolean {
    try {
      const row = this.db
        .prepare<[string], { code: string }>(
          "SELECT code FROM divisions WHERE code = ? AND active = 1",
        )
        .get(division);
      return row !== undefined;
    } catch (e: unknown) {
      logger.warn("agent-validator", "Division validation DB query failed — division validation failed", { metadata: { error: e instanceof Error ? e.message : String(e) } });
      return false;
    }
  }

  private checkBudgetConstraints(def: AgentLifecycleDefinition): string | null {
    if (def.budget?.per_month_usd === undefined) return null;

    try {
      const row = this.db
        .prepare<[string], { limit_usd: number }>(
          "SELECT limit_usd FROM division_budgets WHERE division = ?",
        )
        .get(def.division);

      if (row === undefined) return null;

      if (def.budget.per_month_usd > row.limit_usd) {
        return `Agent monthly budget $${def.budget.per_month_usd} exceeds division budget $${row.limit_usd}`;
      }

      const ratio = row.limit_usd > 0 ? def.budget.per_month_usd / row.limit_usd : 0;
      if (ratio > 0.8) {
        return `Agent monthly budget ($${def.budget.per_month_usd}) is >80% of division budget ($${row.limit_usd})`;
      }
    } catch (e: unknown) { logger.debug("agent-validator", "cost_budgets table not found — skipping budget check (pre-migration)", { metadata: { error: e instanceof Error ? e.message : String(e) } }); }

    return null;
  }

  private checkTierHierarchy(def: AgentLifecycleDefinition): string | null {
    if (def.reports_to === undefined) return null;

    // T3 reporting to another T3 is invalid
    if (def.tier === 3) {
      try {
        const supervisor = this.db
          .prepare<[string], { tier: number }>(
            "SELECT tier FROM agent_definitions WHERE id = ?",
          )
          .get(def.reports_to);

        if (supervisor !== undefined && supervisor.tier >= 3) {
          return `Tier-${def.tier} agent cannot report to Tier-${supervisor.tier} agent "${def.reports_to}". Must report to T1 or T2.`;
        }
      } catch (e: unknown) { logger.debug("agent-validator", "agent_instances table not found — skipping instance check (pre-migration)", { metadata: { error: e instanceof Error ? e.message : String(e) } }); }
    }

    return null;
  }

  private checkCapabilityRestrictions(def: AgentLifecycleDefinition): string | null {
    if (!Array.isArray(def.capabilities)) return null;

    // T3 agents cannot claim "strategic-planning" or "budget-authority" capabilities
    const T3_RESTRICTED = ["strategic-planning", "budget-authority", "hiring-authority"];
    if (def.tier >= 3) {
      for (const cap of def.capabilities) {
        if (T3_RESTRICTED.includes(cap)) {
          return `Capability "${cap}" is restricted to T1/T2 agents. Remove from T${def.tier} agent.`;
        }
      }
    }

    return null;
  }

  private checkClassification(def: AgentLifecycleDefinition): string | null {
    if (def.max_classification === undefined) return null;

    const agentLevel = CLASSIFICATION_ORDER[def.max_classification.toUpperCase()];
    if (agentLevel === undefined) {
      return `Unknown classification level "${def.max_classification}". Valid: PUBLIC, INTERNAL, CONFIDENTIAL, SECRET, TOP-SECRET`;
    }

    try {
      // Check division's max classification from divisions table (config column)
      const row = this.db
        .prepare<[string], { scope: string | null }>(
          "SELECT scope FROM divisions WHERE code = ?",
        )
        .get(def.division);

      if (row?.scope !== null && row?.scope !== undefined) {
        const divLevel = CLASSIFICATION_ORDER[row.scope.toUpperCase()];
        if (divLevel !== undefined && agentLevel > divLevel) {
          return `Agent max_classification "${def.max_classification}" exceeds division scope "${row.scope}"`;
        }
      }
    } catch (e: unknown) { logger.warn("agent-validator", "Skill file validation failed — skipping skill", { metadata: { error: e instanceof Error ? e.message : String(e) } }); }

    return null;
  }

  private checkCircularDependency(def: AgentLifecycleDefinition): string | null {
    if (def.reports_to === undefined) return null;

    // Direct self-reference
    if (def.reports_to === def.id) {
      return `Agent "${def.id}" cannot report to itself (circular dependency)`;
    }

    // Transitive loop check: walk up the chain
    try {
      const visited = new Set<string>([def.id]);
      let current = def.reports_to;

      while (current !== undefined && current !== "") {
        if (visited.has(current)) {
          return `Circular dependency detected: "${def.id}" → ... → "${current}" → ... (loop)`;
        }
        visited.add(current);

        const row = this.db
          .prepare<[string], { reports_to: string | null }>(
            "SELECT json_extract(config_yaml, '$.reports_to') AS reports_to FROM agent_definitions WHERE id = ?",
          )
          .get(current);

        current = row?.reports_to ?? "";
      }
    } catch (e: unknown) { logger.debug("agent-validator", "Transitive agent check failed — skipping (pre-migration)", { metadata: { error: e instanceof Error ? e.message : String(e) } }); }

    return null;
  }
}


// resolveSkillPath is imported from agent-template.ts (secure version with SEC-010 guard)
