// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — V0.9.5: Google AI Embedder
 *
 * Uses text-embedding-004 — 768 dimensions, free tier available.
 * Get API key at: https://aistudio.google.com
 *
 * REST endpoint:
 *   POST https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:batchEmbedContents?key={key}
 *   Body: { "requests": [{ "model": "models/text-embedding-004", "content": { "parts": [{ "text": "..." }] } }] }
 *   Response: { "embeddings": [{ "values": number[] }] }
 */

import type { Embedder, EmbedderOptions } from "../types.js";

const DEFAULT_MODEL     = "text-embedding-004";
const DIMENSIONS        = 768;
const MAX_BATCH         = 100;
const BASE_URL          = "https://generativelanguage.googleapis.com/v1beta";
const GOOGLE_MAX_TOKENS = 2048;

interface BatchEmbedRequest {
  requests: {
    model:   string;
    content: { parts: { text: string }[] };
  }[];
}

interface BatchEmbedResponse {
  embeddings: { values: number[] }[];
}

export interface GoogleEmbedderOptions {
  apiKey: string;
  /** Override model (default: text-embedding-004). */
  model?: string;
  /** Override max tokens per text (default: 2048). */
  maxTokens?: number;
}

export class GoogleEmbedder implements Embedder {
  readonly dimensions = DIMENSIONS;
  readonly maxTokens: number;

  private readonly apiKey: string;
  private readonly model:  string;

  constructor(opts: GoogleEmbedderOptions) {
    this.apiKey    = opts.apiKey;
    this.model     = opts.model ?? DEFAULT_MODEL;
    this.maxTokens = opts.maxTokens ?? GOOGLE_MAX_TOKENS;
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
    const url = `${BASE_URL}/models/${this.model}:batchEmbedContents?key=${this.apiKey}`;

    const body: BatchEmbedRequest = {
      requests: texts.map((text) => ({
        model:   `models/${this.model}`,
        content: { parts: [{ text }] },
      })),
    };

    const response = await fetch(url, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "(unreadable)");
      throw new Error(
        `Google embedding request failed: ${response.status} ${response.statusText} — ${text}`,
      );
    }

    const json = await response.json() as BatchEmbedResponse;

    if (!Array.isArray(json.embeddings) || json.embeddings.length === 0) {
      throw new Error("Google AI returned no embeddings");
    }

    return json.embeddings.map((e) => new Float32Array(e.values));
  }
}
