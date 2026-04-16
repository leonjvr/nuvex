// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — CLI output formatting
 *
 * All terminal output is funnelled through these functions so tests can
 * capture stdout/stderr without monkey-patching console.
 */

import type { StepResult, ApplyResult, FilesystemOp, StateFile } from "../types/apply.js";

// Width of the step-name column (longest step: "COST_CENTERS" = 12 chars + 1 space = 13)
const STEP_WIDTH = 13;


/**
 * Format a millisecond duration for display.
 *   0    → "0ms"
 *   500  → "500ms"
 *   1000 → "1.0s"
 *   1500 → "1.5s"
 */
export function formatMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
}


/**
 * Format a single step result into the canonical output line:
 *   "  ✓ VALIDATE      12 active, 2 inactive divisions  [42ms]"
 *   "  ✗ DATABASE      disk full  [3ms]"
 */
export function formatStepLine(step: StepResult): string {
  const icon = step.success ? "✓" : "✗";
  const name = step.step.padEnd(STEP_WIDTH);
  return `  ${icon} ${name} ${step.summary}  [${formatMs(step.duration_ms)}]`;
}


/**
 * Print the full apply result: one line per step, then the summary line.
 *
 * In verbose mode, each step's details dict is printed as indented key/value
 * lines below the step line.
 */
export function printApplyResult(result: ApplyResult, verbose = false): void {
  for (const step of result.steps) {
    process.stdout.write(formatStepLine(step) + "\n");

    if (verbose && step.details !== undefined) {
      for (const [k, v] of Object.entries(step.details)) {
        process.stdout.write(`        ${k}: ${JSON.stringify(v)}\n`);
      }
    }
  }

  const label = result.success ? "Applied" : "Failed";
  process.stdout.write(`  ${label} in ${formatMs(result.duration_ms)}.\n`);
}


/**
 * Print a dry-run plan summary (no filesystem or DB writes have been made).
 */
export function printDryRunPlan(validationSummary: string, ops: FilesystemOp[]): void {
  const mkdir = ops.filter((o) => o.type === "mkdir").length;
  const write = ops.filter((o) => o.type === "write" || o.type === "copy_template").length;
  const skip = ops.filter((o) => o.type === "skip_existing").length;

  process.stdout.write(`  [dry-run] VALIDATE    ${validationSummary}\n`);
  process.stdout.write(
    `  [dry-run] FILESYSTEM  ${mkdir} directories, ${write} files (${skip} would skip)\n`,
  );
  process.stdout.write("  (dry-run: no changes made)\n");
}


/**
 * Print the workspace status from a loaded state.json.
 */
export function printStatus(state: StateFile): void {
  const la = state.last_apply;
  process.stdout.write(`Last apply:    ${la.timestamp}\n`);
  process.stdout.write(`Mode:          ${la.mode}\n`);
  process.stdout.write(`Active:        ${la.active_divisions.join(", ")}\n`);
  if (la.inactive_divisions.length > 0) {
    process.stdout.write(`Inactive:      ${la.inactive_divisions.join(", ")}\n`);
  }
  process.stdout.write(`Agents:        ${la.agent_count}\n`);
  process.stdout.write(`Duration:      ${formatMs(la.apply_duration_ms)}\n`);
  process.stdout.write(`DB version:    ${la.db_version}\n`);
  process.stdout.write(`History:       ${state.history.length} run(s)\n`);
}
