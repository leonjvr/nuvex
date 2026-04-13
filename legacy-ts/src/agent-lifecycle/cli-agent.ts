// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 10.5: Agent CLI commands
 *
 * Registers the `sidjua agent` command group:
 *   agent create    — create agent from YAML, template, or interactive wizard
 *   agent list      — list all agents with status and cost
 *   agent show      — show full agent details
 *   agent edit      — edit agent definition
 *   agent start     — activate an agent
 *   agent stop      — deactivate an agent
 *   agent delete    — remove an agent
 *   agent health    — show agent health info
 *   agent templates — list available templates
 */

import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { readFile, writeFile, access, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Command } from "commander";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { openCliDatabase } from "../cli/utils/db-init.js";
import { createLogger } from "../core/logger.js";

const logger = createLogger("cli-agent");
import { AgentRegistry } from "./agent-registry.js";
import { AgentValidator } from "./agent-validator.js";
import { AgentTemplateLoader } from "./agent-template.js";
import { BudgetTracker } from "./budget-tracker.js";
import { HotReconfigure } from "./hot-reconfigure.js";
import { runMigrations105 } from "./migration.js";
import { getDefaultCatalog } from "../providers/catalog.js";
import { ProviderKeyManager } from "../providers/key-manager.js";
import type { AgentLifecycleDefinition } from "./types.js";


