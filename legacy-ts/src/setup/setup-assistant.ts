// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 13d: Setup Assistant
 *
 * Provides interactive setup guidance and recommendations using Cloudflare
 * Workers AI (free tier). Degrades gracefully when unavailable — all setup
 * actions can be performed manually without this assistant.
 *
 * Credentials: Uses PLACEHOLDER_ACCOUNT_ID / PLACEHOLDER_API_TOKEN as
 * embedded defaults; overridden by CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_AI_API_KEY
 * environment variables when available.
 *
 * NEVER blocks provider addition or key configuration — all failures are
 * warnings that print the relevant doc section instead.
 */

import { createLogger } from "../core/logger.js";
import { SidjuaError }  from "../core/error-codes.js";
import type { ProviderCatalogEntry } from "../providers/catalog.js";
import { DOCS } from "./embedded-docs.js";

const logger = createLogger("setup");


const PLACEHOLDER_ACCOUNT_ID  = "PLACEHOLDER_ACCOUNT_ID";
const PLACEHOLDER_API_TOKEN   = "PLACEHOLDER_API_TOKEN";
const DEFAULT_SETUP_MODEL     = "@cf/meta/llama-3.1-8b-instruct";
const CLOUDFLARE_ENDPOINT     =
  "https://api.cloudflare.com/client/v4/accounts/{accountId}/ai/v1/chat/completions";
const SETUP_TIMEOUT_MS        = 20_000;


export interface SetupQuestion {
  topic:    string;     // e.g. "provider selection", "model recommendation"
  context?: string;     // additional context to include in the prompt
}

export interface SetupResponse {
  answer:          string;
  fromAssistant:   boolean;   // false = fallback doc snippet
  docSection?:     string;    // which doc file was used for fallback
}

export interface SetupValidationResult {
  valid:    boolean;
  issues:   string[];
  warnings: string[];
}


export class SetupAssistant {
  private readonly accountId: string;
  private readonly apiToken:  string;
  private readonly model:     string;
  private          available: boolean | null = null;  // lazy probe

