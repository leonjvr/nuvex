// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Guide: Chat Engine
 *
 * Manages the interactive Guide conversation:
 *   - Maintains conversation history
 *   - Calls Cloudflare Workers AI via direct HTTP (OpenAI-compatible endpoint)
 *   - Dispatches tool calls (create_agent, list_agents, configure_provider)
 *   - Degrades gracefully when Cloudflare is unreachable
 *
 * This is intentionally separate from the AgentReasoningLoop — Guide chat
 * is a simple multi-turn conversation, not a task-execution pipeline.
 */

import { createLogger }            from "../core/logger.js";
import { SidjuaError }             from "../core/error-codes.js";
import { getEmbeddedAccountId, getEmbeddedToken, hasEmbeddedCredentials } from "./token.js";
import { createAgent }             from "./agent-creator.js";
import type { AgentCreationSpec }  from "./agent-creator.js";
import type { ToolDefinition }     from "../providers/types.js";

const logger = createLogger("guide");


export const GUIDE_PRIMARY_MODEL  = "@cf/meta/llama-4-scout-17b-16e-instruct";
export const GUIDE_FALLBACK_MODEL = "@cf/qwen/qwen3-32b";
export const GUIDE_TIMEOUT_MS     = 30_000;
export const GUIDE_MAX_TOKENS     = 1024;
export const GUIDE_HISTORY_LIMIT  = 40;  // Keep last 40 turns in context

/** Public SIDJUA Guide proxy — OpenAI-compatible, no API key required. */
export const GUIDE_PROXY_URL        = "https://guide-api.sidjua.com/v1";
export const GUIDE_PROXY_HEALTH_URL = "https://guide-api.sidjua.com/health";
export const GUIDE_PROXY_API_KEY    = "guide";


export interface ChatMessage {
  role:    "user" | "assistant" | "system";
  content: string;
}

export interface ChatTurn {
  userMessage: string;
  reply:       string;
  toolsUsed:   string[];
  error?:      string;
}

export interface GuideChatOptions {
  workDir:     string;
  systemPrompt: string;
  model?:      string;
  timeoutMs?:  number;
  /** Injected for testing — overrides the real fetch. */
  fetchFn?:    typeof fetch;
  /**
   * Override the proxy base URL.
   * Pass `null` to disable proxy (true offline mode).
   * Defaults to GUIDE_PROXY_URL.
   */
  proxyUrl?:   string | null;
}


interface CFMessage {
  role:         string;
  content:      string | null;
  tool_calls?:  CFToolCall[];
  tool_call_id?: string;
}

interface CFToolCall {
  id:       string;
  type:     "function";
  function: { name: string; arguments: string };
}

interface CFResponse {
  choices?: Array<{
    message: {
      content:     string | null;
      tool_calls?: CFToolCall[];
    };
    finish_reason: string | null;
  }>;
  error?: { message?: string };
}


const GUIDE_TOOLS: ToolDefinition[] = [
  {
    name:        "create_agent",
    description: "Create a new AI agent with a definition file and skill file. Use when the user wants to add a new agent to their workspace.",
    parameters: {
      type: "object",
      properties: {
        id:           { type: "string", description: "Lowercase alphanumeric ID with hyphens (e.g. my-researcher)" },
        name:         { type: "string", description: "Human-readable agent name" },
        tier:         { type: "string", description: "Agent tier: 1 (strategic), 2 (department head), 3 (specialist/worker)", enum: ["1", "2", "3"] },
        division:     { type: "string", description: "Division this agent belongs to (e.g. engineering, research)" },
        provider:     { type: "string", description: "LLM provider (e.g. groq, google, anthropic, cloudflare)" },
        model:        { type: "string", description: "Model ID (e.g. llama-3.3-70b-versatile for Groq)" },
        capabilities: { type: "string", description: "Comma-separated list of capabilities" },
        description:  { type: "string", description: "What this agent does (1-2 sentences)" },
        budget_per_task:  { type: "string", description: "Max cost per task in USD (e.g. 0.10). Use 0 for free providers." },
        budget_per_month: { type: "string", description: "Monthly budget cap in USD (e.g. 5.00). Use 0 for free providers." },
      },
      required: ["id", "name", "tier", "division", "provider", "model", "capabilities", "description"],
    },
  },
];


