// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 10.6: Reranker
 * V1: Score-based reranking with threshold filtering.
 * No cross-encoder model — uses RRF scores directly.
 */

import type { RetrievalResult } from "../types.js";

export interface RerankOptions {
  threshold?: number;
  top_k?: number;
}

export class Reranker {
  rerank(results: RetrievalResult[], options: RerankOptions = {}): RetrievalResult[] {
    const threshold = options.threshold ?? 0.0;
    const topK = options.top_k ?? results.length;

    return results
      .filter((r) => r.score >= threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }
}
