// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Guide: In-Chat Slash Commands
 *
 * Handles /key, /status, /agents, /help, /costs, /providers, /exit commands
 * that the user can type inside `sidjua chat guide`.
 */

import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { join }                               from "node:path";
import { existsSync }                         from "node:fs";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { createLogger }                       from "../core/logger.js";

const logger = createLogger("guide");


export interface CommandResult {
  /** Text to display to the user. */
  output:   string;
  /** True if the session should end. */
  exit?:    boolean;
  /** Non-fatal error message. */
  error?:   string;
  /** Follow-up action signal (e.g. "start-agent-create"). */
  action?:  string;
}

export interface ProviderKeyResult {
  success:    boolean;
  provider:   string;
  message:    string;
  tested:     boolean;
}

// Supported providers for /key (xai added; grok kept as backward-compat alias)
const SUPPORTED_PROVIDERS = [
  "groq", "google", "anthropic", "openai", "deepseek", "grok", "xai", "mistral", "cohere",
];


interface ProviderInfo {
  name:           string;
  tier:           "free" | "near-free" | "paid";
  description:    string;
  rateLimit:      string;
  getKeyUrl:      string;
  keyPrefix:      string;
  model:          string;
  steps:          string[];
  /** USD per million input tokens */
  inputCostPerM:  number;
  /** USD per million output tokens */
  outputCostPerM: number;
}