export function registerAgentCommands(program: Command): void {
  const agentCmd = program
    .command("agent")
    .description("Agent lifecycle management (create, list, edit, start, stop, delete)");

  // ── sidjua agent create ───────────────────────────────────────────────────

  agentCmd
    .command("create [id]")
    .description("Create a new agent definition")
    .option("--template <id>",         "Start from a built-in or custom template")
    .option("--file <path>",           "Load definition from YAML file")
    .option("--name <name>",           "Agent display name")
    .option("--tier <n>",              "Agent tier (1-3)", "3")
    .option("--provider <id>",         "LLM provider (e.g. anthropic)")
    .option("--model <id>",            "Model ID (e.g. claude-sonnet-4-5)")
    .option("--division <code>",       "Division code")
    .option("--capabilities <list>",   "Comma-separated capability list")
    .option("--budget-per-task <usd>", "Max cost per task")
    .option("--budget-monthly <usd>",  "Monthly budget cap")
    .option("--skill <path>",          "Path to skill.md file")
    .option("--quick",                 "Minimal prompts (personal mode)", false)
    .option("--json",                  "Output JSON", false)
    .option("--work-dir <path>",       "Working directory", process.cwd())
    .action(async (id: string | undefined, opts: {
      template?:      string;
      file?:          string;
      name?:          string;
      tier:           string;
      provider?:      string;
      model?:         string;
      division?:      string;
      capabilities?:  string;
      budgetPerTask?: string;
      budgetMonthly?: string;
      skill?:         string;
      quick:          boolean;
      json:           boolean;
      workDir:        string;
    }) => {
      try {
        const db = openCliDatabase({ workDir: opts.workDir });
        if (db === null) { process.exit(1); return; }
        db.pragma("foreign_keys = ON");
        runMigrations105(db);
        const registry = new AgentRegistry(db);
        const validator = new AgentValidator(db);
        const templateLoader = new AgentTemplateLoader(
          join(opts.workDir, "agents", "templates"),
        );

        let def: AgentLifecycleDefinition;

        if (opts.file !== undefined) {
          // Load from file
          const raw = await readFile(opts.file, "utf-8");
          def = parseYaml(raw) as AgentLifecycleDefinition;
        } else if (opts.template !== undefined) {
          // Expand from template
          const overrides: Partial<AgentLifecycleDefinition> = buildOverrides(id, opts);
          def = await templateLoader.expand(opts.template, overrides);
        } else if (opts.quick && id !== undefined) {
          // Quick mode: build from flags with sensible defaults — zero interactive prompts
          const quickOpts = {
            ...opts,
            provider: opts.provider ?? "cloudflare",
            model:    opts.model    ?? "@cf/meta/llama-4-scout-17b-16e-instruct",
            division: opts.division ?? "default",
            name:     opts.name     ?? id,
          };
          const overrides: Partial<AgentLifecycleDefinition> = buildOverrides(id, quickOpts);
          // Explicitly set skill to "" if not provided — prevents expand() from generating
          // a default path that doesn't exist yet (BUG 3)
          if (overrides.skill === undefined) overrides.skill = "";
          def = await templateLoader.expand("custom", overrides);
        } else if (hasEnoughFlags(id, opts)) {
          // Build from flags
          const overrides: Partial<AgentLifecycleDefinition> = buildOverrides(id, opts);
          def = await templateLoader.expand("custom", overrides);
        } else {
          // Interactive wizard
          def = await interactiveCreate(opts.quick, id, {
            workDir:        opts.workDir,
            ...(opts.budgetPerTask !== undefined && { budgetPerTask: opts.budgetPerTask }),
            ...(opts.budgetMonthly !== undefined && { budgetMonthly: opts.budgetMonthly }),
          }, templateLoader);
        }

        // Validate
        const validation = await validator.validate(def, { workDir: opts.workDir });
        if (!validation.valid) {
          if (opts.json) {
            process.stdout.write(JSON.stringify({ success: false, errors: validation.errors }, null, 2) + "\n");
          } else {
            process.stderr.write(`Agent definition invalid:\n`);
            for (const e of validation.errors) process.stderr.write(`  ✗ ${e}\n`);
          }
          process.exit(1);
        }

        if (validation.warnings.length > 0 && !opts.json) {
          for (const w of validation.warnings) process.stderr.write(`  ⚠ ${w}\n`);
        }

        // Persist
        const row = registry.create(def);

        if (opts.json) {
          process.stdout.write(JSON.stringify({ success: true, agent: row }, null, 2) + "\n");
        } else {
          process.stdout.write(`✓ Agent "${row.id}" created (status: ${row.status})\n`);
          process.stdout.write(`  Tier: T${row.tier}  Provider: ${row.provider}  Model: ${row.model}\n`);
          process.stdout.write(`  Division: ${row.division}  Skill: ${row.skill_path}\n`);
        }
      } catch (err) {
        process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
        process.exit(1);
      }
    });

  // ── sidjua agent list ─────────────────────────────────────────────────────

  agentCmd
    .command("list")
    .description("List all agents")
    .option("--division <code>",  "Filter by division")
    .option("--tier <n>",         "Filter by tier")
    .option("--status <s>",       "Filter by status")
    .option("--json",             "Output JSON", false)
    .option("--work-dir <path>",  "Working directory", process.cwd())
    .action(async (opts: {
      division?: string;
      tier?:     string;
      status?:   string;
      json:      boolean;
      workDir:   string;
    }) => {
      try {
        const db = openCliDatabase({ workDir: opts.workDir });
        if (db === null) { process.exit(1); return; }
        runMigrations105(db);
        const registry = new AgentRegistry(db);
        const tracker = new BudgetTracker(db);

        const rows = registry.list({
          ...(opts.division !== undefined ? { division: opts.division } : {}),
          ...(opts.tier !== undefined ? { tier: parseInt(opts.tier, 10) } : {}),
          ...(opts.status !== undefined ? { status: opts.status as import("./types.js").AgentLifecycleStatus } : {}),
        });

        if (opts.json) {
          process.stdout.write(JSON.stringify(rows, null, 2) + "\n");
          return;
        }

        if (rows.length === 0) {
          process.stdout.write("No agents found.\n");
          return;
        }

        const header = "ID".padEnd(20) + "TIER".padEnd(6) + "PROVIDER".padEnd(12) + "MODEL".padEnd(24) + "DIV".padEnd(14) + "STATUS".padEnd(10) + "COST/MTH";
        process.stdout.write(header + "\n");
        process.stdout.write("-".repeat(header.length) + "\n");

        for (const row of rows) {
          const costMth = tracker.getAgentMonthlySpend(row.id);
          const line =
            row.id.slice(0, 19).padEnd(20) +
            `T${row.tier}`.padEnd(6) +
            row.provider.slice(0, 11).padEnd(12) +
            row.model.slice(0, 23).padEnd(24) +
            row.division.slice(0, 13).padEnd(14) +
            row.status.slice(0, 9).padEnd(10) +
            `$${costMth.toFixed(2)}`;
          process.stdout.write(line + "\n");
        }

        const hasStoppedAgents = rows.some((r) => r.status === "stopped");
        if (hasStoppedAgents) {
          process.stdout.write("\nTip: Talk to Guide to start an agent:  sidjua chat guide\n");
        }
      } catch (err) {
        process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
        process.exit(1);
      }
    });

  // ── sidjua agent show ─────────────────────────────────────────────────────

  agentCmd
    .command("show <id>")
    .description("Show full agent definition and status")
    .option("--json",            "Output JSON", false)
    .option("--work-dir <path>", "Working directory", process.cwd())
    .action(async (id: string, opts: { json: boolean; workDir: string }) => {
      try {
        const db = openCliDatabase({ workDir: opts.workDir });
        if (db === null) { process.exit(1); return; }
        runMigrations105(db);
        const registry = new AgentRegistry(db);
        const tracker = new BudgetTracker(db);

        const row = registry.getById(id);
        if (row === undefined) {
          process.stderr.write(`Agent "${id}" not found\n`);
          process.exit(1);
        }

        const def = registry.parseConfigYaml(row.config_yaml);
        const monthlySpend = tracker.getAgentMonthlySpend(id);
        const monthlyLimit = def.budget?.per_month_usd ?? null;

        if (opts.json) {
          process.stdout.write(
            JSON.stringify({ ...row, parsed_config: def, monthly_spend_usd: monthlySpend }, null, 2) + "\n",
          );
          return;
        }

        process.stdout.write(`Agent: ${row.id}\n`);
        process.stdout.write(`  Name:     ${row.name}\n`);
        process.stdout.write(`  Status:   ${row.status}\n`);
        process.stdout.write(`  Tier:     T${row.tier}\n`);
        process.stdout.write(`  Division: ${row.division}\n`);
        process.stdout.write(`  Provider: ${row.provider} / ${row.model}\n`);
        process.stdout.write(`  Skill:    ${row.skill_path}\n`);
        if (def.reports_to !== undefined) process.stdout.write(`  Reports to: ${def.reports_to}\n`);
        process.stdout.write(`  Capabilities: ${def.capabilities?.join(", ") ?? "none"}\n`);
        if (monthlyLimit !== null) {
          process.stdout.write(
            `  Budget:   $${monthlySpend.toFixed(2)} / $${monthlyLimit.toFixed(2)} this month\n`,
          );
        }
        process.stdout.write(`  Created:  ${row.created_at} by ${row.created_by}\n`);
        process.stdout.write(`  Updated:  ${row.updated_at}\n`);
        process.stdout.write(`  Hash:     ${row.config_hash}\n`);
      } catch (err) {
        process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
        process.exit(1);
      }
    });

  // ── sidjua agent edit ─────────────────────────────────────────────────────

  agentCmd
    .command("edit <id>")
    .description("Edit an agent definition")
    .option("--model <id>",           "Change model")
    .option("--budget-monthly <usd>", "Change monthly budget")
    .option("--budget-per-task <usd>","Change per-task budget")
    .option("--division <code>",      "Change division (requires restart)")
    .option("--tier <n>",             "Change tier (requires restart)")
    .option("--skill <path>",         "Change skill file path")
    .option("--json",                 "Output JSON", false)
    .option("--work-dir <path>",      "Working directory", process.cwd())
    .action(async (id: string, opts: {
      model?:          string;
      budgetMonthly?:  string;
      budgetPerTask?:  string;
      division?:       string;
      tier?:           string;
      skill?:          string;
      json:            boolean;
      workDir:         string;
    }) => {
      try {
        const db = openCliDatabase({ workDir: opts.workDir });
        if (db === null) { process.exit(1); return; }
        runMigrations105(db);
        const registry = new AgentRegistry(db);
        const reconfigurer = new HotReconfigure();

        const existing = registry.getById(id);
        if (existing === undefined) {
          process.stderr.write(`Agent "${id}" not found\n`);
          process.exit(1);
        }

        const existingDef = registry.parseConfigYaml(existing.config_yaml);
        const patch: Partial<AgentLifecycleDefinition> = {};

        if (opts.model !== undefined) patch.model = opts.model;
        if (opts.division !== undefined) patch.division = opts.division;
        if (opts.tier !== undefined) patch.tier = parseInt(opts.tier, 10);
        if (opts.skill !== undefined) patch.skill = opts.skill;
        if (opts.budgetMonthly !== undefined || opts.budgetPerTask !== undefined) {
          patch.budget = {
            ...existingDef.budget,
            ...(opts.budgetMonthly !== undefined ? { per_month_usd: parseFloat(opts.budgetMonthly) } : {}),
            ...(opts.budgetPerTask !== undefined ? { per_task_usd: parseFloat(opts.budgetPerTask) } : {}),
          };
        }

        const { result } = reconfigurer.applyPatch(existingDef, patch);
        const updated = registry.update(id, patch);

        if (opts.json) {
          process.stdout.write(JSON.stringify({ success: true, agent: updated, changes: result }, null, 2) + "\n");
          return;
        }

        if (!result.config_hash_changed) {
          process.stdout.write(`No changes detected for agent "${id}"\n`);
          return;
        }

        process.stdout.write(`✓ Agent "${id}" updated\n`);
        for (const change of result.changes) {
          process.stdout.write(
            `  ${change.field}: ${JSON.stringify(change.old_value)} → ${JSON.stringify(change.new_value)}${change.requires_restart ? " (restart required)" : ""}\n`,
          );
        }

        if (result.requires_restart) {
          process.stdout.write(`\n⚠ Restart required: ${result.restart_reason}\n`);
          process.stdout.write(`  Run: sidjua agent stop ${id} && sidjua agent start ${id}\n`);
        }
      } catch (err) {
        process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
        process.exit(1);
      }
    });

  // ── sidjua agent start ────────────────────────────────────────────────────

  agentCmd
    .command("start <id>")
    .description("Activate an agent (mark as ready to receive tasks)")
    .option("--json",            "Output JSON", false)
    .option("--work-dir <path>", "Working directory", process.cwd())
    .action(async (id: string, opts: { json: boolean; workDir: string }) => {
      try {
        const db = openCliDatabase({ workDir: opts.workDir });
        if (db === null) { process.exit(1); return; }
        runMigrations105(db);
        const registry = new AgentRegistry(db);

        const row = registry.getById(id);
        if (row === undefined) {
          process.stderr.write(`Agent "${id}" not found\n`);
          process.exit(1);
        }

        registry.setStatus(id, "active");

        if (opts.json) {
          process.stdout.write(JSON.stringify({ success: true, agent_id: id, status: "active" }, null, 2) + "\n");
        } else {
          process.stdout.write(`✓ Agent "${id}" activated (status: active)\n`);
        }
      } catch (err) {
        process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
        process.exit(1);
      }
    });

  // ── sidjua agent stop ─────────────────────────────────────────────────────

  agentCmd
    .command("stop <id>")
    .description("Stop an agent gracefully")
    .option("--force",           "Immediate stop (SIGKILL)", false)
    .option("--json",            "Output JSON", false)
    .option("--work-dir <path>", "Working directory", process.cwd())
    .action(async (id: string, opts: { force: boolean; json: boolean; workDir: string }) => {
      try {
        const db = openCliDatabase({ workDir: opts.workDir });
        if (db === null) { process.exit(1); return; }
        runMigrations105(db);
        const registry = new AgentRegistry(db);

        const row = registry.getById(id);
        if (row === undefined) {
          process.stderr.write(`Agent "${id}" not found\n`);
          process.exit(1);
        }

        registry.setStatus(id, "stopping");
        // In a full implementation, we'd send STOP IPC to the agent process
        registry.setStatus(id, "stopped");

        if (opts.json) {
          process.stdout.write(JSON.stringify({ success: true, agent_id: id, status: "stopped" }, null, 2) + "\n");
        } else {
          process.stdout.write(`✓ Agent "${id}" stopped\n`);
        }
      } catch (err) {
        process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
        process.exit(1);
      }
    });

  // ── sidjua agent delete ───────────────────────────────────────────────────

  agentCmd
    .command("delete <id>")
    .description("Delete an agent definition")
    .option("--keep-history",   "Preserve audit trail (soft delete)", false)
    .option("--force",          "Skip confirmation prompt", false)
    .option("--json",           "Output JSON", false)
    .option("--work-dir <path>","Working directory", process.cwd())
    .action(async (id: string, opts: {
      keepHistory: boolean;
      force:       boolean;
      json:        boolean;
      workDir:     string;
    }) => {
      try {
        const db = openCliDatabase({ workDir: opts.workDir });
        if (db === null) { process.exit(1); return; }
        runMigrations105(db);
        const registry = new AgentRegistry(db);

        const row = registry.getById(id);
        if (row === undefined) {
          process.stderr.write(`Agent "${id}" not found\n`);
          process.exit(1);
        }

        if (!opts.force && !opts.json) {
          const rl = createInterface({ input, output });
          const answer = await rl.question(
            `Delete agent "${id}" (${row.name})? [y/N] `,
          );
          rl.close();
          if (answer.toLowerCase() !== "y") {
            process.stdout.write("Aborted.\n");
            return;
          }
        }

        registry.delete(id, opts.keepHistory);

        if (opts.json) {
          process.stdout.write(JSON.stringify({ success: true, agent_id: id, keep_history: opts.keepHistory }, null, 2) + "\n");
        } else {
          process.stdout.write(`✓ Agent "${id}" deleted${opts.keepHistory ? " (audit history preserved)" : ""}\n`);
        }
      } catch (err) {
        process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
        process.exit(1);
      }
    });

  // ── sidjua agent health ───────────────────────────────────────────────────

  agentCmd
    .command("health <id>")
    .description("Show agent health information")
    .option("--json",            "Output JSON", false)
    .option("--work-dir <path>", "Working directory", process.cwd())
    .action(async (id: string, opts: { json: boolean; workDir: string }) => {
      try {
        const db = openCliDatabase({ workDir: opts.workDir });
        if (db === null) { process.exit(1); return; }
        runMigrations105(db);
        const registry = new AgentRegistry(db);
        const tracker = new BudgetTracker(db);

        const row = registry.getById(id);
        if (row === undefined) {
          process.stderr.write(`Agent "${id}" not found\n`);
          process.exit(1);
        }

        const def = registry.parseConfigYaml(row.config_yaml);
        const monthlySpend = tracker.getAgentMonthlySpend(id);
        const monthlyLimit = def.budget?.per_month_usd ?? null;
        const dailySpend = tracker.getAgentDailySpend(id);

        const health = {
          agent_id: id,
          status: row.status,
          monthly_spend_usd: monthlySpend,
          daily_spend_usd: dailySpend,
          monthly_limit_usd: monthlyLimit,
          budget_percent: monthlyLimit !== null && monthlyLimit > 0
            ? Math.round((monthlySpend / monthlyLimit) * 100)
            : null,
          updated_at: row.updated_at,
        };

        if (opts.json) {
          process.stdout.write(JSON.stringify(health, null, 2) + "\n");
          return;
        }

        process.stdout.write(`Agent: ${id}\n`);
        process.stdout.write(`  Status:   ${row.status}\n`);
        if (monthlyLimit !== null) {
          process.stdout.write(
            `  Budget:   $${monthlySpend.toFixed(2)} / $${monthlyLimit.toFixed(2)} (${health.budget_percent}%)\n`,
          );
        } else {
          process.stdout.write(`  Spend:    $${monthlySpend.toFixed(2)} this month\n`);
        }
        process.stdout.write(`  Daily:    $${dailySpend.toFixed(4)} today\n`);
        process.stdout.write(`  Updated:  ${row.updated_at}\n`);
      } catch (err) {
        process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
        process.exit(1);
      }
    });

  // ── sidjua agent templates ────────────────────────────────────────────────

  agentCmd
    .command("templates")
    .description("List available agent templates")
    .option("--json",            "Output JSON", false)
    .option("--work-dir <path>", "Working directory", process.cwd())
    .action(async (opts: { json: boolean; workDir: string }) => {
      try {
        const templateLoader = new AgentTemplateLoader(
          join(opts.workDir, "agents", "templates"),
        );
        const templates = await templateLoader.listTemplates();

        if (opts.json) {
          process.stdout.write(JSON.stringify(templates, null, 2) + "\n");
          return;
        }

        const header = "TEMPLATE".padEnd(20) + "TIER".padEnd(6) + "DESCRIPTION";
        process.stdout.write(header + "\n");
        process.stdout.write("-".repeat(60) + "\n");

        for (const t of templates) {
          const tier = t.tier > 0 ? `T${t.tier}` : "—";
          const line = t.id.padEnd(20) + tier.padEnd(6) + t.description;
          process.stdout.write(line + "\n");
        }
      } catch (err) {
        process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
        process.exit(1);
      }
    });
}


