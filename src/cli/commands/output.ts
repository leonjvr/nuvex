// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 14: Output & Summary CLI Commands
 *
 * sidjua output list <task-id>   — List outputs for a task
 * sidjua output show <output-id> — Show output content
 * sidjua output search <query>   — Semantic search
 * sidjua output stats            — Show statistics
 * sidjua summary show <task-id>  — Show latest summary
 */

import type { Command } from "commander";
import { openDatabase }          from "../../utils/db.js";
import { TaskOutputStore }       from "../../tasks/output-store.js";
import { TaskSummaryStore }      from "../../tasks/summary-store.js";
import { TaskOutputEmbedder }    from "../../tasks/output-embedder.js";
import { CommunicationManager }  from "../../tasks/communication-manager.js";
import { isSidjuaError }         from "../../core/error-codes.js";
import { formatBytes }           from "../utils/format.js";
import { join }                  from "node:path";


function makeManager(workDir: string): CommunicationManager {
  const db = openDatabase(join(workDir, ".system", "sidjua.db"));
  db.pragma("journal_mode = WAL");
  const outputStore  = new TaskOutputStore(db);
  const summaryStore = new TaskSummaryStore(db);
  const embedder     = new TaskOutputEmbedder(db, null);
  outputStore.initialize();
  summaryStore.initialize();
  embedder.initialize();
  return new CommunicationManager(outputStore, summaryStore, embedder);
}