export class GuideChat {
  private history:    ChatMessage[] = [];
  private readonly accountId: string;
  private readonly token:     string;
  private readonly model:     string;
  private readonly timeoutMs: number;
  private readonly fetchFn:   typeof fetch;
  private readonly workDir:   string;
  private readonly systemPrompt: string;
  private readonly proxyUrl:  string;

  constructor(opts: GuideChatOptions) {
    this.workDir      = opts.workDir;
    this.systemPrompt = opts.systemPrompt;
    this.model        = opts.model      ?? GUIDE_PRIMARY_MODEL;
    this.timeoutMs    = opts.timeoutMs  ?? GUIDE_TIMEOUT_MS;
    this.fetchFn      = opts.fetchFn    ?? fetch;
    this.accountId    = getEmbeddedAccountId();
    this.token        = getEmbeddedToken();
    // proxyUrl: undefined (omitted) → GUIDE_PROXY_URL; null → "" (disabled)
    const proxyOverride = opts.proxyUrl;
    this.proxyUrl = proxyOverride !== undefined ? (proxyOverride ?? "") : GUIDE_PROXY_URL;
  }

  /** True when direct Cloudflare credentials are configured (not placeholders). */
  get isAvailable(): boolean {
    return hasEmbeddedCredentials();
  }

  /**
   * Returns the active connection mode:
   *   "direct"  — using embedded Cloudflare credentials
   *   "proxy"   — using the public SIDJUA Guide proxy (no key needed)
   *   "offline" — no backend available (proxy disabled, no CF creds)
   */
  get connectionMode(): "direct" | "proxy" | "offline" {
    if (hasEmbeddedCredentials()) return "direct";
    if (this.proxyUrl) return "proxy";
    return "offline";
  }

  /** Send a user message and receive a reply. */
  async send(userMessage: string): Promise<ChatTurn> {
    // Add user message to history
    this.history.push({ role: "user", content: userMessage });

    const mode = this.connectionMode;

    if (mode === "offline") {
      const reply = this._offlineReply(userMessage);
      this.history.push({ role: "assistant", content: reply });
      return { userMessage, reply, toolsUsed: [] };
    }

    try {
      return await (mode === "direct"
        ? this._callCloudflare(userMessage)
        : this._callProxy(userMessage));
    } catch (err) {
      logger.warn("guide_chat_error", "Guide chat call failed", {
        metadata: { error: String(err) },
      });
      const reply = this._errorReply(err);
      this.history.push({ role: "assistant", content: reply });
      return { userMessage, reply, toolsUsed: [], error: String(err) };
    }
  }

  /** Clear conversation history. */
  clearHistory(): void {
    this.history = [];
  }

  /** Get a copy of the current conversation history. */
  getHistory(): ChatMessage[] {
    return [...this.history];
  }

  // ---------------------------------------------------------------------------
  // Private: Cloudflare API call
  // ---------------------------------------------------------------------------