  constructor(options?: {
    accountId?: string;
    apiToken?:  string;
    model?:     string;
  }) {
    this.accountId = options?.accountId
      ?? process.env["CLOUDFLARE_ACCOUNT_ID"]
      ?? PLACEHOLDER_ACCOUNT_ID;

    this.apiToken = options?.apiToken
      ?? process.env["CLOUDFLARE_AI_API_KEY"]
      ?? PLACEHOLDER_API_TOKEN;

    this.model = options?.model ?? DEFAULT_SETUP_MODEL;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Ask the setup assistant a question.
   * Falls back to the relevant doc section if the assistant is unavailable.
   * Never throws.
   */
  async ask(question: SetupQuestion): Promise<SetupResponse> {
    if (await this._isAvailable()) {
      try {
        return await this._callAssistant(question);
      } catch (err) {
        logger.warn("setup_assistant_call_failed", "Setup assistant call failed, using doc fallback", {
          metadata: { topic: question.topic, error: String(err) },
        });
      }
    }

    // Graceful fallback: return relevant doc snippet
    return this._docFallback(question.topic);
  }

  /**
   * Suggest providers based on user's stated requirements.
   * Falls back to doc recommendations if assistant is unavailable.
   */
  async suggestProviders(requirements: {
    budget?:     "zero" | "low" | "standard" | "high";
    useCase?:    string;
    localOnly?:  boolean;
  }): Promise<SetupResponse> {
    const contextParts: string[] = [];
    if (requirements.budget)    contextParts.push(`Budget: ${requirements.budget}`);
    if (requirements.useCase)   contextParts.push(`Use case: ${requirements.useCase}`);
    if (requirements.localOnly) contextParts.push("Preference: local/offline models only");

    return this.ask({
      topic:   "provider selection",
      context: contextParts.join(". "),
    });
  }

  /**
   * Validate a set of provider entries for common misconfigurations.
   * Pure local logic — no LLM call.
   */
  validateProviderConfig(providers: ProviderCatalogEntry[]): SetupValidationResult {
    const issues:   string[] = [];
    const warnings: string[] = [];

    if (providers.length === 0) {
      warnings.push("No providers configured. Run `sidjua setup` or `sidjua provider add` to add one.");
    }

    const cloudProviders = providers.filter((p) => p.category === "cloud");
    const localProviders = providers.filter((p) => p.category === "local");

    if (cloudProviders.length > 0 && localProviders.length === 0) {
      warnings.push("Only cloud providers configured. Consider adding a local provider as fallback.");
    }

    for (const p of providers) {
      // Local providers are expected to have dynamic/empty model lists
      if (p.category !== "local" && p.models.length === 0) {
        issues.push(`Provider "${p.id}" has no models configured.`);
      }
    }

    return {
      valid: issues.length === 0,
      issues,
      warnings,
    };
  }

  /**
   * Load a bundled setup doc by topic.
   * Returns the raw markdown content, or a fallback message.
   */
  loadDoc(topic: "quick-start" | "provider-guide" | "model-recommendations"): string {
    return DOCS[topic];
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Lazy-probe whether Cloudflare AI is actually reachable with given credentials. */
  private async _isAvailable(): Promise<boolean> {
    if (this.available !== null) return this.available;

    // Placeholder credentials → definitely not available
    if (
      this.accountId === PLACEHOLDER_ACCOUNT_ID ||
      this.apiToken  === PLACEHOLDER_API_TOKEN
    ) {
      this.available = false;
      logger.info("setup_assistant_unavailable", "Setup assistant using placeholder credentials — degrading to docs", {});
      return false;
    }

    // Try a lightweight ping
    try {
      const url        = CLOUDFLARE_ENDPOINT.replace("{accountId}", this.accountId);
      const controller = new AbortController();
      const timer      = setTimeout(() => controller.abort(), 5_000);
      try {
        const res = await fetch(url, {
          method:  "POST",
          headers: {
            "Authorization": `Bearer ${this.apiToken}`,
            "Content-Type":  "application/json",
          },
          body:   JSON.stringify({ model: this.model, messages: [{ role: "user", content: "hi" }], max_tokens: 1 }),
          signal: controller.signal,
        });
        this.available = res.ok || res.status === 400; // 400 = auth OK but bad request
      } finally {
        clearTimeout(timer);
      }
    } catch (e: unknown) {
      logger.warn("setup-assistant", "Provider probe failed — marking as unavailable", { metadata: { error: e instanceof Error ? e.message : String(e) } });
      this.available = false;
    }

    logger.info(
      "setup_assistant_probe",
      `Setup assistant ${this.available ? "available" : "unavailable"}`,
      { metadata: { available: this.available } },
    );

    return this.available;
  }

  private async _callAssistant(question: SetupQuestion): Promise<SetupResponse> {
    const url        = CLOUDFLARE_ENDPOINT.replace("{accountId}", this.accountId);
    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), SETUP_TIMEOUT_MS);

    const systemPrompt =
      "You are the SIDJUA setup assistant. SIDJUA is an open-source AI agent governance platform. " +
      "Help users configure providers, select models, and get started quickly. " +
      "Be concise and practical. If you don't know something, say so.";

    const userPrompt = question.context
      ? `Topic: ${question.topic}\nContext: ${question.context}`
      : `Topic: ${question.topic}`;

    let res: Response;
    try {
      res = await fetch(url, {
        method:  "POST",
        headers: {
          "Authorization": `Bearer ${this.apiToken}`,
          "Content-Type":  "application/json",
        },
        body: JSON.stringify({
          model:    this.model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user",   content: userPrompt },
          ],
          max_tokens: 512,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      throw SidjuaError.from("PROV-011", `Setup assistant returned ${res.status}`);
    }

    const body = await res.json() as {
      choices?: { message?: { content?: string } }[];
    };

    const content = body.choices?.[0]?.message?.content ?? "";
    if (!content) {
      throw SidjuaError.from("PROV-011", "Setup assistant returned empty response");
    }

    return { answer: content, fromAssistant: true };
  }

  private _docFallback(topic: string): SetupResponse {
    let docSection: "quick-start" | "provider-guide" | "model-recommendations" = "quick-start";

    if (topic.includes("provider") || topic.includes("key") || topic.includes("api")) {
      docSection = "provider-guide";
    } else if (topic.includes("model") || topic.includes("recommend")) {
      docSection = "model-recommendations";
    }

    const content = this.loadDoc(docSection);

    return {
      answer:        content,
      fromAssistant: false,
      docSection,
    };
  }
}