/** Pricing details for a given provider + model combination. */
export interface ProviderPricingInfo {
  isPaid:      boolean;
  inputPer1m:  number;
  outputPer1m: number;
}

/**
 * Look up provider pricing from the catalog.
 * Returns isPaid=false when the provider/model is free or unknown.
 */
export function getProviderPricing(provider: string, model: string): ProviderPricingInfo {
  const catalog      = getDefaultCatalog();
  const providerEntry = catalog.getById(provider);
  const modelEntry    = providerEntry?.models.find((m) => m.id === model);
  const pricing       = modelEntry?.pricing;

  if (
    pricing !== undefined &&
    ((pricing.input_per_1m_tokens ?? 0) + (pricing.output_per_1m_tokens ?? 0)) > 0
  ) {
    return {
      isPaid:      true,
      inputPer1m:  pricing.input_per_1m_tokens ?? 0,
      outputPer1m: pricing.output_per_1m_tokens ?? 0,
    };
  }

  return { isPaid: false, inputPer1m: 0, outputPer1m: 0 };
}

function buildOverrides(
  id: string | undefined,
  opts: {
    name?: string;
    tier: string;
    provider?: string;
    model?: string;
    division?: string;
    capabilities?: string;
    budgetPerTask?: string;
    budgetMonthly?: string;
    skill?: string;
  },
): Partial<AgentLifecycleDefinition> {
  const overrides: Partial<AgentLifecycleDefinition> = {};

  if (id !== undefined) overrides.id = id;
  if (opts.name !== undefined) overrides.name = opts.name;
  if (opts.provider !== undefined) overrides.provider = opts.provider;
  if (opts.model !== undefined) overrides.model = opts.model;
  if (opts.division !== undefined) overrides.division = opts.division;
  if (opts.skill !== undefined) overrides.skill = opts.skill;

  const tier = parseInt(opts.tier, 10);
  if (!isNaN(tier)) overrides.tier = tier;

  if (opts.capabilities !== undefined) {
    overrides.capabilities = opts.capabilities.split(",").map((c) => c.trim()).filter(Boolean);
  }

  const budgetPerTask = opts.budgetPerTask !== undefined ? parseFloat(opts.budgetPerTask) : undefined;
  const budgetMonthly = opts.budgetMonthly !== undefined ? parseFloat(opts.budgetMonthly) : undefined;
  if (budgetPerTask !== undefined || budgetMonthly !== undefined) {
    overrides.budget = {
      ...(budgetPerTask !== undefined ? { per_task_usd: budgetPerTask } : {}),
      ...(budgetMonthly !== undefined ? { per_month_usd: budgetMonthly } : {}),
    };
  }

  return overrides;
}

