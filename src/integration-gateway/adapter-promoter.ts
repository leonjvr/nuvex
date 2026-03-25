// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Integration Gateway: Adapter Promotion Pipeline
 *
 * Tracks intelligent-path usage patterns. When a service reaches the
 * configured threshold (10+ calls, 80%+ success), it is flagged as a
 * promotion candidate — meaning a human engineer should review it and
 * create a proper deterministic adapter YAML.
 *
 * `generateAdapterYaml` produces a starter YAML definition from the
 * stored OpenAPI spec that the engineer can review, adjust, and commit.
 */

import { parseOpenApiSpec } from "./openapi-parser.js";
import type { SchemaStore, ApiSchema } from "./schema-store.js";


export interface PromotionCandidate {
  service_name: string;
  usage_count: number;
  success_rate: number;
  common_actions: string[];
  last_used: string;
  /** True when the service meets both usage and success-rate thresholds. */
  recommended: boolean;
}


export class AdapterPromoter {
  private readonly promotionThreshold = {
    min_usage:        10,
    min_success_rate: 0.8,
  };

  /**
   * Return all intelligent-path services that are candidates for promotion.
   * Only `discovered` and `draft` quality schemas are considered — verified /
   * community schemas already have proper adapters.
   */
  async getCandidates(schemaStore: SchemaStore): Promise<PromotionCandidate[]> {
    const schemas = await schemaStore.listSchemas();
    return schemas
      .filter((s) => s.quality === "discovered" || s.quality === "draft")
      .map((s) => ({
        service_name:   s.service_name,
        usage_count:    s.usage_count,
        success_rate:   s.success_rate,
        common_actions: [],
        last_used:      s.last_used,
        recommended:
          s.usage_count  >= this.promotionThreshold.min_usage &&
          s.success_rate >= this.promotionThreshold.min_success_rate,
      }));
  }

  /**
   * Generate a starter YAML adapter definition from an API schema.
   *
   * The output is designed for human review — governance rules are inferred
   * from HTTP method (GET=low, DELETE=high, everything else=medium) and the
   * engineer should refine them before committing.
   *
   * @param schema        - The stored API schema.
   * @param commonActions - Operation IDs of the most-used endpoints to include.
   *                        Pass [] to include all endpoints.
   */
  async generateAdapterYaml(
    schema: ApiSchema,
    commonActions: string[],
  ): Promise<string> {
    let parsed;
    try {
      parsed = parseOpenApiSpec(schema.spec_content);
    } catch (_e) {
      throw new Error(
        `Cannot generate adapter YAML for '${schema.service_name}': invalid OpenAPI spec`,
      );
    }

    // Filter to common actions if provided; otherwise take all
    const selectedEndpoints = parsed.endpoints.filter((e) => {
      if (commonActions.length === 0) return true;
      const opId =
        e.operation_id ??
        `${e.method.toLowerCase()}${e.path.replace(/\{([^}]+)\}/g, "_$1").replace(/[^a-z0-9_]/gi, "_")}`;
      return commonActions.includes(opId);
    });

    // Build actions YAML block
    const actionsBlock = selectedEndpoints
      .map((e) => {
        const opId =
          e.operation_id ??
          `${e.method.toLowerCase()}${e.path
            .replace(/\{([^}]+)\}/g, "_$1")
            .replace(/[^a-z0-9_]/gi, "_")}`;

        const risk            = e.method === "GET" ? "low" : e.method === "DELETE" ? "high" : "medium";
        const requireApproval = e.method === "DELETE" || e.method === "PUT";

        const paramsBlock =
          e.parameters.length > 0
            ? e.parameters
                .map(
                  (p) =>
                    `      ${p.name}:\n        type: ${p.type}\n        required: ${p.required}`,
                )
                .join("\n")
            : "      {}";

        return [
          `  ${opId}:`,
          `    method: ${e.method}`,
          `    path: "${e.path}"`,
          `    params:`,
          paramsBlock,
          `    governance:`,
          `      require_approval: ${requireApproval}`,
          `      budget_per_call: 0.00`,
          `      rate_limit: "30/minute"`,
          `      risk_level: ${risk}`,
        ].join("\n");
      })
      .join("\n");

    const secretRef = schema.service_name.toUpperCase().replace(/-/g, "_") + "_API_KEY";

    return [
      `name: ${schema.service_name}`,
      `type: deterministic`,
      `protocol: rest`,
      `base_url: "${parsed.base_url}"`,
      `auth:`,
      `  type: api_key`,
      `  secret_ref: "${secretRef}"`,
      `actions:`,
      actionsBlock,
      `enabled: true`,
    ].join("\n");
  }
}