export function registerOutputCommands(program: Command): void {
  // ── sidjua output ─────────────────────────────────────────────────────────
  const outputCmd = program
    .command("output")
    .description("Inspect task outputs and semantic search");

  // ── sidjua output list <task-id> ──────────────────────────────────────────
  outputCmd
    .command("list <task-id>")
    .description("List all outputs for a task")
    .option("--work-dir <path>", "Workspace directory", process.cwd())
    .action((taskId: string, opts: { workDir: string }) => {
      try {
        const cm      = makeManager(opts.workDir);
        const outputs = cm.getTaskOutputs(taskId);

        if (outputs.length === 0) {
          process.stdout.write(`No outputs found for task ${taskId}.\n`);
          return;
        }

        process.stdout.write(`Outputs for task ${taskId}:\n`);
        process.stdout.write(
          `${"ID".padEnd(38)} ${"Type".padEnd(10)} ${"Class".padEnd(14)} ${"Size".padEnd(10)} Created\n`,
        );
        process.stdout.write(`${"-".repeat(38)} ${"-".repeat(10)} ${"-".repeat(14)} ${"-".repeat(10)} -------\n`);

        for (const o of outputs) {
          const size = o.content_text
            ? formatBytes(Buffer.byteLength(o.content_text, "utf-8"))
            : o.content_binary
              ? formatBytes(o.content_binary.length)
              : "—";
          process.stdout.write(
            `${o.id.padEnd(38)} ${o.output_type.padEnd(10)} ${o.classification.padEnd(14)} ${size.padEnd(10)} ${new Date(o.created_at).toLocaleString()}\n`,
          );
        }
        process.stdout.write(`  ${outputs.length} output${outputs.length === 1 ? "" : "s"} total\n`);
      } catch (err) {
        process.stderr.write(`Error: ${isSidjuaError(err) ? err.message : String(err)}\n`);
        process.exit(1);
      }
    });

  // ── sidjua output show <output-id> ────────────────────────────────────────
  outputCmd
    .command("show <output-id>")
    .description("Show content of a specific output")
    .option("--work-dir <path>", "Workspace directory", process.cwd())
    .action((outputId: string, opts: { workDir: string }) => {
      try {
        const db = openDatabase(join(opts.workDir, ".system", "sidjua.db"));
        db.pragma("journal_mode = WAL");
        const store = new TaskOutputStore(db);
        store.initialize();
        const output = store.getById(outputId);
        if (output === null) {
          process.stderr.write(`Error: Output "${outputId}" not found.\n`);
          process.exit(1);
        }
        process.stdout.write(`Output: ${output.id}\n`);
        process.stdout.write(`  Type:           ${output.output_type}\n`);
        process.stdout.write(`  Task ID:        ${output.task_id}\n`);
        process.stdout.write(`  Agent:          ${output.agent_id}\n`);
        process.stdout.write(`  Classification: ${output.classification}\n`);
        process.stdout.write(`  Hash:           ${output.content_hash.slice(0, 16)}…\n`);
        process.stdout.write(`  Created:        ${output.created_at}\n`);
        if (output.filename)   process.stdout.write(`  Filename:       ${output.filename}\n`);
        if (output.mime_type)  process.stdout.write(`  MIME type:      ${output.mime_type}\n`);
        if (output.content_text) {
          process.stdout.write(`\nContent:\n${output.content_text}\n`);
        } else {
          process.stdout.write(`\n(Binary content — use API to download)\n`);
        }
      } catch (err) {
        process.stderr.write(`Error: ${isSidjuaError(err) ? err.message : String(err)}\n`);
        process.exit(1);
      }
    });

  // ── sidjua output search <query> ──────────────────────────────────────────
  outputCmd
    .command("search <query>")
    .description("Semantic search across all task outputs")
    .option("--work-dir <path>", "Workspace directory", process.cwd())
    .option("--limit <n>",       "Max results", "5")
    .action(async (query: string, opts: { workDir: string; limit: string }) => {
      try {
        const cm    = makeManager(opts.workDir);
        const limit = parseInt(opts.limit, 10);
        const results = await cm.searchOutputs(query, { limit: isNaN(limit) ? 5 : limit });

        if (results.length === 0) {
          process.stdout.write(`No results for "${query}".\n`);
          return;
        }

        process.stdout.write(`Search results for "${query}":\n`);
        process.stdout.write(
          `${"Score".padEnd(7)} ${"Task ID".padEnd(10)} ${"Agent".padEnd(16)} ${"Type".padEnd(10)} Snippet\n`,
        );
        process.stdout.write(`${"-".repeat(7)} ${"-".repeat(10)} ${"-".repeat(16)} ${"-".repeat(10)} -------\n`);

        for (const r of results) {
          process.stdout.write(
            `${r.score.toFixed(2).padEnd(7)} ${r.task_id.slice(0, 8).padEnd(10)} ${r.agent_id.slice(0, 14).padEnd(16)} ${r.output_type.padEnd(10)} "${r.summary_snippet.slice(0, 40)}"\n`,
          );
        }
      } catch (err) {
        process.stderr.write(`Error: ${isSidjuaError(err) ? err.message : String(err)}\n`);
        process.exit(1);
      }
    });

  // ── sidjua output stats ────────────────────────────────────────────────────
  outputCmd
    .command("stats")
    .description("Show output and summary statistics")
    .option("--work-dir <path>", "Workspace directory", process.cwd())
    .action((opts: { workDir: string }) => {
      try {
        const cm    = makeManager(opts.workDir);
        const stats = cm.getStats();
        process.stdout.write(`Output Statistics:\n`);
        process.stdout.write(`  Total outputs:   ${stats.total_outputs}\n`);
        process.stdout.write(`  Total summaries: ${stats.total_summaries}\n`);
        if (Object.keys(stats.outputs_by_type).length > 0) {
          process.stdout.write(`\nBy type:\n`);
          for (const [t, n] of Object.entries(stats.outputs_by_type)) {
            process.stdout.write(`  ${t.padEnd(12)} ${n}\n`);
          }
        }
        if (Object.keys(stats.outputs_by_classification).length > 0) {
          process.stdout.write(`\nBy classification:\n`);
          for (const [cl, n] of Object.entries(stats.outputs_by_classification)) {
            process.stdout.write(`  ${cl.padEnd(14)} ${n}\n`);
          }
        }
      } catch (err) {
        process.stderr.write(`Error: ${isSidjuaError(err) ? err.message : String(err)}\n`);
        process.exit(1);
      }
    });

  // ── sidjua summary ────────────────────────────────────────────────────────
  const summaryCmd = program
    .command("summary")
    .description("Inspect governed task summaries");

  // ── sidjua summary show <task-id> ─────────────────────────────────────────
  summaryCmd
    .command("show <task-id>")
    .description("Show the latest summary for a task")
    .option("--work-dir <path>", "Workspace directory", process.cwd())
    .action((taskId: string, opts: { workDir: string }) => {
      try {
        const cm      = makeManager(opts.workDir);
        const summary = cm.getTaskSummary(taskId);
        if (summary === null) {
          process.stdout.write(`No summary found for task ${taskId}.\n`);
          return;
        }
        process.stdout.write(`Summary for task ${taskId}:\n`);
        process.stdout.write(`  ID:         ${summary.id}\n`);
        process.stdout.write(`  Status:     ${summary.status}\n`);
        process.stdout.write(`  Agent:      ${summary.agent_id}\n`);
        process.stdout.write(`  Escalation: ${summary.escalation_needed ? "Yes" : "No"}\n`);
        process.stdout.write(`  Created:    ${summary.created_at}\n`);
        process.stdout.write(`\nSummary:\n${summary.summary_text}\n`);
        if (summary.key_facts.length > 0) {
          process.stdout.write(`\nKey Facts:\n`);
          for (const f of summary.key_facts) {
            process.stdout.write(`  • ${f}\n`);
          }
        }
        if (summary.decisions.length > 0) {
          process.stdout.write(`\nDecisions:\n`);
          for (const d of summary.decisions) {
            process.stdout.write(`  • ${d}\n`);
          }
        }
      } catch (err) {
        process.stderr.write(`Error: ${isSidjuaError(err) ? err.message : String(err)}\n`);
        process.exit(1);
      }
    });
}
