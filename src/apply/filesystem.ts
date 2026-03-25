// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Step 2: FILESYSTEM
 *
 * Provisions the workspace directory structure from a validated ParsedConfig.
 *
 * Two public functions:
 *   planFilesystem(config, workDir)  → FilesystemOp[]  (no side effects — enables dry-run)
 *   executeFilesystemOps(ops, workDir) → FilesystemResult (performs disk writes)
 *   applyFilesystem(config, workDir) → FilesystemResult (convenience: plan + execute)
 *
 * All paths in FilesystemOp are relative to workDir (prefixed with "/" by convention,
 * matching the spec's notation). The executor joins them: path.join(workDir, op.path).
 *
 * Idempotency rules (from spec):
 *   mkdir + overwrite:false  → skip if directory already exists
 *   write + overwrite:false  → skip if file already exists
 *   write + overwrite:true   → always write (metadata, generated files)
 *   Never delete directories on re-apply
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import type { ParsedConfig, Division } from "../types/config.js";
import type { FilesystemOp, FilesystemResult } from "../types/apply.js";
import { ApplyError } from "../types/apply.js";


const DIVISION_SUBDIRS = ["inbox", "outbox", "workspace", "knowledge", "archive", ".meta"] as const;


/**
 * Generate the list of filesystem operations required for the given config.
 * Does NOT touch the disk — safe to call for dry-run inspection.
 *
 * All paths are relative to `workDir`, prefixed with "/" per spec convention.
 *
 * @param config Validated ParsedConfig (output of Step 1)
 * @returns Ordered list of FilesystemOps to execute
 */
export function planFilesystem(config: ParsedConfig): FilesystemOp[] {
  const ops: FilesystemOp[] = [];

  if (config.mode === "personal") {
    planPersonalMode(ops);
  } else {
    planBusinessMode(config, ops);
  }

  // System dirs and archive — always created regardless of mode
  ops.push({ type: "mkdir", path: "/.system", overwrite: false });
  ops.push({ type: "mkdir", path: "/archive", overwrite: false });

  return ops;
}


/**
 * Execute a list of FilesystemOps against the given working directory.
 * Idempotent — safe to call multiple times with the same ops.
 *
 * @param ops Operations to execute (from planFilesystem)
 * @param workDir Absolute path to the workspace root
 * @returns Counts of created/written/skipped operations
 * @throws {ApplyError} with category FILESYSTEM_ERROR on disk failures
 */
export function executeFilesystemOps(ops: FilesystemOp[], workDir: string): FilesystemResult {
  let created = 0;
  let written = 0;
  let skipped = 0;

  for (const op of ops) {
    const absPath = resolveOpPath(op.path, workDir);

    try {
      if (op.type === "mkdir") {
        if (existsSync(absPath)) {
          skipped++;
        } else {
          mkdirSync(absPath, { recursive: true });
          created++;
        }
      } else if (op.type === "write") {
        if (!op.overwrite && existsSync(absPath)) {
          skipped++;
        } else {
          // Ensure parent directory exists
          const parent = dirname(absPath);
          if (!existsSync(parent)) {
            mkdirSync(parent, { recursive: true });
          }
          writeFileSync(absPath, op.content ?? "", "utf-8");
          written++;
        }
      } else if (op.type === "copy_template") {
        if (!op.overwrite && existsSync(absPath)) {
          skipped++;
        } else {
          // Template resolution is the caller's responsibility (op.content populated by planner)
          const parent = dirname(absPath);
          if (!existsSync(parent)) {
            mkdirSync(parent, { recursive: true });
          }
          writeFileSync(absPath, op.content ?? "", "utf-8");
          written++;
        }
      } else if (op.type === "skip_existing") {
        skipped++;
      }
    } catch (err) {
      throw new ApplyError(
        "FILESYSTEM_ERROR",
        "FILESYSTEM",
        `Failed to ${op.type} at "${absPath}": ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
  }

  return { ops, created, skipped, written };
}

/**
 * Convenience function: plan + execute in one call.
 */
export function applyFilesystem(config: ParsedConfig, workDir: string): FilesystemResult {
  const ops = planFilesystem(config);
  return executeFilesystemOps(ops, workDir);
}


function planBusinessMode(config: ParsedConfig, ops: FilesystemOp[]): void {
  for (const div of config.activeDivisions) {
    // Create each standard subdirectory
    for (const subdir of DIVISION_SUBDIRS) {
      ops.push({
        type: "mkdir",
        path: `/${div.code}/${subdir}`,
        overwrite: false,
      });
    }

    // Write division metadata — always overwritten (overwrite: true)
    ops.push({
      type: "write",
      path: `/${div.code}/.meta/division.json`,
      content: JSON.stringify(divisionMeta(div), null, 2),
      overwrite: true,
    });
  }

  // governance/ — verified to exist but NOT created by apply (per spec comment)
  // We skip creating it; the spec says "not created by apply, only verified".
  // Verification happens at runtime, not at planning time.
}


function planPersonalMode(ops: FilesystemOp[]): void {
  // workspace tree
  ops.push({ type: "mkdir", path: "/workspace/projects", overwrite: false });
  ops.push({ type: "mkdir", path: "/workspace/knowledge", overwrite: false });
  ops.push({ type: "mkdir", path: "/workspace/templates", overwrite: false });

  // governance
  ops.push({ type: "mkdir", path: "/governance", overwrite: false });
  ops.push({ type: "mkdir", path: "/governance/boundaries", overwrite: false });
  ops.push({ type: "mkdir", path: "/governance/security",   overwrite: false });

  // Generate security.yaml if not exists
  ops.push({
    type:      "write",
    path:      "/governance/security/security.yaml",
    content:   SECURITY_YAML_TEMPLATE,
    overwrite: false, // preserve user customizations
  });

  // Generate my-rules.yaml if not exists
  ops.push({
    type: "write",
    path: "/governance/my-rules.yaml",
    content: MY_RULES_TEMPLATE,
    overwrite: false, // preserve user customizations
  });

  // Generate forbidden-actions.yaml if not exists
  ops.push({
    type: "write",
    path: "/governance/boundaries/forbidden-actions.yaml",
    content: FORBIDDEN_ACTIONS_TEMPLATE,
    overwrite: false, // preserve user customizations
  });

  // ai-governance tree
  ops.push({ type: "mkdir", path: "/ai-governance/agents", overwrite: false });
  ops.push({ type: "mkdir", path: "/ai-governance/skills", overwrite: false });
  ops.push({ type: "mkdir", path: "/ai-governance/audit-trail", overwrite: false });
}


/**
 * Build the content of /{division.code}/.meta/division.json
 */
export function divisionMeta(div: Division): Record<string, unknown> {
  return {
    code: div.code,
    name: div.name,
    scope: div.scope,
    required: div.required,
    active: div.active,
    recommend_from: div.recommend_from,
    head: div.head,
    generated_at: new Date().toISOString(),
  };
}


/**
 * Resolve an op path (e.g. "/engineering/inbox") to an absolute path
 * under the given workDir.
 *
 * The leading "/" in op paths is a spec convention denoting "relative to workDir".
 * We strip it and join with workDir.
 */
function resolveOpPath(opPath: string, workDir: string): string {
  // Strip leading slash and normalize to avoid path traversal
  const relative = opPath.startsWith("/") ? opPath.slice(1) : opPath;
  const result = normalize(join(workDir, relative));

  // Safety: ensure result is still under workDir
  if (!result.startsWith(normalize(workDir))) {
    throw new ApplyError(
      "FILESYSTEM_ERROR",
      "FILESYSTEM",
      `Path "${opPath}" resolves outside workDir "${workDir}" — possible path traversal`,
    );
  }

  return result;
}


const MY_RULES_TEMPLATE = `# SIDJUA Personal Governance Rules
# Auto-generated by sidjua apply — customize as needed.
schema_version: "1.0"

rules: []
  # Example:
  # - rule: no_financial_actions
  #   description: "Never initiate purchases or financial transactions"
  #   applies_to: ["purchase.*", "invoice.*"]
  #   severity: hard
`;

const FORBIDDEN_ACTIONS_TEMPLATE = `# SIDJUA Personal Forbidden Actions
# Auto-generated by sidjua apply — customize as needed.
schema_version: "1.0"

forbidden:
  - action: contract.sign
    reason: "Contracts require human signature"
    escalate_to: OWNER

  - action: purchase.initiate
    reason: "Financial transactions require human authorization"
    escalate_to: OWNER
`;

const SECURITY_YAML_TEMPLATE = `# SIDJUA Security Filter Configuration
# Auto-generated by sidjua apply — customize as needed.
#
# Modes:
#   blacklist — block specific targets; allow everything else (default)
#   whitelist — allow only listed targets; block everything else
#
# Change mode: sidjua governance security-mode [blacklist|whitelist]

filter:
  mode: blacklist
  blocked: []
    # Example:
    # - pattern: "*.malicious.tld"
    #   applies_to: ["web.fetch", "api.call", "web.post"]
    #   reason: "Known malicious domain family"
  allowed: []
  allowed_networks: []
`;