  private async _callCloudflare(userMessage: string): Promise<ChatTurn> {
    const url        = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/ai/v1/chat/completions`;
    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), this.timeoutMs);

    // Keep history within limits (system + last N turns)
    const recentHistory = this.history.slice(-GUIDE_HISTORY_LIMIT);

    const messages: CFMessage[] = [
      { role: "system", content: this.systemPrompt },
      ...recentHistory.map((m) => ({ role: m.role, content: m.content })),
    ];

    const toolsUsed: string[] = [];

    let res: Response;
    try {
      res = await this.fetchFn(url, {
        method:  "POST",
        headers: {
          "Authorization": `Bearer ${this.token}`,
          "Content-Type":  "application/json",
        },
        body: JSON.stringify({
          model:      this.model,
          messages,
          tools:      GUIDE_TOOLS.map(this._toOAITool),
          max_tokens: GUIDE_MAX_TOKENS,
          temperature: 0.7,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw SidjuaError.from("PROV-011", `Cloudflare returned ${res.status}: ${text.slice(0, 200)}`);
    }

    const body = await res.json() as CFResponse;

    if (body.error?.message) {
      throw SidjuaError.from("PROV-011", `Cloudflare error: ${body.error.message}`);
    }

    const choice = body.choices?.[0];
    if (!choice) {
      throw SidjuaError.from("PROV-011", "Cloudflare returned no choices");
    }

    // Handle tool calls first
    const toolCallsArr  = choice.message.tool_calls ?? [];
    const toolResults: CFMessage[] = [];

    if (toolCallsArr.length > 0) {
      // Add assistant message with tool calls to history wire
      const assistantMsg: CFMessage = {
        role:       "assistant",
        content:    choice.message.content ?? null,
        tool_calls: toolCallsArr,
      };

      for (const tc of toolCallsArr) {
        const toolName = tc.function.name;
        toolsUsed.push(toolName);

        let toolResult: string;
        try {
          toolResult = await this._dispatchTool(toolName, tc.function.arguments);
        } catch (err) {
          toolResult = `Error: ${String(err)}`;
        }

        toolResults.push({
          role:         "tool",
          content:      toolResult,
          tool_call_id: tc.id,
        } as CFMessage);
      }

      // Second call with tool results
      const messagesWithResults: CFMessage[] = [
        { role: "system", content: this.systemPrompt },
        ...recentHistory.map((m) => ({ role: m.role, content: m.content })),
        assistantMsg,
        ...toolResults,
      ];

      const controller2 = new AbortController();
      const timer2 = setTimeout(() => controller2.abort(), this.timeoutMs);

      let res2: Response;
      try {
        res2 = await this.fetchFn(url, {
          method:  "POST",
          headers: {
            "Authorization": `Bearer ${this.token}`,
            "Content-Type":  "application/json",
          },
          body: JSON.stringify({
            model:      this.model,
            messages:   messagesWithResults,
            max_tokens: GUIDE_MAX_TOKENS,
          }),
          signal: controller2.signal,
        });
      } finally {
        clearTimeout(timer2);
      }

      if (!res2.ok) {
        const text = await res2.text().catch(() => "");
        throw SidjuaError.from("PROV-011", `Cloudflare returned ${res2.status}: ${text.slice(0, 200)}`);
      }

      const body2   = await res2.json() as CFResponse;
      const reply2  = body2.choices?.[0]?.message.content ?? "(no response)";

      this.history.push({ role: "assistant", content: reply2 });
      return { userMessage, reply: reply2, toolsUsed };
    }

    // Simple text reply (no tool calls)
    const reply = choice.message.content ?? "(no response)";
    this.history.push({ role: "assistant", content: reply });
    return { userMessage, reply, toolsUsed };
  }

  // ---------------------------------------------------------------------------
  // Private: Proxy API call (OpenAI-compatible endpoint, no API key needed)
  // ---------------------------------------------------------------------------

  private async _callProxy(userMessage: string): Promise<ChatTurn> {
    const url        = `${this.proxyUrl}/chat/completions`;
    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), this.timeoutMs);

    const recentHistory = this.history.slice(-GUIDE_HISTORY_LIMIT);
    const messages: CFMessage[] = [
      { role: "system", content: this.systemPrompt },
      ...recentHistory.map((m) => ({ role: m.role, content: m.content })),
    ];

    const toolsUsed: string[] = [];

    let res: Response;
    try {
      res = await this.fetchFn(url, {
        method:  "POST",
        headers: {
          "Authorization": `Bearer ${GUIDE_PROXY_API_KEY}`,
          "Content-Type":  "application/json",
        },
        body: JSON.stringify({
          model:       this.model,
          messages,
          tools:       GUIDE_TOOLS.map(this._toOAITool),
          max_tokens:  GUIDE_MAX_TOKENS,
          temperature: 0.7,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      if (res.status === 429) {
        throw SidjuaError.from("PROV-002", "guide:proxy:rate_limited");
      }
      throw SidjuaError.from("PROV-011", `Guide proxy returned ${res.status}: ${text.slice(0, 200)}`);
    }

    const body = await res.json() as CFResponse;

    if (body.error?.message) {
      throw SidjuaError.from("PROV-011", `Proxy error: ${body.error.message}`);
    }

    const choice = body.choices?.[0];
    if (!choice) {
      throw SidjuaError.from("PROV-011", "Guide proxy returned no choices");
    }

    // Handle tool calls
    const toolCallsArr  = choice.message.tool_calls ?? [];
    const toolResults: CFMessage[] = [];

    if (toolCallsArr.length > 0) {
      const assistantMsg: CFMessage = {
        role:       "assistant",
        content:    choice.message.content ?? null,
        tool_calls: toolCallsArr,
      };

      for (const tc of toolCallsArr) {
        const toolName = tc.function.name;
        toolsUsed.push(toolName);

        let toolResult: string;
        try {
          toolResult = await this._dispatchTool(toolName, tc.function.arguments);
        } catch (err) {
          toolResult = `Error: ${String(err)}`;
        }

        toolResults.push({
          role:         "tool",
          content:      toolResult,
          tool_call_id: tc.id,
        } as CFMessage);
      }

      // Second call with tool results
      const messagesWithResults: CFMessage[] = [
        { role: "system", content: this.systemPrompt },
        ...recentHistory.map((m) => ({ role: m.role, content: m.content })),
        assistantMsg,
        ...toolResults,
      ];

      const controller2 = new AbortController();
      const timer2 = setTimeout(() => controller2.abort(), this.timeoutMs);

      let res2: Response;
      try {
        res2 = await this.fetchFn(url, {
          method:  "POST",
          headers: {
            "Authorization": `Bearer ${GUIDE_PROXY_API_KEY}`,
            "Content-Type":  "application/json",
          },
          body: JSON.stringify({
            model:      this.model,
            messages:   messagesWithResults,
            max_tokens: GUIDE_MAX_TOKENS,
          }),
          signal: controller2.signal,
        });
      } finally {
        clearTimeout(timer2);
      }

      if (!res2.ok) {
        const text = await res2.text().catch(() => "");
        if (res2.status === 429) {
          throw SidjuaError.from("PROV-002", "guide:proxy:rate_limited");
        }
        throw SidjuaError.from("PROV-011", `Guide proxy returned ${res2.status}: ${text.slice(0, 200)}`);
      }

      const body2  = await res2.json() as CFResponse;
      const reply2 = body2.choices?.[0]?.message.content ?? "(no response)";

      this.history.push({ role: "assistant", content: reply2 });
      return { userMessage, reply: reply2, toolsUsed };
    }

    // Simple text reply
    const reply = choice.message.content ?? "(no response)";
    this.history.push({ role: "assistant", content: reply });
    return { userMessage, reply, toolsUsed };
  }

  // ---------------------------------------------------------------------------
  // Private: Tool dispatch
  // ---------------------------------------------------------------------------

  private async _dispatchTool(name: string, argsJson: string): Promise<string> {
    const args = JSON.parse(argsJson) as Record<string, unknown>;

    if (name === "create_agent") {
      return this._toolCreateAgent(args);
    }

    return `Unknown tool: ${name}`;
  }

  private async _toolCreateAgent(args: Record<string, unknown>): Promise<string> {
    const id           = String(args["id"]   ?? "").trim();
    const agentName    = String(args["name"] ?? id);
    const tierStr      = String(args["tier"] ?? "3");
    const tier         = (["1", "2", "3"].includes(tierStr) ? parseInt(tierStr, 10) : 3) as 1 | 2 | 3;
    const division     = String(args["division"]     ?? "general");
    const provider     = String(args["provider"]     ?? "groq");
    const model        = String(args["model"]        ?? "llama-3.3-70b-versatile");
    const capsStr      = String(args["capabilities"] ?? "general");
    const description  = String(args["description"]  ?? "");
    const budgetTask   = parseFloat(String(args["budget_per_task"]  ?? "0.10")) || 0.10;
    const budgetMonth  = parseFloat(String(args["budget_per_month"] ?? "5.00")) || 5.00;

    const capabilities = capsStr.split(/[,;]+/).map((c) => c.trim()).filter(Boolean);

    const spec: AgentCreationSpec = {
      id,
      name:         agentName,
      tier,
      division,
      provider,
      model,
      capabilities,
      description,
      budget: { per_task_usd: budgetTask, per_month_usd: budgetMonth },
    };

    const result = await createAgent(spec, this.workDir);

    return JSON.stringify({
      success:        true,
      agent_id:       id,
      definition_path: result.definitionPath,
      skill_path:      result.skillPath,
      message:        `Agent "${agentName}" created successfully`,
    });
  }

  // ---------------------------------------------------------------------------
  // Private: OpenAI tool format
  // ---------------------------------------------------------------------------

  private _toOAITool(tool: ToolDefinition): unknown {
    return {
      type:     "function",
      function: {
        name:        tool.name,
        description: tool.description,
        parameters:  tool.parameters,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Private: Offline / error replies
  // ---------------------------------------------------------------------------

  private _offlineReply(userMessage: string): string {
    const lower = userMessage.toLowerCase();

    // Detect key questions
    if (lower.includes("create") && lower.includes("agent")) {
      return [
        "I'd love to help you create an agent, but I'm currently running in offline mode",
        "(the embedded Cloudflare credentials need to be configured in production).",
        "",
        "To create an agent manually:",
        "  1. Copy a template from agents/templates/",
        "  2. Save as agents/definitions/<your-agent>.yaml",
        "  3. Create agents/skills/<your-agent>.md",
        "  4. Add the agent ID to agents/agents.yaml",
        "",
        "Or set up SIDJUA_CF_ACCOUNT_ID and SIDJUA_CF_TOKEN to enable the full Guide.",
      ].join("\n");
    }

    if (lower.includes("/key") || lower.includes("api key") || lower.includes("provider")) {
      return [
        "To add an API key for a provider, use: /key <provider> <your-api-key>",
        "",
        "Example: /key groq gsk_abc123...",
        "",
        "Supported: groq, google, anthropic, openai, deepseek, grok, mistral, cohere",
      ].join("\n");
    }

    return [
      "I'm currently in offline mode — the Cloudflare AI connection isn't available.",
      "",
      "Available commands:",
      "  /key <provider> <api-key>  — Configure a provider",
      "  /agents                    — List your agents",
      "  /status                    — Check workspace status",
      "  /help                      — Show all commands",
      "  /exit                      — Exit",
    ].join("\n");
  }

  private _errorReply(err: unknown): string {
    const msg = String(err);

    // Proxy-specific 429: show full /key hints
    if (msg.includes("guide:proxy:rate_limited")) {
      return [
        "Rate limit reached. Add your own key for unlimited access:",
        "  /key groq <your-api-key>  (free at https://console.groq.com)",
        "  /key google <your-key>    (free at https://aistudio.google.com)",
      ].join("\n");
    }

    if (msg.includes("abort") || msg.includes("timeout")) {
      return "Request timed out. The service may be slow — please try again.";
    }
    if (msg.includes("401") || msg.includes("403")) {
      return "Authentication error. The embedded Guide credentials may need to be refreshed.";
    }
    if (msg.includes("429")) {
      return "Rate limit reached. The Guide's free tier has a daily limit — try again later or add your own API key with /key.";
    }
    return `I encountered an error: ${msg.slice(0, 100)}. Please try again.`;
  }
}


/**
 * Check if the SIDJUA Guide proxy is reachable.
 * Returns true if GET https://guide-api.sidjua.com/health returns HTTP 200.
 * Accepts an optional fetch override for testing.
 */
export async function checkProxyHealth(fetchFn: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchFn(GUIDE_PROXY_HEALTH_URL);
    return res.status === 200;
  } catch (e: unknown) {
    logger.warn("guide-chat", "Proxy health check failed — treating as unhealthy", { metadata: { error: e instanceof Error ? e.message : String(e) } });
    return false;
  }
}