const PROVIDER_CATALOG: Readonly<Record<string, ProviderInfo>> = {
  groq: {
    name:           "Groq",
    tier:           "free",
    description:    "Fast, 1,000 req/day",
    rateLimit:      "1,000 requests/day",
    getKeyUrl:      "https://console.groq.com",
    keyPrefix:      "gsk_",
    model:          "Llama 3.3 70B",
    steps: [
      "Go to console.groq.com",
      "Create a free account (no credit card needed) — email or Google",
      'Click "API Keys" in the dashboard → "Create API Key"',
      "Copy the key (starts with gsk_)",
      "Type: /key groq gsk_your_key_here",
    ],
    inputCostPerM:  0.00,
    outputCostPerM: 0.00,
  },
  google: {
    name:           "Google",
    tier:           "free",
    description:    "Smart, 250 req/day",
    rateLimit:      "250 requests/day",
    getKeyUrl:      "https://aistudio.google.com",
    keyPrefix:      "AIza",
    model:          "Gemini 2.5 Flash",
    steps: [
      "Go to aistudio.google.com",
      "Sign in with Google account",
      'Click "Get API Key" → "Create API key"',
      'Copy the key (starts with "AIza")',
      "Type: /key google AIza_your_key_here",
    ],
    inputCostPerM:  0.00,
    outputCostPerM: 0.00,
  },
  mistral: {
    name:           "Mistral",
    tier:           "free",
    description:    "EU-based, 2 req/min",
    rateLimit:      "2 requests/minute",
    getKeyUrl:      "https://console.mistral.ai",
    keyPrefix:      "",
    model:          "Mistral Large 3",
    steps: [
      "Go to console.mistral.ai",
      "Create an account",
      'Click "API Keys" → "Create new key"',
      "Copy the key",
      "Type: /key mistral your_key_here",
    ],
    inputCostPerM:  0.00,
    outputCostPerM: 0.00,
  },
  deepseek: {
    name:           "DeepSeek",
    tier:           "near-free",
    description:    "$0.14/M tokens",
    rateLimit:      "No hard limit",
    getKeyUrl:      "https://platform.deepseek.com",
    keyPrefix:      "sk-",
    model:          "DeepSeek V3.2",
    steps: [
      "Go to platform.deepseek.com",
      "Sign up and top up $1 (minimum)",
      'Click "API Keys" → "Create API Key"',
      "Copy the key (starts with sk-)",
      "Type: /key deepseek sk_your_key_here",
    ],
    inputCostPerM:  0.14,
    outputCostPerM: 0.28,
  },
  anthropic: {
    name:           "Anthropic",
    tier:           "paid",
    description:    "Best intelligence",
    rateLimit:      "Pay-per-use",
    getKeyUrl:      "https://console.anthropic.com",
    keyPrefix:      "sk-ant-",
    model:          "Claude Sonnet 4.5",
    steps: [
      "Go to console.anthropic.com",
      "Create an account and add $5 credit",
      'Click "API Keys" → "Create Key"',
      "Copy the key (starts with sk-ant-)",
      "Type: /key anthropic sk-ant-your_key_here",
    ],
    inputCostPerM:  3.00,
    outputCostPerM: 15.00,
  },
  openai: {
    name:           "OpenAI",
    tier:           "paid",
    description:    "Most popular",
    rateLimit:      "Pay-per-use",
    getKeyUrl:      "https://platform.openai.com",
    keyPrefix:      "sk-",
    model:          "GPT-4.1 Mini",
    steps: [
      "Go to platform.openai.com",
      "Create an account and add $5 credit",
      'Click "API Keys" → "Create new secret key"',
      "Copy the key (starts with sk-)",
      "Type: /key openai sk_your_key_here",
    ],
    inputCostPerM:  0.40,
    outputCostPerM: 1.60,
  },
  xai: {
    name:           "xAI/Grok",
    tier:           "paid",
    description:    "Fast, general-purpose",
    rateLimit:      "Pay-per-use",
    getKeyUrl:      "https://console.x.ai",
    keyPrefix:      "xai-",
    model:          "Grok 3",
    steps: [
      "Go to console.x.ai",
      "Create an account and add credits",
      'Click "API Keys" → "Create API Key"',
      "Copy the key (starts with xai-)",
      "Type: /key xai xai-your_key_here",
    ],
    inputCostPerM:  3.00,
    outputCostPerM: 15.00,
  },
  // "grok" is a backward-compat alias for "xai"
  grok: {
    name:           "xAI/Grok",
    tier:           "paid",
    description:    "Fast, general-purpose",
    rateLimit:      "Pay-per-use",
    getKeyUrl:      "https://console.x.ai",
    keyPrefix:      "xai-",
    model:          "Grok 3",
    steps: [
      "Go to console.x.ai",
      "Create an account and add credits",
      'Click "API Keys" → "Create API Key"',
      "Copy the key (starts with xai-)",
      "Type: /key xai xai-your_key_here",
    ],
    inputCostPerM:  3.00,
    outputCostPerM: 15.00,
  },
  cohere: {
    name:           "Cohere",
    tier:           "near-free",
    description:    "Free trial available",
    rateLimit:      "Trial: 5 req/min",
    getKeyUrl:      "https://dashboard.cohere.com",
    keyPrefix:      "",
    model:          "Command R+",
    steps: [
      "Go to dashboard.cohere.com",
      "Sign up for a free trial",
      'Click "API Keys" → "New API Key"',
      "Copy the key",
      "Type: /key cohere your_key_here",
    ],
    inputCostPerM:  0.00,
    outputCostPerM: 0.00,
  },
};

// Average tokens per task used in cost estimation
const AVG_INPUT_TOKENS  = 2000;
const AVG_OUTPUT_TOKENS = 500;


/**
 * Estimate monthly cost in USD for a provider at a given tasks-per-day rate.
 * Returns 0 for unknown or free providers.
 *
 * Formula: (input_price × avg_input + output_price × avg_output) × tasks/day × 30 / 1_000_000
 */
export function estimateProviderCost(provider: string, tasksPerDay: number): number {
  const info = PROVIDER_CATALOG[provider.toLowerCase()];
  if (!info) return 0;
  const costPerTask =
    (info.inputCostPerM * AVG_INPUT_TOKENS + info.outputCostPerM * AVG_OUTPUT_TOKENS) / 1_000_000;
  return costPerTask * tasksPerDay * 30;
}


