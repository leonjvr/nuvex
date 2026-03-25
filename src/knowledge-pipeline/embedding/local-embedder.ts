// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 10.6: Local Embedder (stub → OllamaEmbedder in V0.9.5)
 *
 * V0.9.0: stub only. For local/air-gap embedding use OllamaEmbedder (V0.9.5).
 * See src/knowledge-pipeline/embedding/ollama-embedder.ts.
 */

import type { Embedder, EmbedderOptions } from "../types.js";
import { SAFE_MAX_TOKENS } from "../types.js";

export class LocalEmbedder implements Embedder {
  readonly dimensions = 768; // nomic-embed-text target (OllamaEmbedder, V0.9.5)
  readonly maxTokens: number;

  constructor(maxTokensOverride?: number) {
    this.maxTokens = maxTokensOverride ?? SAFE_MAX_TOKENS;
  }

  async embed(_texts: string[], _options?: EmbedderOptions): Promise<Float32Array[]> {
    throw new Error(
      "Local embedding is available in V0.9.5 via OllamaEmbedder. " +
      "Install Ollama (https://ollama.com), pull nomic-embed-text, then configure: " +
      "`sidjua config embedding ollama-nomic`.",
    );
  }
}
