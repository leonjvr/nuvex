// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 14: Summary Governance Policy Validator
 *
 * Validates task summaries against the summary policy before they
 * are stored or propagated upstream.
 */

import type { CreateSummaryInput, SummaryStatus } from "../../tasks/summary-store.js";


export interface SummaryPolicy {
  required_fields:    string[];
  min_key_facts:      number;
  max_summary_length: number;
  allowed_statuses:   SummaryStatus[];
  audit_summaries:    boolean;
}

const DEFAULT_SUMMARY_POLICY: SummaryPolicy = {
  required_fields:    ["task_id", "status", "key_facts", "escalation_needed"],
  min_key_facts:      1,
  max_summary_length: 8000,
  allowed_statuses:   ["completed", "failed", "partial", "escalated"],
  audit_summaries:    true,
};

export interface ValidationError {
  code:    string;
  field:   string;
  message: string;
}

export interface ValidationResult {
  valid:  boolean;
  errors: ValidationError[];
}


export class SummaryPolicyValidator {
  private readonly policy: SummaryPolicy;

  constructor(policy?: Partial<SummaryPolicy>) {
    this.policy = { ...DEFAULT_SUMMARY_POLICY, ...(policy ?? {}) };
  }

  validate(input: CreateSummaryInput): ValidationResult {
    const errors: ValidationError[] = [];

    // 1. key_facts minimum
    if (!Array.isArray(input.key_facts) || input.key_facts.length < this.policy.min_key_facts) {
      errors.push({
        code:    "SUMMARY-001",
        field:   "key_facts",
        message: `key_facts must have at least ${this.policy.min_key_facts} entry`,
      });
    }

    // 2. status validity
    if (!this.policy.allowed_statuses.includes(input.status)) {
      errors.push({
        code:    "SUMMARY-002",
        field:   "status",
        message: `status "${input.status}" is not in allowed_statuses: ${this.policy.allowed_statuses.join(", ")}`,
      });
    }

    // 3. summary_text length
    if (input.summary_text.length > this.policy.max_summary_length) {
      errors.push({
        code:    "SUMMARY-003",
        field:   "summary_text",
        message: `summary_text is ${input.summary_text.length} chars, max ${this.policy.max_summary_length}`,
      });
    }

    return { valid: errors.length === 0, errors };
  }

  getPolicy(): Readonly<SummaryPolicy> {
    return this.policy;
  }
}