function formatCost(cost: number): string {
  if (cost === 0) return "$0.00/month (free tier)";
  if (cost < 0.01) return `~$${cost.toFixed(4)}/month`;
  return `~$${cost.toFixed(2)}/month`;
}

function buildRecommendationMenu(): string {
  return [
    "",
    "🔑 Choose your AI provider:",
    "",
    "FREE (no credit card):",
    "  1. Groq       — Fast, 1,000 req/day     → /key groq <your-key>",
    "  2. Google     — Smart, 250 req/day       → /key google <your-key>",
    "  3. Mistral    — EU-based, 2 req/min      → /key mistral <your-key>",
    "",
    "NEAR-FREE:",
    "  4. DeepSeek   — $0.14/M tokens           → /key deepseek <your-key>",
    "",
    "PAID ($5 minimum):",
    "  5. Anthropic  — Best intelligence         → /key anthropic <your-key>",
    "  6. OpenAI     — Most popular              → /key openai <your-key>",
    "  7. xAI/Grok   — Fast, general-purpose     → /key xai <your-key>",
    "",
    "💡 Recommended: Start with Groq (free, fastest).",
    "   Get your key: https://console.groq.com → API Keys → Create",
    "",
    "📖 Full setup guides: https://sidjua.com/docs/provider-guides",
    "   (or type: /help providers)",
    "",
  ].join("\n");
}

function buildProviderHelp(providerLower: string): CommandResult {
  const info = PROVIDER_CATALOG[providerLower];
  if (!info) {
    return {
      output: "",
      error:  `Unknown provider "${providerLower}". Type /key to see all providers.`,
    };
  }

  const tierLabel =
    info.tier === "free"      ? "Free AI Provider (no credit card needed)" :
    info.tier === "near-free" ? "Near-Free Provider"                       :
                                "Paid Provider";

  const lines: string[] = [
    "",
    `${info.name} — ${tierLabel}`,
    "",
  ];

  info.steps.forEach((step, i) => {
    lines.push(`${i + 1}. ${step}`);
  });

  lines.push(
    "",
    `Rate limit: ${info.rateLimit}`,
    `Model: ${info.model}`,
    "",
  );

  return { output: lines.join("\n") };
}

function buildCostEstimate(providerLower: string): string {
  const info = PROVIDER_CATALOG[providerLower];
  if (!info) return "";

  const light = estimateProviderCost(providerLower, 50);
  const heavy = estimateProviderCost(providerLower, 500);

  const lines: string[] = [
    "",
    `💰 Estimated costs (${info.model}):`,
    `   Light usage (50 tasks/day):   ${formatCost(light)}`,
    `   Heavy usage (500 tasks/day):  ${formatCost(heavy)}`,
  ];

  if (info.tier === "free") {
    lines.push(`   Rate limit: ${info.rateLimit}`);
  }

  if (info.tier === "paid") {
    lines.push(
      "",
      "💡 Set a budget limit: sidjua config set budget.monthly 10.00",
      "   SIDJUA pauses agents automatically when the budget is reached.",
    );
  }

  lines.push("");
  return lines.join("\n");
}

async function countConfiguredProviders(workDir: string): Promise<number> {
  const providersDir = join(workDir, ".system", "providers");
  // Skip "grok" — it is an alias for "xai", counting both would double-count
  const canonical = Object.keys(PROVIDER_CATALOG).filter((p) => p !== "grok");
  let count = 0;
  for (const provId of canonical) {
    const cfgPath = join(providersDir, `${provId}.yaml`);
    if (existsSync(cfgPath)) {
      try {
        const raw = await readFile(cfgPath, "utf-8");
        const cfg = parseYaml(raw) as { api_key?: string; enabled?: boolean } | null;
        if (cfg?.api_key && cfg.api_key !== "YOUR_API_KEY_HERE" && cfg.enabled !== false) {
          count++;
        }
      } catch (e: unknown) {
        logger.debug("guide-commands", "Provider config file unreadable — skipping provider", { metadata: { error: e instanceof Error ? e.message : String(e) } });
      }
    }
  }
  return count;
}

