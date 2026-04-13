// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 13d: Provider Auto-Detection Probe
 *
 * Tests a provider endpoint's capabilities:
 *   1. GET /models — alive + model list
 *   2. POST /chat/completions — basic chat
 *   3. POST /chat/completions with tool — tool calling
 *
 * CRITICAL: Probe failures are WARNINGS only. Never block provider addition.
 */

import { createLogger } from "../core/logger.js";

const logger = createLogger("auto-detect");


export interface ProbeConfig {
  base_url:       string;
  api_key?:       string;
  model:          string;
  custom_headers?: Record<string, string>;
  timeout_ms?:    number;
}

export interface ProbeResult {
  alive:            boolean;
  models_endpoint:  boolean;
  available_models: string[];
  chat_completions: boolean;
  tool_use:         boolean;
  response_time_ms: number;
  errors:           string[];
}


export class ProviderAutoDetect {
  private readonly timeoutMs: number;

  constructor(timeoutMs = 30_000) {
    this.timeoutMs = timeoutMs;
  }

  /**
   * Run the full probe sequence against a provider endpoint.
   * Never throws — returns errors array on failure.
   */
  async probe(config: ProbeConfig): Promise<ProbeResult> {
    const result: ProbeResult = {
      alive:            false,
      models_endpoint:  false,
      available_models: [],
      chat_completions: false,
      tool_use:         false,
      response_time_ms: 0,
      errors:           [],
    };

    const base    = config.base_url.replace(/\/$/, "");
    const headers = this._buildHeaders(config.api_key, config.custom_headers);
    const start   = Date.now();

    // 1. GET /models — check alive + model list
    await this._probeModels(base, headers, result, config.timeout_ms ?? 10_000);

    // 2. POST /chat/completions — basic chat
    if (result.alive || !result.models_endpoint) {
      // Try chat even if models endpoint failed (endpoint may not support /models)
      await this._probeChat(base, headers, config.model, result, config.timeout_ms ?? this.timeoutMs);
    }

    // 3. Tool calling (only if basic chat worked)
    if (result.chat_completions) {
      await this._probeToolUse(base, headers, config.model, result, config.timeout_ms ?? this.timeoutMs);
    }

    result.response_time_ms = Date.now() - start;

    logger.info("probe_complete", `Probe complete for ${base}`, {
      metadata: {
        base_url:         base,
        alive:            result.alive,
        chat_completions: result.chat_completions,
        tool_use:         result.tool_use,
        response_time_ms: result.response_time_ms,
      },
    });

    return result;
  }

  // ---------------------------------------------------------------------------
  // Private probe steps
  // ---------------------------------------------------------------------------

  private async _probeModels(
    base:    string,
    headers: Record<string, string>,
    result:  ProbeResult,
    timeout: number,
  ): Promise<void> {
    try {
      const controller = new AbortController();
      const timer      = setTimeout(() => controller.abort(), timeout);

      try {
        const res = await fetch(`${base}/models`, {
          method: "GET",
          headers,
          signal: controller.signal,
        });

        clearTimeout(timer);

        if (res.ok) {
          result.alive           = true;
          result.models_endpoint = true;

          const body = await res.json() as { data?: { id: string }[] };
          if (Array.isArray(body.data)) {
            result.available_models = body.data.map((m) => m.id).slice(0, 20);
          }
        } else if (res.status === 404) {
          // /models not supported — endpoint may still be alive
          result.alive           = true;
          result.models_endpoint = false;
          result.errors.push(`GET /models returned 404 — endpoint may not support model listing`);
        } else if (res.status === 401 || res.status === 403) {
          result.errors.push(`GET /models returned ${res.status} — check API key`);
        } else {
          result.errors.push(`GET /models returned ${res.status}`);
        }
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("abort") || msg.includes("timeout")) {
        result.errors.push(`GET /models timed out after ${timeout}ms`);
      } else {
        result.errors.push(`GET /models connection failed: ${msg}`);
      }
    }
  }

  private async _probeChat(
    base:    string,
    headers: Record<string, string>,
    model:   string,
    result:  ProbeResult,
    timeout: number,
  ): Promise<void> {
    try {
      const controller = new AbortController();
      const timer      = setTimeout(() => controller.abort(), timeout);

      const body = JSON.stringify({
        model,
        messages:   [{ role: "user", content: "Say hello in one word." }],
        max_tokens: 10,
      });

      try {
        const res = await fetch(`${base}/chat/completions`, {
          method:  "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body,
          signal:  controller.signal,
        });

        clearTimeout(timer);

        if (res.ok) {
          result.alive            = true;
          result.chat_completions = true;
        } else if (res.status === 401 || res.status === 403) {
          result.errors.push(`Chat completions returned ${res.status} — check API key`);
        } else {
          result.errors.push(`Chat completions returned ${res.status}`);
        }
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("abort") || msg.includes("timeout")) {
        result.errors.push(`Chat completions timed out after ${timeout}ms`);
      } else {
        result.errors.push(`Chat completions connection failed: ${msg}`);
      }
    }
  }

  private async _probeToolUse(
    base:    string,
    headers: Record<string, string>,
    model:   string,
    result:  ProbeResult,
    timeout: number,
  ): Promise<void> {
    try {
      const controller = new AbortController();
      const timer      = setTimeout(() => controller.abort(), timeout);

      const body = JSON.stringify({
        model,
        messages: [{ role: "user", content: "What is 2+2? Use the calculator tool." }],
        max_tokens: 50,
        tools: [{
          type:     "function",
          function: {
            name:        "calculator",
            description: "Calculate a math expression",
            parameters:  {
              type:       "object",
              properties: { expression: { type: "string" } },
              required:   ["expression"],
            },
          },
        }],
        tool_choice: "auto",
      });

      try {
        const res = await fetch(`${base}/chat/completions`, {
          method:  "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body,
          signal:  controller.signal,
        });

        clearTimeout(timer);

        if (res.ok) {
          const respBody = await res.json() as {
            choices?: { message?: { tool_calls?: unknown[] } }[];
          };
          const toolCalls = respBody.choices?.[0]?.message?.tool_calls;
          result.tool_use = Array.isArray(toolCalls) && toolCalls.length > 0;

          if (!result.tool_use) {
            result.errors.push(`Tool use: no tool_calls in response — model may not support tool calling`);
          }
        } else {
          result.errors.push(`Tool use probe returned ${res.status}`);
        }
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`Tool use probe failed: ${msg}`);
    }
  }

  private _buildHeaders(
    apiKey?:       string,
    customHeaders?: Record<string, string>,
  ): Record<string, string> {
    const headers: Record<string, string> = {};
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }
    if (customHeaders) {
      Object.assign(headers, customHeaders);
    }
    return headers;
  }
}
