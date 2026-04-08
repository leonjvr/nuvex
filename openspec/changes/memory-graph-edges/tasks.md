# Tasks — memory-graph-edges

## 36. memory_edges Table

> Foundation layer. Adds the `memory_edges` PostgreSQL table, `EdgeType` enum,
> SQLAlchemy ORM model, and Alembic migration. All subsequent sections depend on this.
> Requires: nothing (pure schema addition). Tests: `unit-tests/memory-edges/test_memory_edge_model.py`.

- [ ] 36.1 Create `EdgeType` Python enum in `src/brain/models/memory_edge.py` with values: `supports`, `contradicts`, `evolved_into`, `depends_on`, `related_to`
- [ ] 36.2 Create `MemoryEdge` SQLAlchemy model with all required columns, constraints, and indexes
- [ ] 36.3 Export `MemoryEdge` from `src/brain/models/__init__.py`
- [ ] 36.4 Write Alembic migration `add_memory_edges` (creates enum + table; reversible)
- [ ] 36.5 Write unit tests covering model instantiation, enum values, defaults, and `__tablename__`

## 37. Consolidator Edge Extraction

> Second LLM pass in the consolidator that extracts typed relationships between facts
> and writes them to `memory_edges`. Runs after the primary fact extraction pass.
> Requires: §36 complete. Tests: `unit-tests/memory-edges/test_edge_extraction.py`.

- [ ] 37.1 Add edge extraction prompt to `src/brain/memory/consolidator.py` (conditional on ≥ 2 facts)
- [ ] 37.2 Implement content-to-ID resolution (exact match → ANN fallback at 0.92 threshold)
- [ ] 37.3 Implement upsert with `GREATEST(excluded.confidence, existing.confidence)` semantics
- [ ] 37.4 Wrap edge extraction pass in try/except; failure must not affect primary fact result
- [ ] 37.5 Write unit tests covering skip condition, resolution, upsert logic, and failure isolation

## 38. Edge-Aware Retrieval

> Extends the retriever with BFS graph traversal (max 2 hops) after ANN search.
> Merges, re-ranks, and annotates results. Updates `traversed_at` on used edges.
> Requires: §36 complete. Tests: `unit-tests/memory-edges/test_edge_retrieval.py`.

- [ ] 38.1 Add `use_graph: bool = True` parameter to `retrieve()` in `src/brain/memory/retriever.py`
- [ ] 38.2 Implement BFS expansion (max 2 hops, max 8 neighbours/seed/hop, max 16 total expanded)
- [ ] 38.3 Implement merge + re-rank (ANN * 1.0, hop-1 * 0.8, hop-2 * 0.6), cap at 20 results
- [ ] 38.4 Annotate each result with `retrieval_source`, `edge_path`, `weighted_score`
- [ ] 38.5 Bulk-update `traversed_at` for edges actually traversed
- [ ] 38.6 Write unit tests covering all acceptance criteria (8 tests minimum)

## 39. Edge Lint Job (Hallucination Mitigation)

> Weekly cron job with three passes: contradiction audit (emit events), orphan decay,
> and confidence-based pruning. Dry-run mode. Structured metrics logging.
> Requires: §36, cron registry (§22). Tests: `unit-tests/memory-edges/test_edge_lint.py`.

- [ ] 39.1 Create `src/brain/memory/edge_lint.py` with `EdgeLintJob` class and three passes
- [ ] 39.2 Pass 1: query high-confidence contradictions and emit `memory.edge_conflict` events
- [ ] 39.3 Pass 2: decay orphan edge confidence by 0.05 (skips `contradicts` type)
- [ ] 39.4 Pass 3: hard-delete edges with `confidence < 0.3`
- [ ] 39.5 Add `dry_run` mode (compute only, no mutations)
- [ ] 39.6 Register job in cron registry with default schedule `0 3 * * 1`; allow override via `divisions.yaml`
- [ ] 39.7 Write unit tests covering all seven acceptance criteria

## 40. Wiki Layer (T1 Agents)

> Opt-in knowledge base for T1 agents. Bootstrap creates wiki/ in workspace.
> `wiki_ingest.py` skill chunks and embeds markdown docs. Forgetter exemption.
> Requires: §36, workspace bootstrap. Tests: `unit-tests/memory-edges/test_wiki_layer.py`.

- [ ] 40.1 Edit workspace bootstrapper to create `wiki/index.md` and `wiki/log.md` for T1 agents only
- [ ] 40.2 Create `src/brain/skills/wiki_ingest.py` with paragraph chunking, embedding, and upsert
- [ ] 40.3 Add `source = 'wiki'` and `confidence = 1.0` tagging; append to `log.md`
- [ ] 40.4 Add governance gate: raise `GovernanceError` for non-T1 agents
- [ ] 40.5 Edit `src/brain/memory/forgetter.py` to skip memories where `source = 'wiki'`
- [ ] 40.6 Write unit tests covering all eight acceptance criteria