async function buildMultiProviderTip(newProvider: string, workDir: string): Promise<string> {
  const count = await countConfiguredProviders(workDir);
  if (count >= 2) {
    return "\n✓ Multi-provider failover active — SIDJUA will automatically switch on errors.\n";
  }

  if (newProvider === "groq") {
    return [
      "",
      "Tip: Add Google as fallback for 1,250+ free requests/day.",
      "     Type: /key google",
      "",
    ].join("\n");
  }

  if (newProvider === "google" || newProvider === "mistral") {
    return [
      "",
      "Tip: Add Groq as fallback (fastest free provider).",
      "     Type: /key groq",
      "",
    ].join("\n");
  }

  // Paid providers → suggest free fallback
  return [
    "",
    "Tip: Add Groq as a free fallback to reduce costs on simple tasks.",
    "     Type: /key groq",
    "",
  ].join("\n");
}


/**
 * Returns the parsed command name and args if `line` is a slash command.
 * Returns null if the line is not a slash command.
 */
export function parseSlashCommand(line: string): { cmd: string; args: string[] } | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("/")) return null;

  const parts = trimmed.slice(1).split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;

  return { cmd: parts[0]!.toLowerCase(), args: parts.slice(1) };
}


export function handleHelp(): CommandResult {
  return {
    output: [
      "",
      "Available commands:",
      "",
      "  /zurinfo                   — What is Sidjua? (quick intro, 10 lines)",
      "  /start                     — Create your first agent interactively",
      "  /key <provider> <api-key>  — Add an API key for a provider",
      "  /key <provider>            — Show setup guide for a provider",
      "  /key                       — Show provider recommendation menu",
      "  /providers                 — Show all available providers",
      "  /agents                    — List all configured agents",
      "  /status                    — Show workspace status",
      "  /costs                     — Show recent cost summary",
      "  /help [providers]          — Show this help",
      "  /exit                      — Exit Guide chat",
      "",
      "Supported providers for /key:",
      "  groq, google, anthropic, openai, deepseek, grok, xai, mistral, cohere",
      "",
      "Or just chat! Ask me anything about SIDJUA.",
      "",
    ].join("\n"),
  };
}


export function handleProviders(): CommandResult {
  return { output: buildRecommendationMenu() };
}


export function handleExit(): CommandResult {
  return {
    output: "\nGoodbye! Run `sidjua chat guide` to talk to me again.\n",
    exit:   true,
  };
}


export function handleZurinfo(): CommandResult {
  return {
    output: [
      "",
      "SIDJUA — Structured Intelligence for Distributed Joint Unified Automation",
      "",
      "• Open-source AI governance platform for managing AI agent teams",
      "• You define divisions (teams), agents report to them, budgets control spend",
      "• The Guide (me!) is your starting point — free, no API key needed",
      "• Add more agents with /start or by describing what you need",
      "• Talk to any agent with:  sidjua chat <agent-id>",
      "• All agent actions are logged in an audit trail — full transparency",
      "• Run `sidjua apply` after editing divisions.yaml to reprovision",
      "• Use /key <provider> <key> to add paid AI providers (Groq, Anthropic, etc.)",
      "",
    ].join("\n"),
  };
}


export function handleStart(): CommandResult {
  return {
    output: "\nStarting agent creation...\n",
    exit:   true,
    action: "start-agent-create",
  };
}


