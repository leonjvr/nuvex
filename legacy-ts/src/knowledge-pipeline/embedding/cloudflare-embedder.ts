// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — V0.9.5: Cloudflare Workers AI Embedder
 *
 * Uses @cf/baai/bge-base-en-v1.5 — 768 dimensions, free tier.
 * Reuses the same Cloudflare account credentials as the Guide agent.
 *
 * REST endpoint:
 *   POST https://api.cloudflare.com/client/v4/accounts/{accountId}/ai/run/@cf/baai/bge-base-en-v1.5
 *   Authorization: Bearer {token}
 *   Body: { "text": string[] }
 *   Response: { "result": { "data": number[][] }, "success": boolean }
 */

import type { Embedder, EmbedderOptions } from "../types.js";

const CF_EMBED_MODEL  = "@cf/baai/bge-base-en-v1.5";
const DIMENSIONS      = 768;
const MAX_BATCH       = 100;
const BASE_URL        = "https://api.cloudflare.com/client/v4";
const CF_MAX_TOKENS   = 512;

interface CfEmbedResponse {
  result:  { shape: number[]; data: number[][] };
  success: boolean;
  errors:  { message: string }[];
}

export interface CloudflareEmbedderOptions {
  accountId: string;
  apiToken:  string;
  /** Override model (default: @cf/baai/bge-base-en-v1.5). */
  model?:    string;
  /** Override max tokens per text (default: 512). */
  maxTokens?: number;
}

export class CloudflareEmbedder implements Embedder {
  readonly dimensions = DIMENSIONS;
  readonly maxTokens: number;

  private readonly accountId: string;
  private readonly apiToken:  string;
  private readonly model:     string;

  constructor(opts: CloudflareEmbedderOptions) {
    this.accountId = opts.accountId;
    this.apiToken  = opts.apiToken;
    this.model     = opts.model ?? CF_EMBED_MODEL;
    this.maxTokens = opts.maxTokens ?? CF_MAX_TOKENS;
  }

  async embed(texts: string[], _options?: EmbedderOptions): Promise<Float32Array[]> {
    const results: Float32Array[] = [];

    for (let i = 0; i < texts.length; i += MAX_BATCH) {
      const batch = texts.slice(i, i + MAX_BATCH);
      const embeddings = await this._embedBatch(batch);
      results.push(...embeddings);
    }

    return results;
  }

  private async _embedBatch(texts: string[]): Promise<Float32Array[]> {
    const url = `${BASE_URL}/accounts/${this.accountId}/ai/run/${this.model}`;

    const response = await fetch(url, {
      method:  "POST",
      headers: {
        "Authorization": `Bearer ${this.apiToken}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify({ text: texts }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "(unreadable)");
      throw new Error(
        `Cloudflare embedding request failed: ${response.status} ${response.statusText} — ${text}`,
      );
    }

    const json = await response.json() as CfEmbedResponse;

    if (!json.success) {
      const msg = json.errors.map((e) => e.message).join("; ");
      throw new Error(`Cloudflare embedding API error: ${msg}`);
    }

    return json.result.data.map((vec) => new Float32Array(vec));
  }
}
