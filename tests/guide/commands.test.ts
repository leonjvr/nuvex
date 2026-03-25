/**
 * Tests for Guide: In-Chat Slash Commands
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join }   from "node:path";
import { stringify as stringifyYaml } from "yaml";
import {
  parseSlashCommand,
  handleHelp,
  handleExit,
  handleAgents,
  handleStatus,
  handleKey,
  handleCosts,
  handleProviders,
  handleSlashCommand,
  estimateProviderCost,
} from "../../src/guide/commands.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "sidjua-commands-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// parseSlashCommand
// ---------------------------------------------------------------------------

describe("parseSlashCommand", () => {
  it("returns null for non-slash input", () => {
    expect(parseSlashCommand("hello")).toBeNull();
    expect(parseSlashCommand("what is SIDJUA?")).toBeNull();
    expect(parseSlashCommand("")).toBeNull();
  });

  it("parses simple slash command", () => {
    const r = parseSlashCommand("/help");
    expect(r).toEqual({ cmd: "help", args: [] });
  });

  it("parses command with args", () => {
    const r = parseSlashCommand("/key groq gsk_abc123");
    expect(r).toEqual({ cmd: "key", args: ["groq", "gsk_abc123"] });
  });

  it("normalizes command to lowercase", () => {
    const r = parseSlashCommand("/HELP");
    expect(r?.cmd).toBe("help");
  });

  it("trims leading/trailing whitespace", () => {
    const r = parseSlashCommand("  /exit  ");
    expect(r?.cmd).toBe("exit");
  });

  it("handles single slash with no command", () => {
    expect(parseSlashCommand("/")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// handleHelp
// ---------------------------------------------------------------------------

describe("handleHelp", () => {
  it("returns output with all command names", () => {
    const result = handleHelp();
    expect(result.output).toContain("/key");
    expect(result.output).toContain("/agents");
    expect(result.output).toContain("/status");
    expect(result.output).toContain("/costs");
    expect(result.output).toContain("/exit");
    expect(result.output).toContain("/help");
  });

  it("does not signal exit", () => {
    const result = handleHelp();
    expect(result.exit).toBeFalsy();
  });

  it("includes supported provider list", () => {
    const result = handleHelp();
    expect(result.output).toContain("groq");
    expect(result.output).toContain("anthropic");
  });

  it("lists /providers command", () => {
    const result = handleHelp();
    expect(result.output).toContain("/providers");
  });
});

// ---------------------------------------------------------------------------
// handleExit
// ---------------------------------------------------------------------------

describe("handleExit", () => {
  it("signals exit: true", () => {
    const result = handleExit();
    expect(result.exit).toBe(true);
  });

  it("returns a goodbye message", () => {
    const result = handleExit();
    expect(result.output).toContain("Goodbye");
  });
});

// ---------------------------------------------------------------------------
// handleAgents
// ---------------------------------------------------------------------------

describe("handleAgents", () => {
  it("returns message when no agents.yaml exists", async () => {
    const result = await handleAgents(tmpDir);
    expect(result.output).toBeTruthy();
    expect(result.error).toBeUndefined();
  });

  it("shows configured agents from agents.yaml", async () => {
    const agentsDir = join(tmpDir, "agents");
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(
      join(agentsDir, "agents.yaml"),
      stringifyYaml({ agents: ["test-agent", "guide"] }),
    );

    const result = await handleAgents(tmpDir);
    expect(result.output).toContain("test-agent");
    expect(result.output).toContain("guide");
  });

  it("shows 'no agents' when agents list is empty", async () => {
    const agentsDir = join(tmpDir, "agents");
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, "agents.yaml"), stringifyYaml({ agents: [] }));

    const result = await handleAgents(tmpDir);
    expect(result.output).toContain("No agents");
  });

  it("includes definition details when definition file exists", async () => {
    const agentsDir = join(tmpDir, "agents");
    const defsDir   = join(agentsDir, "definitions");
    mkdirSync(defsDir, { recursive: true });

    writeFileSync(join(agentsDir, "agents.yaml"), stringifyYaml({ agents: ["my-worker"] }));
    writeFileSync(
      join(defsDir, "my-worker.yaml"),
      stringifyYaml({ name: "My Worker", tier: 3, division: "engineering", provider: "groq" }),
    );

    const result = await handleAgents(tmpDir);
    expect(result.output).toContain("My Worker");
    expect(result.output).toContain("T3");
  });
});

// ---------------------------------------------------------------------------
// handleStatus
// ---------------------------------------------------------------------------

describe("handleStatus", () => {
  it("returns status output without throwing", async () => {
    const result = await handleStatus(tmpDir);
    expect(result.output).toBeTruthy();
    expect(result.error).toBeUndefined();
  });

  it("shows workspace file check results", async () => {
    const result = await handleStatus(tmpDir);
    expect(result.output).toContain("divisions.yaml");
    expect(result.output).toContain("agents.yaml");
  });

  it("shows ✓ for files that exist", async () => {
    mkdirSync(join(tmpDir, "agents"), { recursive: true });
    writeFileSync(join(tmpDir, "divisions.yaml"), "company:\n  name: Test\n");
    writeFileSync(join(tmpDir, "agents", "agents.yaml"), "agents: []\n");

    const result = await handleStatus(tmpDir);
    expect(result.output).toContain("✓");
  });

  it("shows ✗ for files that are missing", async () => {
    const result = await handleStatus(tmpDir);
    expect(result.output).toContain("✗");
  });
});

// ---------------------------------------------------------------------------
// handleKey
// ---------------------------------------------------------------------------

describe("handleKey", () => {
  it("shows recommendation menu when provider is missing", async () => {
    // Updated: /key with no args now shows the recommendation menu (not an error)
    const result = await handleKey(undefined, undefined, tmpDir);
    expect(result.error).toBeUndefined();
    expect(result.output).toContain("Groq");
    expect(result.output).toContain("Recommended");
    expect(result.output).toContain("FREE");
  });

  it("shows provider-specific setup guide when api-key is missing", async () => {
    // Updated: /key groq (no key) now shows Groq setup guide (not an error)
    const result = await handleKey("groq", undefined, tmpDir);
    expect(result.error).toBeUndefined();
    expect(result.output).toContain("console.groq.com");
    expect(result.output).toContain("gsk_");
  });

  it("returns error for unknown provider", async () => {
    const result = await handleKey("unknown-provider", "somekey123", tmpDir);
    expect(result.error).toContain("Unknown provider");
  });

  it("returns error for suspiciously short key", async () => {
    const result = await handleKey("groq", "short", tmpDir);
    expect(result.error).toContain("too short");
  });

  it("saves valid key to providers directory", async () => {
    const result = await handleKey("groq", "gsk_abc123def456ghi", tmpDir);
    expect(result.output).toContain("Groq");          // capitalized provider name
    expect(result.output).toContain("connected");
    expect(result.error).toBeUndefined();

    const { readFileSync, existsSync } = await import("node:fs");
    const cfgPath = join(tmpDir, ".system", "providers", "groq.yaml");
    expect(existsSync(cfgPath)).toBe(true);

    const { parse } = await import("yaml");
    const cfg = parse(readFileSync(cfgPath, "utf-8")) as Record<string, unknown>;
    expect(cfg["api_key"]).toBe("gsk_abc123def456ghi");
    expect(cfg["enabled"]).toBe(true);
  });

  it("accepts all supported providers", async () => {
    const providers = ["groq", "google", "anthropic", "openai", "deepseek", "grok", "mistral", "cohere"];
    for (const provider of providers) {
      const result = await handleKey(provider, "valid-key-12345678", tmpDir);
      expect(result.error).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// handleCosts
// ---------------------------------------------------------------------------

describe("handleCosts", () => {
  it("returns message when database does not exist", async () => {
    const result = await handleCosts(tmpDir);
    expect(result.output).toBeTruthy();
    expect(result.output).toContain("database");
    expect(result.error).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// handleSlashCommand (dispatcher)
// ---------------------------------------------------------------------------

describe("handleSlashCommand", () => {
  it("returns null for non-slash input", async () => {
    const result = await handleSlashCommand("hello there", tmpDir);
    expect(result).toBeNull();
  });

  it("dispatches /help", async () => {
    const result = await handleSlashCommand("/help", tmpDir);
    expect(result).not.toBeNull();
    expect(result?.output).toContain("/key");
  });

  it("dispatches /exit", async () => {
    const result = await handleSlashCommand("/exit", tmpDir);
    expect(result?.exit).toBe(true);
  });

  it("dispatches /quit (alias for exit)", async () => {
    const result = await handleSlashCommand("/quit", tmpDir);
    expect(result?.exit).toBe(true);
  });

  it("dispatches /bye (alias for exit)", async () => {
    const result = await handleSlashCommand("/bye", tmpDir);
    expect(result?.exit).toBe(true);
  });

  it("dispatches /agents", async () => {
    const result = await handleSlashCommand("/agents", tmpDir);
    expect(result).not.toBeNull();
  });

  it("dispatches /status", async () => {
    const result = await handleSlashCommand("/status", tmpDir);
    expect(result).not.toBeNull();
    expect(result?.output).toContain("divisions.yaml");
  });

  it("dispatches /key with correct args", async () => {
    const result = await handleSlashCommand("/key groq my-valid-api-key-here", tmpDir);
    expect(result).not.toBeNull();
    expect(result?.error).toBeUndefined(); // long enough key
  });

  it("dispatches /costs", async () => {
    const result = await handleSlashCommand("/costs", tmpDir);
    expect(result).not.toBeNull();
  });

  it("returns error for unknown commands", async () => {
    const result = await handleSlashCommand("/unknowncmd", tmpDir);
    expect(result?.error).toContain("Unknown command");
  });
});

// ---------------------------------------------------------------------------
// Part B: Smart Provider Recommendation
// ---------------------------------------------------------------------------

describe("handleKey — recommendation menu (/key with no args)", () => {
  it("shows recommendation menu with FREE tier providers", async () => {
    const result = await handleKey(undefined, undefined, tmpDir);
    expect(result.error).toBeUndefined();
    expect(result.output).toContain("FREE");
    expect(result.output).toContain("Groq");
    expect(result.output).toContain("Google");
    expect(result.output).toContain("Mistral");
  });

  it("shows recommendation menu with PAID providers", async () => {
    const result = await handleKey(undefined, undefined, tmpDir);
    expect(result.output).toContain("Anthropic");
    expect(result.output).toContain("OpenAI");
    expect(result.output).toContain("xAI");
  });

  it("shows Recommended label pointing to Groq", async () => {
    const result = await handleKey(undefined, undefined, tmpDir);
    expect(result.output).toContain("Recommended");
    expect(result.output).toContain("console.groq.com");
  });

  it("shows /key commands for each provider", async () => {
    const result = await handleKey(undefined, undefined, tmpDir);
    expect(result.output).toContain("/key groq");
    expect(result.output).toContain("/key anthropic");
    expect(result.output).toContain("/key xai");
  });
});

describe("handleKey — provider-specific setup guide (/key <provider>)", () => {
  it("shows Groq setup steps when /key groq given without key", async () => {
    const result = await handleKey("groq", undefined, tmpDir);
    expect(result.error).toBeUndefined();
    expect(result.output).toContain("console.groq.com");
    expect(result.output).toContain("gsk_");
    expect(result.output).toContain("Free AI Provider");
  });

  it("shows Anthropic setup steps when /key anthropic given without key", async () => {
    const result = await handleKey("anthropic", undefined, tmpDir);
    expect(result.error).toBeUndefined();
    expect(result.output).toContain("console.anthropic.com");
    expect(result.output).toContain("sk-ant-");
    expect(result.output).toContain("Paid Provider");
  });

  it("shows step list with numbered steps", async () => {
    const result = await handleKey("google", undefined, tmpDir);
    expect(result.output).toContain("1.");
    expect(result.output).toContain("2.");
    expect(result.output).toContain("aistudio.google.com");
  });

  it("shows rate limit and model for provider", async () => {
    const result = await handleKey("groq", undefined, tmpDir);
    expect(result.output).toContain("Rate limit:");
    expect(result.output).toContain("Model:");
    expect(result.output).toContain("Llama 3.3 70B");
  });
});

// ---------------------------------------------------------------------------
// Part C: Cost Transparency
// ---------------------------------------------------------------------------

describe("handleKey — cost transparency after saving key", () => {
  it("shows cost estimate after saving free provider key", async () => {
    const result = await handleKey("groq", "gsk_valid_test_key_long", tmpDir);
    expect(result.error).toBeUndefined();
    expect(result.output).toContain("💰 Estimated costs");
    expect(result.output).toContain("$0.00/month (free tier)");
    expect(result.output).toContain("Rate limit:");
  });

  it("shows connected confirmation with provider and model name", async () => {
    const result = await handleKey("groq", "gsk_valid_test_key_long", tmpDir);
    expect(result.output).toContain("✓ Groq connected");
    expect(result.output).toContain("Llama 3.3 70B ready");
  });

  it("shows non-zero cost estimate for paid provider (Anthropic)", async () => {
    const result = await handleKey("anthropic", "sk-ant-valid-key-1234567890", tmpDir);
    expect(result.error).toBeUndefined();
    expect(result.output).toContain("💰 Estimated costs");
    expect(result.output).toContain("Claude Sonnet 4.5");
    // Paid provider should show non-$0 costs
    expect(result.output).not.toContain("free tier");
  });

  it("shows budget tip for paid provider", async () => {
    const result = await handleKey("anthropic", "sk-ant-valid-key-1234567890", tmpDir);
    expect(result.output).toContain("budget");
    expect(result.output).toContain("sidjua config set budget");
  });

  it("suggests Google as fallback after adding Groq alone", async () => {
    const result = await handleKey("groq", "gsk_valid_test_key_long", tmpDir);
    expect(result.output).toContain("Tip:");
    expect(result.output).toContain("/key google");
  });

  it("shows multi-provider failover active after two providers configured", async () => {
    // First key
    await handleKey("groq", "gsk_first_valid_key_long", tmpDir);
    // Second key
    const result = await handleKey("google", "AIza_second_valid_key_long", tmpDir);
    expect(result.error).toBeUndefined();
    expect(result.output).toContain("Multi-provider failover active");
  });
});

// ---------------------------------------------------------------------------
// /providers command
// ---------------------------------------------------------------------------

describe("handleProviders", () => {
  it("returns recommendation menu output", () => {
    const result = handleProviders();
    expect(result.error).toBeUndefined();
    expect(result.output).toContain("FREE");
    expect(result.output).toContain("Groq");
    expect(result.output).toContain("Recommended");
  });
});

describe("handleSlashCommand — /providers and /help providers", () => {
  it("dispatches /providers to recommendation menu", async () => {
    const result = await handleSlashCommand("/providers", tmpDir);
    expect(result).not.toBeNull();
    expect(result?.output).toContain("FREE");
    expect(result?.output).toContain("Groq");
    expect(result?.output).toContain("Recommended");
    expect(result?.error).toBeUndefined();
  });

  it("dispatches /help providers to recommendation menu", async () => {
    const result = await handleSlashCommand("/help providers", tmpDir);
    expect(result).not.toBeNull();
    expect(result?.output).toContain("FREE");
    expect(result?.output).toContain("Groq");
    expect(result?.output).toContain("Recommended");
    expect(result?.error).toBeUndefined();
  });

  it("/help without args still shows command list", async () => {
    const result = await handleSlashCommand("/help", tmpDir);
    expect(result?.output).toContain("/key");
    expect(result?.output).toContain("/agents");
    expect(result?.output).toContain("/exit");
  });
});

// ---------------------------------------------------------------------------
// estimateProviderCost — math verification
// ---------------------------------------------------------------------------

describe("estimateProviderCost", () => {
  it("returns exactly 0 for Groq (free provider)", () => {
    expect(estimateProviderCost("groq", 50)).toBe(0);
    expect(estimateProviderCost("groq", 500)).toBe(0);
  });

  it("returns exactly 0 for Google (free provider)", () => {
    expect(estimateProviderCost("google", 50)).toBe(0);
  });

  it("returns exactly 0 for Mistral (free provider)", () => {
    expect(estimateProviderCost("mistral", 50)).toBe(0);
  });

  it("returns non-zero for Anthropic (paid provider)", () => {
    expect(estimateProviderCost("anthropic", 50)).toBeGreaterThan(0);
  });

  it("returns non-zero for OpenAI (paid provider)", () => {
    expect(estimateProviderCost("openai", 50)).toBeGreaterThan(0);
  });

  it("returns non-zero for DeepSeek (near-free provider)", () => {
    expect(estimateProviderCost("deepseek", 50)).toBeGreaterThan(0);
  });

  it("scales linearly: 500 tasks/day costs 10x more than 50 tasks/day", () => {
    const light = estimateProviderCost("anthropic", 50);
    const heavy = estimateProviderCost("anthropic", 500);
    expect(heavy).toBeCloseTo(light * 10, 5);
  });

  it("DeepSeek cost is far less than Anthropic at same volume", () => {
    const deepseek  = estimateProviderCost("deepseek", 500);
    const anthropic = estimateProviderCost("anthropic", 500);
    expect(deepseek).toBeLessThan(anthropic);
  });

  it("returns 0 for unknown provider", () => {
    expect(estimateProviderCost("nonexistent", 50)).toBe(0);
  });

  it("is case-insensitive", () => {
    expect(estimateProviderCost("Groq", 50)).toBe(0);
    expect(estimateProviderCost("ANTHROPIC", 50)).toBeGreaterThan(0);
  });
});