function hasEnoughFlags(
  id: string | undefined,
  opts: { provider?: string; model?: string; division?: string },
): boolean {
  return id !== undefined && opts.provider !== undefined && opts.model !== undefined && opts.division !== undefined;
}


interface ConfiguredProvider {
  id:     string;
  models: string[];
  free:   boolean;
}

async function getConfiguredProviders(workDir?: string): Promise<ConfiguredProvider[]> {
  const result: ConfiguredProvider[] = [];
  const seen   = new Set<string>();
  const catalog = getDefaultCatalog();

  const addProvider = (id: string, free: boolean): void => {
    if (seen.has(id)) return;
    seen.add(id);
    const entry  = catalog.getById(id);
    const models = (entry?.models ?? []).slice(0, 2).map((m) => m.id);
    result.push({ id, models, free });
  };

  // 1. Cloudflare is always available (free, embedded)
  addProvider("cloudflare", true);

  // 2. Env-var based keys (anthropic, openai, deepseek, …)
  const keyManager = new ProviderKeyManager();
  for (const pid of await keyManager.listAvailableProviders()) {
    addProvider(pid, false);
  }

  // 3. .system/providers/*.yaml (written by /key guide command)
  if (workDir !== undefined) {
    const providersDir = join(workDir, ".system", "providers");
    try {
      const files = await readdir(providersDir);
      for (const file of files) {
        if (!file.endsWith(".yaml")) continue;
        const pid = file.replace(/\.yaml$/, "");
        if (seen.has(pid)) continue;
        try {
          const raw = await readFile(join(providersDir, file), "utf-8");
          const cfg = parseYaml(raw) as { api_key?: string; enabled?: boolean } | null;
          if (cfg?.api_key && cfg.api_key !== "YOUR_API_KEY_HERE" && cfg.enabled !== false) {
            addProvider(pid, false);
          }
        } catch (e: unknown) { logger.warn("cli-agent", "Provider config file unreadable — skipping provider", { metadata: { error: e instanceof Error ? e.message : String(e) } }); }
      }
    } catch (e: unknown) { logger.debug("cli-agent", "Providers directory not found — no provider configs to load", { metadata: { error: e instanceof Error ? e.message : String(e) } }); }
  }

  return result;
}

