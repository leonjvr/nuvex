// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Stage 2: Approval Workflows
 *
 * Checks the incoming action against approval-workflows.yaml and the
 * approval_queue DB table.
 *
 * Verdicts:
 *   PASS  — no matching workflow, or workflow already approved
 *   BLOCK — approval previously denied
 *   PAUSE — approval required but not yet granted (new entry created)
 */

import type {
  ActionRequest,
  ApprovalRecord,
  ApprovalWorkflow,
  StageResult,
} from "../types/pipeline.js";
import type { Database } from "../utils/db.js";
import { matchAction } from "./matcher.js";
import { evaluateCondition } from "./condition-parser.js";
import { createLogger } from "../core/logger.js";

const logger = createLogger("approval");

const APPROVAL_SOURCE = "governance/boundaries/approval-workflows.yaml";


/**
 * Stage 2: Check whether the action requires prior approval.
 *
 * @param request    The incoming action request
 * @param workflows  Parsed approval-workflows.yaml content
 * @param db         Open database handle (reads/writes approval_queue)
 * @returns          StageResult with PASS, BLOCK, or PAUSE verdict
 */
export function checkApproval(
  request: ActionRequest,
  workflows: ApprovalWorkflow[],
  db: Database,
): StageResult {
  const start = Date.now();
  const checks = [];

  for (const wf of workflows) {
    const ruleId = `approval.${wf.trigger.action}`;

    // Pattern match
    if (!matchAction(request.action.type, wf.trigger.action)) {
      checks.push({
        rule_id:     ruleId,
        rule_source: APPROVAL_SOURCE,
        matched:     false,
        verdict:     "PASS" as const,
      });
      continue;
    }

    // Condition check (if present)
    if (wf.trigger.condition !== undefined) {
      if (!evaluateCondition(wf.trigger.condition, request)) {
        checks.push({
          rule_id:     ruleId,
          rule_source: APPROVAL_SOURCE,
          matched:     false,
          verdict:     "PASS" as const,
          reason:      "Condition not met",
        });
        continue;
      }
    }

    // Workflow triggered — look up existing approval
    const existing = findApproval(db, request, wf);

    if (existing !== null && existing.status === "approved") {
      checks.push({
        rule_id:     ruleId,
        rule_source: APPROVAL_SOURCE,
        matched:     true,
        verdict:     "PASS" as const,
        reason:      "Previously approved",
      });
      continue;
    }

    if (existing !== null && existing.status === "denied") {
      checks.push({
        rule_id:     ruleId,
        rule_source: APPROVAL_SOURCE,
        matched:     true,
        verdict:     "BLOCK" as const,
        reason:      "Approval denied",
      });
      return {
        stage:         "approval",
        verdict:       "BLOCK",
        duration_ms:   Date.now() - start,
        rules_checked: checks,
      };
    }

    if (existing !== null && existing.status === "pending") {
      checks.push({
        rule_id:     ruleId,
        rule_source: APPROVAL_SOURCE,
        matched:     true,
        verdict:     "PAUSE" as const,
        reason:      "Awaiting approval",
      });
      return {
        stage:         "approval",
        verdict:       "PAUSE",
        duration_ms:   Date.now() - start,
        rules_checked: checks,
      };
    }

    // No existing approval — create new request and PAUSE
    createApprovalRequest(db, request, wf);

    checks.push({
      rule_id:     ruleId,
      rule_source: APPROVAL_SOURCE,
      matched:     true,
      verdict:     "PAUSE" as const,
      reason:      `Approval required from ${wf.require}`,
    });

    return {
      stage:         "approval",
      verdict:       "PAUSE",
      duration_ms:   Date.now() - start,
      rules_checked: checks,
    };
  }

  return {
    stage:         "approval",
    verdict:       "PASS",
    duration_ms:   Date.now() - start,
    rules_checked: checks,
  };
}


interface ApprovalQueueRow {
  id: number;
  created_at: string;
  agent_id: string;
  division_code: string | null;
  action_description: string;
  rule_triggered: string;
  status: string;
  decided_by: string | null;
  decided_at: string | null;
  metadata: string | null;
}

/**
 * Find the most recent non-expired approval record for this action + workflow.
 *
 * Matches on: agent_id + rule_triggered (workflow action pattern) + request_id
 * in metadata. Falls back to matching without request_id for backward compat.
 */
export function findApproval(
  db: Database,
  request: ActionRequest,
  workflow: ApprovalWorkflow,
): ApprovalRecord | null {
  const row = db
    .prepare<[string, string, string], ApprovalQueueRow>(
      `SELECT id, created_at, agent_id, division_code, action_description,
              rule_triggered, status, decided_by, decided_at, metadata
       FROM approval_queue
       WHERE agent_id = ?
         AND rule_triggered = ?
         AND status IN ('pending', 'approved', 'denied')
         AND created_at > datetime('now', ? || ' hours')
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get(
      request.agent_id,
      workflow.trigger.action,
      `-${workflow.timeout_hours}`,
    );

  if (row === undefined) return null;

  let metadata: Record<string, unknown> | null = null;
  if (row.metadata !== null) {
    try {
      metadata = JSON.parse(row.metadata) as Record<string, unknown>;
    } catch (e: unknown) {
      logger.warn("approval", "Approval metadata JSON malformed — treating as null", { metadata: { error: e instanceof Error ? e.message : String(e) } });
      metadata = null;
    }
  }

  return {
    id:                 row.id,
    created_at:         row.created_at,
    agent_id:           row.agent_id,
    division_code:      row.division_code,
    action_description: row.action_description,
    rule_triggered:     row.rule_triggered,
    status:             row.status as ApprovalRecord["status"],
    decided_by:         row.decided_by,
    decided_at:         row.decided_at,
    metadata,
  };
}


/**
 * Insert a new approval request into the approval_queue table.
 *
 * @returns The inserted row's id
 */
export function createApprovalRequest(
  db: Database,
  request: ActionRequest,
  workflow: ApprovalWorkflow,
): number {
  const result = db
    .prepare<[string, string | null, string, string, string], void>(
      `INSERT INTO approval_queue
         (agent_id, division_code, action_description, rule_triggered, status, metadata)
       VALUES (?, ?, ?, ?, 'pending', ?)`,
    )
    .run(
      request.agent_id,
      request.division_code,
      JSON.stringify(request.action),
      workflow.trigger.action,
      JSON.stringify({
        request_id: request.request_id,
        workflow:   { trigger: workflow.trigger, require: workflow.require },
      }),
    );

  return Number(result.lastInsertRowid);
}
