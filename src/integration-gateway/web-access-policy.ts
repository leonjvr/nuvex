// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Integration Gateway: Web Access Policy Loader
 *
 * Loads per-division web access policies from YAML files.
 *
 * Expected path pattern:
 *   {governanceDir}/governance/boundaries/web-access-{division}.yaml
 *
 * Security: DENY-ALL default — if no file exists for a division, all access
 * is blocked (null policy returned; PolicyEnforcer maps null → deny).
 */

import { readFile }       from "node:fs/promises";
import { existsSync }     from "node:fs";
import { join }           from "node:path";
import { parse as parseYaml } from "yaml";
import { createLogger }   from "../core/logger.js";
import type {
  WebAccessPolicy,
  WebAccessServiceRule,
  WebAccessBlockRule,
  WebAccessApprovalRule,
} from "./types.js";

const logger = createLogger("web-access-policy");


export class WebAccessPolicyLoader {
  private readonly cache = new Map<string, WebAccessPolicy | null>();

  /**
   * @param governanceDir  Root of the governance directory tree (parent of
   *                       "governance/boundaries/").  In production this is
   *                       the workspace root; in tests pass a temp dir.
   */
  constructor(private readonly governanceDir: string) {}

  /**
   * Load the policy for `division`, or null if no policy file is found.
   * Results are cached in memory; call `clearCache()` to invalidate.
   */
  async getPolicy(division: string): Promise<WebAccessPolicy | null> {
    if (this.cache.has(division)) {
      return this.cache.get(division) ?? null;
    }

    const filePath = this.policyPath(division);
    if (!existsSync(filePath)) {
      logger.debug("web-access-policy", `No policy file for division '${division}' — deny-all default`, {
        metadata: { division, path: filePath },
      });
      this.cache.set(division, null);
      return null;
    }

    try {
      const raw = await readFile(filePath, "utf-8");
      const parsed: unknown = parseYaml(raw);
      const policy = validatePolicy(parsed, division, filePath);
      this.cache.set(division, policy);
      logger.debug("web-access-policy", `Loaded policy for division '${division}'`, {
        metadata: { division, allowedServices: policy.allowed_services.length },
      });
      return policy;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn("web-access-policy", `Failed to load policy for '${division}'`, {
        metadata: { division, path: filePath, error: msg },
      });
      throw e;
    }
  }

  /** Path to the policy YAML file for a given division. */
  policyPath(division: string): string {
    return join(this.governanceDir, "governance", "boundaries", `web-access-${division}.yaml`);
  }

  /** Invalidate all cached policies (e.g. after config reload). */
  clearCache(): void {
    this.cache.clear();
  }
}


function validatePolicy(raw: unknown, division: string, source: string): WebAccessPolicy {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`${source}: web access policy must be an object`);
  }

  const d = raw as Record<string, unknown>;

  // allowed_services
  if (!Array.isArray(d["allowed_services"])) {
    throw new Error(`${source}: 'allowed_services' must be an array`);
  }
  const allowedServices: WebAccessServiceRule[] = (d["allowed_services"] as unknown[]).map(
    (r, i) => validateServiceRule(r, `${source} allowed_services[${i}]`),
  );

  // blocked_services
  const blockedServices: WebAccessBlockRule[] = Array.isArray(d["blocked_services"])
    ? (d["blocked_services"] as unknown[]).map((r, i) =>
        validateBlockRule(r, `${source} blocked_services[${i}]`),
      )
    : [];

  // approval_rules
  const approvalRules: WebAccessApprovalRule[] = Array.isArray(d["approval_rules"])
    ? (d["approval_rules"] as unknown[]).map((r, i) =>
        validateApprovalRule(r, `${source} approval_rules[${i}]`),
      )
    : [];

  // budget
  const budget = validateBudget(d["budget"], source);

  // rate_limits
  const rawRL = d["rate_limits"];
  const rateLimits = {
    per_service: typeof (rawRL as Record<string, unknown>)?.["per_service"] === "string"
      ? String((rawRL as Record<string, unknown>)["per_service"])
      : "unlimited",
    total: typeof (rawRL as Record<string, unknown>)?.["total"] === "string"
      ? String((rawRL as Record<string, unknown>)["total"])
      : "unlimited",
  };

  // audit
  const rawAudit = d["audit"] as Record<string, unknown> | undefined;
  const audit = {
    log_requests:  rawAudit?.["log_requests"]  !== false,
    log_responses: rawAudit?.["log_responses"] !== false,
    retention_days: typeof rawAudit?.["retention_days"] === "number"
      ? (rawAudit["retention_days"] as number)
      : 90,
  };

  // allowed_domains (optional)
  const allowedDomains: string[] | undefined = Array.isArray(d["allowed_domains"])
    ? (d["allowed_domains"] as unknown[]).map(String)
    : undefined;

  const policy: WebAccessPolicy = {
    division,
    allowed_services: allowedServices,
    blocked_services:  blockedServices,
    approval_rules:    approvalRules,
    budget,
    rate_limits:       rateLimits,
    audit,
  };
  if (allowedDomains !== undefined) {
    policy.allowed_domains = allowedDomains;
  }
  return policy;
}