export async function interactiveCreate(
  quick: boolean,
  id: string | undefined,
  opts: { workDir?: string; budgetPerTask?: string; budgetMonthly?: string },
  templateLoader: AgentTemplateLoader,
): Promise<AgentLifecycleDefinition> {
  const rl = createInterface({ input, output });

  const ask = async (question: string, fallback?: string): Promise<string> => {
    const prompt = (fallback !== undefined && fallback !== "")
      ? `${question} [${fallback}]: `
      : `${question}: `;
    const answer = await rl.question(prompt);
    return answer.trim() !== "" ? answer.trim() : (fallback ?? "");
  };

  try {
    process.stdout.write("\n=== sidjua agent create (interactive) ===\n\n");

    const agentId = await ask("Agent ID (e.g. video-editor)", id ?? "my-agent");
    const name = await ask("Display name", agentId);

    let templateId = "custom";
    if (!quick) {
      const templates = await templateLoader.listTemplates();
      process.stdout.write(`\nAvailable templates: ${templates.map((t) => t.id).join(", ")}\n`);
      templateId = await ask("Template", "custom");
    }

    // Show configured providers before asking
    const configured = await getConfiguredProviders(opts.workDir);
    if (configured.length > 0) {
      process.stdout.write("\nConfigured providers:\n");
      for (const p of configured) {
        const label = p.free ? " (free, embedded)" : "";
        const mods  = p.models.length > 0
          ? `  — ${p.models.join(", ")}${p.models.length >= 2 ? ", ..." : ""}`
          : "";
        process.stdout.write(`  • ${p.id}${label}${mods}\n`);
      }
      process.stdout.write("\n");
    }

    const defaultProvider = configured.length > 0 ? configured[0]!.id : "anthropic";
    const provider = await ask("Provider", defaultProvider);
    const catalog = getDefaultCatalog();
    const providerEntry = catalog.getById(provider);
    const defaultModel = providerEntry?.models[0]?.id ?? "";
    const model = await ask("Model", defaultModel);

    let division = "";
    let reportsTo: string | undefined;

    if (!quick) {
      division  = await ask("Division code (or press Enter to skip)", "");
      reportsTo = await ask("Reports to agent ID (or press Enter to skip)", "");
      if (reportsTo === "") reportsTo = undefined;
    }

    // ── Budget dialog — pricing-aware ──────────────────────────────────────

    let budgetPerTask: number;
    let budgetMonthly: number;

    // CLI flags take priority over interactive prompts
    if (opts.budgetPerTask !== undefined && opts.budgetMonthly !== undefined) {
      budgetPerTask = parseFloat(opts.budgetPerTask);
      budgetMonthly = parseFloat(opts.budgetMonthly);
    } else {
      const pricing = getProviderPricing(provider, model);

      if (pricing.isPaid) {
        process.stdout.write(
          `  Estimated cost: input $${pricing.inputPer1m.toFixed(2)}/1M tokens, ` +
          `output $${pricing.outputPer1m.toFixed(2)}/1M tokens\n`,
        );

        const monthlyStr = opts.budgetMonthly ??
          await ask("Monthly budget limit (USD, blank = unlimited)", "100.00");
        budgetMonthly = monthlyStr !== "" ? parseFloat(monthlyStr) : 100.00;

        const perTaskStr = opts.budgetPerTask ??
          await ask("Per-task budget limit (USD, blank = use template default)", "2.00");
        budgetPerTask = perTaskStr !== "" ? parseFloat(perTaskStr) : 2.00;
      } else {
        process.stdout.write(
          "  This provider has no token cost. Budget defaults set to $0.00.\n",
        );
        budgetPerTask = 0.00;
        budgetMonthly = 0.00;
      }
    }

    const skillPath = await ask(
      "Skill file path (optional, press Enter to skip)",
      "",
    );

    rl.close();

    const overrides: Partial<AgentLifecycleDefinition> = {
      id: agentId,
      name,
      provider,
      model,
      division: division !== "" ? division : "default",
      skill: skillPath,   // "" when user skips — expand() preserves it; validator skips empty skill
      budget: { per_task_usd: budgetPerTask, per_month_usd: budgetMonthly, per_hour_usd: budgetPerTask * 4 },
      ...(reportsTo !== undefined ? { reports_to: reportsTo } : {}),
    };

    return templateLoader.expand(templateId, overrides);
  } catch (err) {
    rl.close();
    throw err;
  }
}
