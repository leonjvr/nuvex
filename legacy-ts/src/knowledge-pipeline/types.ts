// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 10.6: Knowledge Pipeline — Types
 */

import type { Database } from "../utils/db.js";


export interface CollectionScope {
  divisions?: string[];
  agents?: string[];
  tiers?: number[];
  classification: string;   // PUBLIC | INTERNAL | CONFIDENTIAL | SECRET | FYEO
}


export type ChunkingStrategy = "semantic" | "fixed" | "paragraph" | "page";
export type CollectionStatus = "empty" | "indexing" | "indexed" | "needs_reindex" | "error";

export interface CollectionIngestionConfig {
  chunking_strategy: ChunkingStrategy;
  chunk_size_tokens: number;
  chunk_overlap_tokens: number;
  embedding_model: string;
  embedding_provider: string;
  language?: string;
  update_policy?: "manual" | "on_change" | "scheduled";
}

export interface CollectionRetrievalConfig {
  default_top_k: number;
  similarity_threshold: number;
  reranking: boolean;
  mmr_diversity: number;
}

export interface CollectionConfig {
  schema_version?: string;
  id: string;
  name: string;
  description?: string;
  scope: CollectionScope;
  ingestion: CollectionIngestionConfig;
  retrieval: CollectionRetrievalConfig;
}


export interface KnowledgeCollection {
  id: string;
  name: string;
  description: string;
  scope: CollectionScope;
  config: CollectionConfig;
  chunk_count: number;
  total_tokens: number;
  status: CollectionStatus;
  created_at: string;
  updated_at: string;
}

export interface CreateCollectionInput {
  id: string;
  name: string;
  description?: string;
  scope: CollectionScope;
  ingestion?: Partial<CollectionIngestionConfig>;
  retrieval?: Partial<CollectionRetrievalConfig>;
}


export interface ParsedSection {
  content: string;
  heading?: string;
  level?: number;           // heading level (1-6)
  page_number?: number;
  metadata?: Record<string, unknown>;
}

export interface ParsedDocument {
  sections: ParsedSection[];
  source_file: string;
  total_tokens: number;
  metadata?: Record<string, unknown>;
}


export interface Chunk {
  id: string;
  collection_id: string;
  source_file: string;
  content: string;
  token_count: number;
  position: number;
  section_path: string[];
  page_number?: number;
  preceding_context: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface ChunkWithEmbedding extends Chunk {
  embedding: Float32Array;
}


export interface ChunkOptions {
  collection_id: string;
  source_file: string;
  chunk_size_tokens?: number;
  chunk_overlap_tokens?: number;
}


export interface EmbeddingResult {
  chunk_id: string;
  embedding: Float32Array;
}

export interface EmbedderOptions {
  model?: string;
  batchSize?: number;
}

export interface EmbedProgress {
  total: number;
  completed: number;
  failed: number;
}


export interface RetrievalResult {
  chunk: Chunk;
  score: number;
}

export interface RetrievalOptions {
  top_k?: number;
  similarity_threshold?: number;
  collection_ids?: string[];
}

export interface AgentAccessContext {
  agent_id: string;
  division: string;
  tier: number;
  max_classification?: string;
}

export interface ScopeCheckResult {
  allowed: boolean;
  reason?: string;
}


export type KnowledgeAcquisitionStepType = "local_query" | "web_search" | "escalate";

export interface KnowledgeAcquisitionStep {
  step: number;
  type: KnowledgeAcquisitionStepType;
  query: string;
  result?: RetrievalResult[];
  success: boolean;
  blocked?: boolean;
  block_reason?: string;
}

export interface KnowledgeAcquisitionResult {
  agent_id: string;
  query: string;
  steps_attempted: KnowledgeAcquisitionStep[];
  final_results: RetrievalResult[];
  escalated: boolean;
}


export type PolicyRuleType = "forbidden" | "approval" | "escalation" | "budget" | "custom";
export type PolicyEnforcementLevel = "block" | "ask_first" | "warn" | "escalate" | "log";

export interface PolicyRuleDB {
  id: number;
  source_file: string;
  rule_type: PolicyRuleType;
  action_pattern?: string;
  condition?: string;
  enforcement: PolicyEnforcementLevel;
  escalate_to?: string;
  reason?: string;
  active: boolean;
  created_at: string;
}

export interface PolicyRuleInput {
  source_file: string;
  rule_type: PolicyRuleType;
  action_pattern?: string;
  condition?: string;
  enforcement: PolicyEnforcementLevel;
  escalate_to?: string;
  reason?: string;
}


export interface Parser {
  parse(content: Buffer | string, filename: string): Promise<ParsedDocument>;
}


export interface Chunker {
  chunk(doc: ParsedDocument, options: ChunkOptions): Chunk[];
}


/** Safe fallback token limit for new or unknown embedders. */
export const SAFE_MAX_TOKENS = 512;

export interface Embedder {
  readonly dimensions: number;
  /** Maximum number of tokens per text that this embedder accepts. */
  readonly maxTokens: number;
  embed(texts: string[], options?: EmbedderOptions): Promise<Float32Array[]>;
}


/** Approximate BPE token count from text.
 *
 * Uses the maximum of two heuristics so that both plain English text and
 * dense code / JSON / base64 content (which can reach 1 token per character)
 * are estimated conservatively enough to avoid exceeding embedder limits:
 *
 *  - word-based  : words × 1.33  (good for natural-language prose)
 *  - char-based  : chars ÷ 3     (floor for code/JSON/base64; ~3 chars/token conservative average)
 *
 * Taking the max prevents chunks with few words but many characters (e.g. a
 * base64 blob counted as one "word") from slipping past the token-limit check.
 */
export function countTokens(text: string): number {
  if (text.length === 0) return 0;
  const wordBased = Math.ceil(text.trim().split(/\s+/).length * 1.33);
  const charBased = Math.ceil(text.length / 3);
  return Math.max(wordBased, charBased);
}