function validateServiceRule(raw: unknown, source: string): WebAccessServiceRule {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`${source}: must be an object`);
  }
  const r = raw as Record<string, unknown>;
  if (typeof r["service"] !== "string" || r["service"].trim() === "") {
    throw new Error(`${source}: 'service' must be a non-empty string`);
  }
  if (!Array.isArray(r["actions"]) || (r["actions"] as unknown[]).length === 0) {
    throw new Error(`${source}: 'actions' must be a non-empty array`);
  }
  const rule: WebAccessServiceRule = {
    service: String(r["service"]).trim(),
    actions: (r["actions"] as unknown[]).map(String),
  };
  if (Array.isArray(r["workflows"]))    rule.workflows    = (r["workflows"] as unknown[]).map(String);
  if (Array.isArray(r["channels"]))     rule.channels     = (r["channels"] as unknown[]).map(String);
  if (Array.isArray(r["repositories"])) rule.repositories = (r["repositories"] as unknown[]).map(String);
  return rule;
}

function validateBlockRule(raw: unknown, source: string): WebAccessBlockRule {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`${source}: must be an object`);
  }
  const r = raw as Record<string, unknown>;
  if (typeof r["service"] !== "string" || r["service"].trim() === "") {
    throw new Error(`${source}: 'service' must be a non-empty string`);
  }
  return { service: String(r["service"]).trim() };
}

function validateApprovalRule(raw: unknown, source: string): WebAccessApprovalRule {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`${source}: must be an object`);
  }
  const r = raw as Record<string, unknown>;
  if (typeof r["action"] !== "string" || r["action"].trim() === "") {
    throw new Error(`${source}: 'action' must be a non-empty string`);
  }
  const validApprovers = new Set(["division_head", "human", "operator"]);
  if (!validApprovers.has(String(r["approver"]))) {
    throw new Error(`${source}: 'approver' must be one of ${[...validApprovers].join(", ")}`);
  }
  const rule: WebAccessApprovalRule = {
    action:   String(r["action"]).trim(),
    approver: r["approver"] as WebAccessApprovalRule["approver"],
  };
  if (typeof r["condition"] === "string") {
    rule.condition = r["condition"];
  }
  return rule;
}

function validateBudget(raw: unknown, source: string): WebAccessPolicy["budget"] {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`${source}: 'budget' block is required`);
  }
  const b = raw as Record<string, unknown>;
  if (typeof b["per_call"] !== "number") {
    throw new Error(`${source}: budget.per_call must be a number`);
  }
  if (typeof b["daily_limit"] !== "number") {
    throw new Error(`${source}: budget.daily_limit must be a number`);
  }
  if (typeof b["monthly_limit"] !== "number") {
    throw new Error(`${source}: budget.monthly_limit must be a number`);
  }
  return {
    per_call:      b["per_call"] as number,
    daily_limit:   b["daily_limit"] as number,
    monthly_limit: b["monthly_limit"] as number,
  };
}
