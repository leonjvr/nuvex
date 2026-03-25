// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 10.6: MMR Diversifier
 * Maximal Marginal Relevance — balances relevance and diversity.
 * MMR_score = lambda * relevance - (1-lambda) * max_similarity_to_selected
 */

import type { RetrievalResult, Chunk } from "../types.js";

export interface MMROptions {
  /** 0 = max diversity, 1 = max relevance. Default: 0.7 */
  lambda?: number;
  top_k?: number;
}

function overlapSimilarity(a: Chunk, b: Chunk): number {
  // Simple Jaccard-like overlap on tokens (no embeddings needed for dedup)
  const tokensA = new Set(a.content.toLowerCase().split(/\s+/));
  const tokensB = new Set(b.content.toLowerCase().split(/\s+/));
  let intersection = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) intersection++;
  }
  const union = tokensA.size + tokensB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export class MMRDiversifier {
  diversify(candidates: RetrievalResult[], options: MMROptions = {}): RetrievalResult[] {
    const lambda = options.lambda ?? 0.7;
    const topK = options.top_k ?? candidates.length;

    if (candidates.length === 0) return [];
    if (topK <= 0) return [];

    const selected: RetrievalResult[] = [];
    const remaining = [...candidates];

    while (selected.length < topK && remaining.length > 0) {
      let bestIdx = 0;
      let bestScore = -Infinity;

      for (let i = 0; i < remaining.length; i++) {
        const candidate = remaining[i]!;
        const relevance = candidate.score;

        // Max similarity to already-selected items
        const maxSim =
          selected.length > 0
            ? Math.max(...selected.map((s) => overlapSimilarity(candidate.chunk, s.chunk)))
            : 0;

        const mmrScore = lambda * relevance - (1 - lambda) * maxSim;
        if (mmrScore > bestScore) {
          bestScore = mmrScore;
          bestIdx = i;
        }
      }

      const best = remaining.splice(bestIdx, 1)[0]!;
      selected.push({ ...best, score: bestScore });
    }

    return selected;
  }
}
