// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 10.6: Knowledge Pipeline — barrel exports
 */

// Types
export * from "./types.js";

// Migration
export { runKnowledgeMigrations, KNOWLEDGE_MIGRATIONS } from "./migration.js";

// Collection management
export { CollectionManager } from "./collection-manager.js";

// Parsers
export { MarkdownParser } from "./parsers/markdown-parser.js";
export { PdfParser }      from "./parsers/pdf-parser.js";
export { DocxParser }     from "./parsers/docx-parser.js";
export { HtmlParser }     from "./parsers/html-parser.js";
export { CsvParser }      from "./parsers/csv-parser.js";
export { CodeParser }     from "./parsers/code-parser.js";

// Chunkers
export { SemanticChunker }  from "./chunkers/semantic-chunker.js";
export { FixedChunker }     from "./chunkers/fixed-chunker.js";
export { ParagraphChunker } from "./chunkers/paragraph-chunker.js";

// Embedding
export { EmbeddingPipeline } from "./embedding/embedding-pipeline.js";
export { OpenAIEmbedder }    from "./embedding/openai-embedder.js";
export { LocalEmbedder }     from "./embedding/local-embedder.js";

// Retrieval
export { HybridRetriever }                            from "./retrieval/hybrid-retriever.js";
export { Reranker }                                   from "./retrieval/reranker.js";
export { MMRDiversifier as MmrDiversifier }           from "./retrieval/mmr-diversifier.js";
export { ScopeChecker }                               from "./retrieval/scope-checker.js";
export { KnowledgeAction }                            from "./retrieval/knowledge-action.js";
export { KnowledgeAcquisitionManager as KnowledgeAcquisition } from "./retrieval/knowledge-acquisition.js";

// Policy
export { PolicyParser }    from "./policy/policy-parser.js";
export { PolicyValidator } from "./policy/policy-validator.js";
export { PolicyTester }    from "./policy/policy-tester.js";
export { PolicyDeployer }  from "./policy/policy-deployer.js";

// Auto-collector
export { AutoCollector } from "./auto-collector.js";

// CLI
export { registerKnowledgeCommands } from "./cli-knowledge.js";
export { registerPolicyCommands }    from "./cli-policy.js";
