// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Resume flow for PAUSED actions
 *
 * When an action is PAUSED for approval, the agent receives a resume_token.
 * After a human or authorized agent grants approval, the action can be retried
 * via resumeAction(). The resume token is validated before re-running the pipeline.
 *
 * Token format: HMAC-SHA256(request_id:approval_id, system_secret), hex-encoded.
 * Stored format: "{approval_id}:{hmac}"
 *
 * The system secret is stored in the _system_keys DB table and auto-generated
 * on first use.
 */

import { hmacSign, hmacVerify, generateSecret } from "../core/crypto-utils.js";
import type { ActionRequest, GovernanceConfig, PipelineResult } from "../types/pipeline.js";
import type { Database } from "../utils/db.js";
import { GovernanceError } from "./errors.js";
import { evaluateAction } from "./index.js";

const SYSTEM_KEY_NAME = "pipeline_hmac_secret";


/**
 * Called when an agent retries a PAUSED action after approval has been granted.
 *
 * 1. Validates the resume token
 * 2. Re-runs the full pipeline (Stage 2 will find the approved entry)
 *
 * @throws GovernanceError(INVALID_RESUME_TOKEN) if token is invalid
 */
export function resumeAction(
  request: ActionRequest,
  resumeToken: string,
  governance: GovernanceConfig,
  db: Database,
): PipelineResult {
  const secret = getOrCreateSystemSecret(db);

  if (!validateResumeToken(resumeToken, request.request_id, secret)) {
    throw new GovernanceError(
      "INVALID_RESUME_TOKEN",
      "Resume token is invalid or has expired",
    );
  }

  // Re-run full pipeline — Stage 2 will find the approved entry in approval_queue
  return evaluateAction(request, governance, db);
}


interface ApprovalQueueRow {
  id: number;
  agent_id: string;
  division_code: string | null;
  action_description: string;
  rule_triggered: string;
  status: string;
}

/**
 * Called by a human or authorized agent to approve or deny a pending request.
 * Updates the approval_queue entry and writes an audit trail entry.
 */
export function resolveApproval(
  db: Database,
  approvalId: number,
  decision: "approved" | "denied",
  decidedBy: string,
): void {
  // Update the approval entry
  db.prepare<[string, string, number], void>(
    `UPDATE approval_queue
     SET status = ?, decided_by = ?, decided_at = datetime('now')
     WHERE id = ? AND status = 'pending'`,
  ).run(decision, decidedBy, approvalId);

  // Fetch the approval for audit details
  const approval = db
    .prepare<[number], ApprovalQueueRow>(
      `SELECT id, agent_id, division_code, action_description, rule_triggered, status
       FROM approval_queue WHERE id = ?`,
    )
    .get(approvalId);

  if (approval === undefined) return;

  // Write audit trail entry for the approval decision
  db.prepare<[string, string | null, string, string, string, string], void>(
    `INSERT INTO audit_trail
       (agent_id, division_code, action_type, action_detail, output_summary,
        classification, metadata)
     VALUES (?, ?, ?, ?, ?, 'INTERNAL', ?)`,
  ).run(
    decidedBy,
    approval.division_code,
    decision === "approved" ? "approval_granted" : "approval_denied",
    `${decision} request #${approvalId}: ${approval.rule_triggered}`,
    decision,
    JSON.stringify({ approval_id: approvalId, original_agent: approval.agent_id }),
  );
}


/**
 * Generate a resume token for a PAUSED action.
 *
 * Format: "{approval_id}:{hmac_hex}"
 * HMAC input: "{request_id}:{approval_id}"
 */
export function generateResumeToken(
  requestId: string,
  approvalId: number,
  secret: string,
): string {
  const message = `${requestId}:${approvalId}`;
  const hmac    = hmacSign(secret, message).toString("hex");
  return `${approvalId}:${hmac}`;
}


/**
 * Validate a resume token.
 *
 * Parses the approval_id from the token, recomputes the expected HMAC,
 * and compares using timing-safe comparison.
 */
export function validateResumeToken(
  token: string,
  requestId: string,
  secret: string,
): boolean {
  const separatorIdx = token.indexOf(":");
  if (separatorIdx === -1) return false;

  const approvalIdStr = token.slice(0, separatorIdx);
  const providedHmac  = token.slice(separatorIdx + 1);

  const approvalId = parseInt(approvalIdStr, 10);
  if (isNaN(approvalId)) return false;

  const message      = `${requestId}:${approvalId}`;
  // Decode provided hex back to bytes for timing-safe comparison against recomputed HMAC
  const providedBuf  = Buffer.from(providedHmac, "hex");
  return hmacVerify(secret, message, providedBuf);
}


interface SystemKeyRow {
  key_value: string;
}

/**
 * Load the HMAC signing secret from _system_keys, generating and storing it
 * if it does not yet exist.
 */
export function getOrCreateSystemSecret(db: Database): string {
  const row = db
    .prepare<[string], SystemKeyRow>(
      `SELECT key_value FROM _system_keys WHERE key_name = ?`,
    )
    .get(SYSTEM_KEY_NAME);

  if (row !== undefined) return row.key_value;

  const secret = generateSecret();
  db.prepare<[string, string], void>(
    `INSERT OR IGNORE INTO _system_keys (key_name, key_value) VALUES (?, ?)`,
  ).run(SYSTEM_KEY_NAME, secret);

  return secret;
}