export async function handleAgents(workDir: string): Promise<CommandResult> {
  const agentsYamlPath = join(workDir, "agents", "agents.yaml");

  try {
    await access(agentsYamlPath);
    const raw   = await readFile(agentsYamlPath, "utf-8");
    const data  = parseYaml(raw) as { agents?: string[] } | null;
    const agents = data?.agents ?? [];

    if (agents.length === 0) {
      return { output: "\nNo agents configured yet. Ask me to create one!\n" };
    }

    const lines = ["\nConfigured agents:", ""];
    for (const agentId of agents) {
      // Try to read the definition for more detail
      const defPath = join(workDir, "agents", "definitions", `${agentId}.yaml`);
      try {
        await access(defPath);
        const defRaw = await readFile(defPath, "utf-8");
        const def    = parseYaml(defRaw) as {
          name?: string; tier?: number; division?: string; provider?: string;
        } | null;
        const name     = def?.name     ?? agentId;
        const tier     = def?.tier     != null ? `T${def.tier}` : "T?";
        const division = def?.division ?? "?";
        const provider = def?.provider ?? "?";
        lines.push(`  ${agentId.padEnd(20)} ${name.padEnd(25)} ${tier}  ${division}  ${provider}`);
      } catch (e: unknown) {
        logger.debug("guide-commands", "Agent definition read failed — showing ID only", { metadata: { error: e instanceof Error ? e.message : String(e) } });
        lines.push(`  ${agentId}`);
      }
    }
    lines.push("");

    return { output: lines.join("\n") };
  } catch (e: unknown) {
    logger.debug("guide-commands", "agents.yaml not found — no agents to list", { metadata: { error: e instanceof Error ? e.message : String(e) } });
    return { output: "\nNo agents.yaml found. Run `sidjua init` first.\n" };
  }
}


export async function handleStatus(workDir: string): Promise<CommandResult> {
  const checks: { label: string; ok: boolean; detail?: string }[] = [];

  // Check workspace files
  const toCheck: Array<{ label: string; path: string }> = [
    { label: "divisions.yaml",  path: join(workDir, "divisions.yaml") },
    { label: "agents.yaml",     path: join(workDir, "agents", "agents.yaml") },
    { label: "guide definition",path: join(workDir, "agents", "definitions", "guide.yaml") },
    { label: "guide skill",     path: join(workDir, "agents", "skills", "guide.md") },
    { label: "database",        path: join(workDir, ".system", "sidjua.db") },
  ];

  for (const item of toCheck) {
    checks.push({ label: item.label, ok: existsSync(item.path) });
  }

  // Check provider keys
  const providerChecks: string[] = [];
  const providersDir = join(workDir, ".system", "providers");
  for (const provId of ["groq", "google", "anthropic"]) {
    const cfgPath = join(providersDir, `${provId}.yaml`);
    if (existsSync(cfgPath)) {
      try {
        const raw  = await readFile(cfgPath, "utf-8");
        const cfg  = parseYaml(raw) as { api_key?: string } | null;
        const hasKey = !!(cfg?.api_key) && cfg.api_key !== "YOUR_API_KEY_HERE";
        providerChecks.push(`  ${provId.padEnd(12)} ${hasKey ? "✓ configured" : "○ no key yet"}`);
      } catch (e: unknown) {
        logger.debug("guide-commands", "Provider config not readable — showing unconfigured", { metadata: { error: e instanceof Error ? e.message : String(e) } });
        providerChecks.push(`  ${provId.padEnd(12)} ○ no key yet`);
      }
    }
  }

  const lines = ["", "Workspace status:", ""];
  for (const c of checks) {
    lines.push(`  ${c.ok ? "✓" : "✗"} ${c.label}`);
  }
  if (providerChecks.length > 0) {
    lines.push("", "Providers:", ...providerChecks);
  }
  lines.push("");

  return { output: lines.join("\n") };
}


