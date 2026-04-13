// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Integration Gateway: Policy Enforcer
 *
 * Evaluates per-division web access policies before an integration call
 * proceeds.  Decision order (first match wins):
 *
 *   1. No policy file → DENY ALL
 *   2. Service name matches a blocked_services glob → DENY
 *   3. base_url domain not in allowed_domains (when provided) → DENY
 *   4. Service+action not in allowed_services allow-list → DENY
 *   5. Matching approval_rule found → APPROVE (approval_required = true)
 *   6. Budget limits exceeded → DENY
 *   7. Otherwise → ALLOW
 *
 * Glob matching: `*` = any sequence, `?` = single char.  Case-insensitive.
 */

import { createLogger } from "../core/logger.js";
import type {
  GatewayBudgetService,
  PolicyCheckResult,
  WebAccessApprovalRule,
  WebAccessPolicy,
} from "./types.js";
import type { WebAccessPolicyLoader } from "./web-access-policy.js";

const logger = createLogger("policy-enforcer");


/**
 * Match `value` against a simple glob `pattern`.
 * `*` matches any sequence of characters; `?` matches exactly one.
 * Matching is case-insensitive.
 */
export function globMatch(pattern: string, value: string): boolean {
  // Escape regex special chars, then restore * and ? as wildcards.
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const regexStr = "^" + escaped.replace(/\*/g, ".*").replace(/\?/g, ".") + "$";
  return new RegExp(regexStr, "i").test(value);
}


export class PolicyEnforcer {
  constructor(
    private readonly policyLoader: WebAccessPolicyLoader,
    private readonly budgetService?: GatewayBudgetService,
  ) {}

  /**
   * Evaluate whether `division` may call `action` on `service`.
   *
   * @param division  Calling agent's division code
   * @param service   Adapter/service name
   * @param action    Action name within the service
   * @param params    Request parameters (used for condition evaluation)
   * @param baseUrl   Adapter's base URL (optional; enables domain allow-list check)
   */
  async checkAccess(
    division: string,
    service: string,
    action: string,
    params: Record<string, unknown>,
    baseUrl?: string,
  ): Promise<PolicyCheckResult> {
    const policy = await this.policyLoader.getPolicy(division);

    // 1. No policy → deny all
    if (policy === null) {
      logger.debug("policy-enforcer", `No web access policy for division '${division}' — deny-all`, {
        metadata: { division, service, action },
      });
      return { allowed: false, reason: `No web access policy for division '${division}'` };
    }

    // 2. Blocked services (glob)
    if (this.isBlocked(policy, service)) {
      logger.debug("policy-enforcer", `Service '${service}' is blocked for division '${division}'`, {
        metadata: { division, service, action },
      });
      return {
        allowed: false,
        reason:  `Service '${service}' is blocked for division '${division}'`,
      };
    }

    // 3. Domain allow-list (if base_url provided and policy has allowed_domains)
    if (baseUrl !== undefined && policy.allowed_domains !== undefined) {
      const domain = extractDomain(baseUrl);
      if (!this.isDomainAllowed(policy, domain)) {
        logger.debug("policy-enforcer", `Domain '${domain}' not in allow-list for division '${division}'`, {
          metadata: { division, service, action, domain },
        });
        return {
          allowed: false,
          reason:  `Domain '${domain}' is not in the allow-list for division '${division}'`,
        };
      }
    }

    // 4. Service + action not in allow-list
    if (!this.isAllowed(policy, service, action)) {
      logger.debug("policy-enforcer", `${service}.${action} not in allow-list for division '${division}'`, {
        metadata: { division, service, action },
      });
      return {
        allowed: false,
        reason:  `Action '${action}' on service '${service}' not in allow-list for division '${division}'`,
      };
    }

    // 5. Approval rules
    const approvalRule = this.findApprovalRule(policy, action, params);
    if (approvalRule !== undefined) {
      logger.debug("policy-enforcer", `Action '${action}' requires approval from '${approvalRule.approver}'`, {
        metadata: { division, service, action, approver: approvalRule.approver },
      });
      return {
        allowed:          true,
        approval_required: true,
        approver:         approvalRule.approver,
      };
    }

    // 6. Budget check
    if (this.budgetService !== undefined) {
      const [monthlySpend, dailySpend] = await Promise.all([
        this.budgetService.getCurrentSpend(division, "monthly"),
        this.budgetService.getCurrentSpend(division, "daily"),
      ]);
      if (monthlySpend >= policy.budget.monthly_limit) {
        logger.debug("policy-enforcer", `Monthly budget exceeded for division '${division}'`, {
          metadata: { division, spend: monthlySpend, limit: policy.budget.monthly_limit },
        });
        return { allowed: false, reason: `Integration monthly budget exceeded for division '${division}'` };
      }
      if (dailySpend >= policy.budget.daily_limit) {
        logger.debug("policy-enforcer", `Daily budget exceeded for division '${division}'`, {
          metadata: { division, spend: dailySpend, limit: policy.budget.daily_limit },
        });
        return { allowed: false, reason: `Integration daily budget exceeded for division '${division}'` };
      }
    }

    return { allowed: true };
  }

  /**
   * Check whether a domain is in the policy's allowed_domains list.
   * DENY-BY-DEFAULT: returns false when allowed_domains is empty or undefined.
   */
  checkDomain(policy: WebAccessPolicy, domain: string): boolean {
    if (!policy.allowed_domains || policy.allowed_domains.length === 0) {
      return false; // deny-by-default
    }
    return policy.allowed_domains.some(pattern => globMatch(pattern, domain));
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private isBlocked(policy: WebAccessPolicy, service: string): boolean {
    return policy.blocked_services.some(rule => globMatch(rule.service, service));
  }

  private isDomainAllowed(policy: WebAccessPolicy, domain: string): boolean {
    return this.checkDomain(policy, domain);
  }

  private isAllowed(policy: WebAccessPolicy, service: string, action: string): boolean {
    const rule = policy.allowed_services.find(r => r.service === service);
    if (rule === undefined) return false;
    return rule.actions.includes("*") || rule.actions.includes(action);
  }

  private findApprovalRule(
    policy: WebAccessPolicy,
    action: string,
    _params: Record<string, unknown>,
  ): WebAccessApprovalRule | undefined {
    return policy.approval_rules.find(rule => {
      if (!globMatch(rule.action, action)) return false;
      // Condition evaluation: when condition is absent, the rule always applies.
      // Full expression evaluation is a V2 feature (requires safe eval engine).
      return true;
    });
  }
}


function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch (_e) {
    // Not a valid URL — treat the whole string as the domain
    return url;
  }
}
