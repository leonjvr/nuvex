// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 10.6: HybridRetriever
 * Vector (cosine top-20) + BM25/FTS5 (top-20) → RRF merge.
 */

import type { Database } from "../../utils/db.js";
import type { Embedder, RetrievalResult, RetrievalOptions, Chunk } from "../types.js";
import { logger as defaultLogger, type Logger } from "../../utils/logger.js";
import { createLogger } from "../../core/logger.js";

const _logger = createLogger("hybrid-retriever");

const RRF_K = 60;
const VECTOR_TOP_K = 20;
const BM25_TOP_K = 20;

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

function bufferToFloat32Array(buf: Buffer): Float32Array {
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

interface ChunkRow {
  id: string;
  collection_id: string;
  source_file: string;
  content: string;
  token_count: number;
  position: number;
  section_path: string;
  page_number: number | null;
  preceding_context: string;
  metadata: string;
  created_at: string;
}

interface VectorRow extends ChunkRow {
  chunk_id: string;
  embedding: Buffer;
}

interface Bm25Row extends ChunkRow {
  score: number;
}

export class HybridRetriever {
  constructor(
    private readonly db: Database,
    private readonly embedder: Embedder,
    private readonly logger: Logger = defaultLogger,
  ) {}

  async retrieve(query: string, options: RetrievalOptions = {}): Promise<RetrievalResult[]> {
    const topK = options.top_k ?? 5;
    const threshold = options.similarity_threshold ?? 0.0;
    const collectionIds = options.collection_ids;

    // 1. Embed query (falls back to BM25-only if embedder unavailable)
    let vectorResults: RetrievalResult[] = [];
    try {
      const [queryEmbedding] = await this.embedder.embed([query]);
      if (queryEmbedding !== undefined) {
        // 2. Vector search — apply similarity threshold here (cosine scores are 0..1)
        vectorResults = this._vectorSearch(queryEmbedding, collectionIds, VECTOR_TOP_K)
          .filter((r) => r.score >= threshold);
      }
    } catch (err) {
      this.logger.warn(
        "SYSTEM",
        `Vector search unavailable (${err instanceof Error ? err.message : String(err)}); falling back to BM25-only search.`,
      );
    }

    // 3. BM25 / FTS5 search
    const bm25Results = this._bm25Search(query, collectionIds, BM25_TOP_K);

    // 4. RRF merge
    const merged = this._rrfMerge(vectorResults, bm25Results);

    // 5. Return top-k (RRF scores are ~0.01–0.03 — do NOT apply cosine threshold here)
    return merged.slice(0, topK);
  }

  private _vectorSearch(
    queryVec: Float32Array,
    collectionIds: string[] | undefined,
    topK: number,
  ): RetrievalResult[] {
    let sql = `
      SELECT kv.chunk_id, kv.embedding, kc.id, kc.collection_id, kc.source_file,
             kc.content, kc.token_count, kc.position, kc.section_path,
             kc.page_number, kc.preceding_context, kc.metadata, kc.created_at
      FROM knowledge_vectors kv
      JOIN knowledge_chunks kc ON kv.chunk_id = kc.id
    `;
    const params: string[] = [];
    if (collectionIds !== undefined && collectionIds.length > 0) {
      sql += ` WHERE kv.collection_id IN (${collectionIds.map(() => "?").join(",")})`;
      params.push(...collectionIds);
    }

    const rows = this.db.prepare<string[], VectorRow>(sql).all(...params);

    // Compute cosine similarity and sort
    const scored = rows.map((row) => {
      const vec = bufferToFloat32Array(row.embedding);
      const score = cosineSimilarity(queryVec, vec);
      return { row, score };
    });

    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, topK).map(({ row, score }) => ({
      chunk: this._rowToChunk(row),
      score,
    }));
  }

  private _bm25Search(
    query: string,
    collectionIds: string[] | undefined,
    topK: number,
  ): RetrievalResult[] {
    let sql = `
      SELECT kc.id, kc.collection_id, kc.source_file, kc.content,
             kc.token_count, kc.position, kc.section_path,
             kc.page_number, kc.preceding_context, kc.metadata, kc.created_at,
             bm25(knowledge_chunks_fts) AS score
      FROM knowledge_chunks_fts
      JOIN knowledge_chunks kc ON knowledge_chunks_fts.rowid = kc.rowid
      WHERE knowledge_chunks_fts MATCH ?
    `;
    const params: (string | number)[] = [this._sanitizeFtsQuery(query)];

    if (collectionIds !== undefined && collectionIds.length > 0) {
      sql += ` AND kc.collection_id IN (${collectionIds.map(() => "?").join(",")})`;
      params.push(...collectionIds);
    }
    sql += ` ORDER BY score LIMIT ?`;
    params.push(topK);

    try {
      const rows = this.db.prepare<(string | number)[], Bm25Row>(sql).all(...params);

      // BM25 scores from FTS5 are negative (lower = better match); normalize to [0,1]
      const minScore = rows.length > 0 ? Math.min(...rows.map((r) => r.score)) : 0;
      const range = minScore < 0 ? Math.abs(minScore) : 1;

      return rows.map((row) => ({
        chunk: this._rowToChunk(row),
        score: range > 0 ? (row.score - minScore) / range : 0.5,
      }));
    } catch (e: unknown) {
      _logger.debug("hybrid-retriever", "FTS search failed — falling back to vector-only results", { metadata: { error: e instanceof Error ? e.message : String(e) } });
      return [];
    }
  }

  private _rrfMerge(
    vectorResults: RetrievalResult[],
    bm25Results: RetrievalResult[],
  ): RetrievalResult[] {
    const scores = new Map<string, { chunk: Chunk; rrfScore: number }>();

    const addRanked = (results: RetrievalResult[]) => {
      results.forEach((r, rank) => {
        const existing = scores.get(r.chunk.id);
        const rrfContrib = 1 / (RRF_K + rank + 1);
        if (existing !== undefined) {
          existing.rrfScore += rrfContrib;
        } else {
          scores.set(r.chunk.id, { chunk: r.chunk, rrfScore: rrfContrib });
        }
      });
    };

    addRanked(vectorResults);
    addRanked(bm25Results);

    return Array.from(scores.values())
      .sort((a, b) => b.rrfScore - a.rrfScore)
      .map(({ chunk, rrfScore }) => ({ chunk, score: rrfScore }));
  }

  private _sanitizeFtsQuery(query: string): string {
    // Escape special FTS5 characters
    return query
      .replace(/['"*()^]/g, " ")
      .trim()
      .split(/\s+/)
      .join(" AND ");
  }

  private _rowToChunk(row: ChunkRow): Chunk {
    const chunk: Chunk = {
      id: row.id,
      collection_id: row.collection_id,
      source_file: row.source_file,
      content: row.content,
      token_count: row.token_count,
      position: row.position,
      section_path: JSON.parse(row.section_path) as string[],
      preceding_context: row.preceding_context,
      metadata: JSON.parse(row.metadata) as Record<string, unknown>,
      created_at: row.created_at,
    };
    if (row.page_number !== null) {
      chunk.page_number = row.page_number;
    }
    return chunk;
  }
}