export async function handleKey(
  provider: string | undefined,
  apiKey:   string | undefined,
  workDir:  string,
): Promise<CommandResult> {
  // No provider → show full recommendation menu
  if (!provider) {
    return { output: buildRecommendationMenu() };
  }

  const providerLower = provider.toLowerCase();
  if (!SUPPORTED_PROVIDERS.includes(providerLower)) {
    return {
      output: "",
      error:  `Unknown provider "${provider}". Supported: ${SUPPORTED_PROVIDERS.join(", ")}`,
    };
  }

  // Provider given but no API key → show provider-specific setup guide
  if (!apiKey) {
    return buildProviderHelp(providerLower);
  }

  // Basic key format check
  if (apiKey.length < 8) {
    return {
      output: "",
      error:  `API key seems too short — double-check you copied the full key`,
    };
  }

  // Write provider config
  const providersDir = join(workDir, ".system", "providers");
  await mkdir(providersDir, { recursive: true });

  const cfgPath = join(providersDir, `${providerLower}.yaml`);
  const cfg = {
    provider:   providerLower,
    api_key:    apiKey,
    enabled:    true,
    configured: new Date().toISOString(),
  };

  await writeFile(cfgPath, stringifyYaml(cfg), "utf-8");

  logger.info("guide_key_configured", `Provider key configured via Guide: ${providerLower}`, {
    metadata: { provider: providerLower },
  });

  const info         = PROVIDER_CATALOG[providerLower];
  const providerName = info?.name ?? providerLower;
  const modelName    = info?.model ?? providerLower;

  const costBlock = buildCostEstimate(providerLower);
  const multiTip  = await buildMultiProviderTip(providerLower, workDir);

  return {
    output: `\n✓ ${providerName} connected — ${modelName} ready${costBlock}${multiTip}`,
  };
}


export async function handleCosts(workDir: string): Promise<CommandResult> {
  const dbPath = join(workDir, ".system", "sidjua.db");

  if (!existsSync(dbPath)) {
    return { output: "\nNo workspace database found. Run `sidjua init` first.\n" };
  }

  try {
    // Dynamic import to avoid hard dep — DB may not exist in all contexts
    const { openDatabase } = await import("../utils/db.js");
    const db = openDatabase(dbPath);

    let totalRows = 0;
    let totalCost = 0;

    try {
      const rows = db.prepare<[], { cnt: number; total: number }>(
        "SELECT COUNT(*) as cnt, COALESCE(SUM(cost_usd), 0) as total FROM cost_ledger",
      ).all();
      if (rows.length > 0 && rows[0] != null) {
        totalRows = rows[0].cnt;
        totalCost = rows[0].total;
      }
    } catch (e: unknown) {
      logger.debug("guide-commands", "cost_ledger not found — no spend data available (pre-migration)", { metadata: { error: e instanceof Error ? e.message : String(e) } });
    } finally {
      db.close();
    }

    if (totalRows === 0) {
      return { output: "\nNo cost data yet — costs appear here once you run tasks.\n" };
    }

    return {
      output: [
        "",
        `Total cost: $${totalCost.toFixed(4)}  (${totalRows} entries)`,
        "",
        "Run `sidjua costs` for a full breakdown.",
        "",
      ].join("\n"),
    };
  } catch (err) {
    return { output: `\nCould not read costs: ${String(err)}\n` };
  }
}


/**
 * Handle a slash command line.
 * Returns null if the line is not a slash command.
 */
export async function handleSlashCommand(
  line:    string,
  workDir: string,
): Promise<CommandResult | null> {
  const parsed = parseSlashCommand(line);
  if (!parsed) return null;

  const { cmd, args } = parsed;

  switch (cmd) {
    case "help":
      if (args[0] === "providers") {
        return handleProviders();
      }
      return handleHelp();

    case "exit":
    case "quit":
    case "bye":
      return handleExit();

    case "zurinfo":
      return handleZurinfo();

    case "start":
      return handleStart();

    case "agents":
      return handleAgents(workDir);

    case "status":
      return handleStatus(workDir);

    case "key":
      return handleKey(args[0], args[1], workDir);

    case "providers":
      return handleProviders();

    case "costs":
    case "cost":
      return handleCosts(workDir);

    default:
      return {
        output: "",
        error:  `Unknown command "/${cmd}". Type /help to see available commands.`,
      };
  }
}
