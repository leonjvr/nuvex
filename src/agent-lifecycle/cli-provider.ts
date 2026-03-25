// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 10.5: Provider CLI commands
 *
 * Registers the `sidjua provider` command group:
 *   provider list   — list registered providers with health + spend
 *   provider test   — health check a specific provider
 *   provider models — list models from a provider
 */

import type { Command } from "commander";
import { openCliDatabase } from "../cli/utils/db-init.js";
import { ProviderSetup } from "./provider-setup.js";
import { BudgetTracker } from "./budget-tracker.js";
import { runMigrations105 } from "./migration.js";


export function registerProviderCommands(program: Command): void {
  const providerCmd = program
    .command("provider")
    .description("Provider management (list, test, models)");

  // ── sidjua provider list ──────────────────────────────────────────────────

  providerCmd
    .command("list")
    .description("List registered providers with health and monthly spend")
    .option("--json",            "Output JSON", false)
    .option("--work-dir <path>", "Working directory", process.cwd())
    .action(async (opts: { json: boolean; workDir: string }) => {
      try {
        const db = openCliDatabase({ workDir: opts.workDir });
        if (db === null) { process.exit(1); return; }
        runMigrations105(db);
        const setup = new ProviderSetup(db);
        const tracker = new BudgetTracker(db);

        const providers = setup.listProviders();

        if (opts.json) {
          process.stdout.write(JSON.stringify(providers, null, 2) + "\n");
          return;
        }

        if (providers.length === 0) {
          process.stdout.write("No providers registered. Add one in governance/providers.yaml\n");
          return;
        }

        const header = "PROVIDER".padEnd(16) + "STATUS".padEnd(14) + "MODELS".padEnd(8) + "SPEND/MTH";
        process.stdout.write(header + "\n");
        process.stdout.write("-".repeat(header.length) + "\n");

        for (const p of providers) {
          const statusIcon = p.health_status === "healthy" ? "✓" : "✗";
          const models = setup.getModels(p.id);
          const monthlySpend = tracker.getDivisionMonthlySpend(p.id);

          const line =
            p.id.slice(0, 15).padEnd(16) +
            `${statusIcon} ${p.health_status}`.slice(0, 13).padEnd(14) +
            `${models.length}`.padEnd(8) +
            `$${monthlySpend.toFixed(2)}`;
          process.stdout.write(line + "\n");
        }
      } catch (err) {
        process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
        process.exit(1);
      }
    });

  // ── sidjua provider test ──────────────────────────────────────────────────

  providerCmd
    .command("test <provider>")
    .description("Run a health check against a provider")
    .option("--json",            "Output JSON", false)
    .option("--work-dir <path>", "Working directory", process.cwd())
    .action(async (providerId: string, opts: { json: boolean; workDir: string }) => {
      try {
        const db = openCliDatabase({ workDir: opts.workDir });
        if (db === null) { process.exit(1); return; }
        runMigrations105(db);
        const setup = new ProviderSetup(db);

        if (!opts.json) {
          process.stdout.write(`Testing ${providerId}...`);
        }

        const result = await setup.checkHealth(providerId);

        if (opts.json) {
          process.stdout.write(JSON.stringify(result, null, 2) + "\n");
          return;
        }

        const icon = result.status === "healthy" ? "✓" : "✗";
        const modelStr = result.models_available !== undefined
          ? ` ${result.models_available} models available.`
          : "";
        const latencyStr = result.latency_ms !== undefined
          ? ` Latency: ${result.latency_ms}ms.`
          : "";

        if (result.status === "healthy") {
          process.stdout.write(` ${icon} ${providerId} connected.${modelStr}${latencyStr}\n`);
        } else {
          process.stdout.write(` ${icon} ${providerId} ${result.status}. ${result.error ?? ""}\n`);
        }
      } catch (err) {
        process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
        process.exit(1);
      }
    });

  // ── sidjua provider models ────────────────────────────────────────────────

  providerCmd
    .command("models <provider>")
    .description("List models available from a provider")
    .option("--json",            "Output JSON", false)
    .option("--work-dir <path>", "Working directory", process.cwd())
    .action(async (providerId: string, opts: { json: boolean; workDir: string }) => {
      try {
        const db = openCliDatabase({ workDir: opts.workDir });
        if (db === null) { process.exit(1); return; }
        runMigrations105(db);
        const setup = new ProviderSetup(db);

        const models = setup.getModels(providerId);

        if (opts.json) {
          process.stdout.write(JSON.stringify(models, null, 2) + "\n");
          return;
        }

        if (models.length === 0) {
          process.stdout.write(`No models registered for provider "${providerId}"\n`);
          return;
        }

        const header = "MODEL".padEnd(28) + "TIER".padEnd(8) + "INPUT/1K".padEnd(12) + "OUTPUT/1K".padEnd(12) + "CTX";
        process.stdout.write(header + "\n");
        process.stdout.write("-".repeat(header.length) + "\n");

        for (const m of models) {
          const tier = m.tier_recommendation !== undefined ? `T${m.tier_recommendation} rec.` : "";
          const inputCost = m.cost_per_1k_input !== undefined ? `$${m.cost_per_1k_input}` : "—";
          const outputCost = m.cost_per_1k_output !== undefined ? `$${m.cost_per_1k_output}` : "—";
          const ctx = m.context_window !== undefined ? `${(m.context_window / 1000).toFixed(0)}k` : "—";

          const line =
            m.id.slice(0, 27).padEnd(28) +
            tier.padEnd(8) +
            inputCost.padEnd(12) +
            outputCost.padEnd(12) +
            ctx;
          process.stdout.write(line + "\n");
        }
      } catch (err) {
        process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
        process.exit(1);
      }
    });
}
