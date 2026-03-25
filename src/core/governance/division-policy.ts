// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — P270: Division Policy Interface
 *
 * Defines the interface for explicit cross-division authorization policies.
 * By default (no policies configured) all cross-division operations are blocked.
 * Policies can be loaded from governance/cross-division-policies.yaml to permit
 * specific cross-division assignments or delegations.
 *
 * V1.1: Policy storage is file-based read-only. Mutations require manual YAML edit.
 */

import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as yamlParse } from "yaml";
import { createLogger } from "../logger.js";

const logger = createLogger("division-policy");


/**
 * Cross-division authorization policy.
 * Loaded from governance/cross-division-policies.yaml (empty = no cross-division allowed).
 */
export interface DivisionPolicy {
  /** Unique identifier for this policy. */
  id: string;
  /** Division that is the source of the cross-division operation. */
  sourceDivision: string;
  /** Division that is the target of the cross-division operation. */
  targetDivision: string;
  /** Whether cross-division operations from source → target are allowed. */
  allowed: boolean;
  /** Optional conditions that must be satisfied for the policy to apply. */
  conditions?: {
    /** Whether explicit human approval is required. */
    requireApproval?: boolean;
    /** Maximum delegation depth allowed cross-division. Default: 1. */
    maxDelegationDepth?: number;
    /** Tool names that are allowed to be used cross-division. */
    allowedToolNames?: string[];
  };
  /** ISO-8601 creation timestamp. */
  createdAt: string;
  /** Token ID or user identity that created this policy. */
  createdBy: string;
}


/**
 * Load cross-division policies from governance YAML.
 * Returns an empty array if no policy file exists or if parsing fails.
 * An empty policy list means ALL cross-division operations are blocked.
 *
 * @param workDir - Working directory (policies file: <workDir>/governance/cross-division-policies.yaml)
 */
export function loadCrossDivisionPolicies(workDir: string): DivisionPolicy[] {
  const policyFile = join(workDir, "governance", "cross-division-policies.yaml");
  if (!existsSync(policyFile)) {
    return [];
  }
  try {
    const raw = yamlParse(readFileSync(policyFile, "utf-8")) as unknown;
    if (!Array.isArray(raw)) {
      logger.warn("division-policy", "cross-division-policies.yaml is not an array — blocking all cross-division", {
        metadata: { path: policyFile },
      });
      return [];
    }
    return raw.filter(isPolicyShape);
  } catch (e: unknown) {
    // Fail closed: parse error → no cross-division operations allowed
    logger.error("division-policy", "Failed to parse cross-division-policies.yaml — blocking all cross-division access", {
      metadata: { error: e instanceof Error ? e.message : String(e), path: policyFile },
    });
    return [];
  }
}


/** Type guard for DivisionPolicy shape. */
function isPolicyShape(obj: unknown): obj is DivisionPolicy {
  if (typeof obj !== "object" || obj === null) return false;
  const o = obj as Record<string, unknown>;
  return (
    typeof o["id"] === "string" &&
    typeof o["sourceDivision"] === "string" &&
    typeof o["targetDivision"] === "string" &&
    typeof o["allowed"] === "boolean"
  );
}


/**
 * Find a cross-division policy that authorizes sourceDivision → targetDivision.
 * Returns null if no matching policy exists (= operation is blocked).
 */
export function findPolicy(
  policies: DivisionPolicy[],
  sourceDivision: string,
  targetDivision: string,
): DivisionPolicy | null {
  return policies.find(
    (p) => p.allowed && p.sourceDivision === sourceDivision && p.targetDivision === targetDivision,
  ) ?? null;
}
