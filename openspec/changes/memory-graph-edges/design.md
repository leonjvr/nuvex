# Design: Memory Graph Edges + Wiki Layer

## Three-Layer Architecture

```
┌───────────────────────────────────────────────────────────┐
│  Layer 3 — Wiki (T1 only, opt-in)                         │
│  data/agents/<id>/workspace/wiki/  (markdown files)       │
│  Ingested as high-confidence manually-curated memories     │
└──────────────────────────┬────────────────────────────────┘
                           │ ingest → memories table
┌──────────────────────────▼────────────────────────────────┐
│  Layer 2 — memory_edges (PostgreSQL)                      │
│  Typed, confidence-weighted directed edges                 │
│  between existing memories rows                           │
└──────────────────────────┬────────────────────────────────┘
                           │ traversal augments ANN results
┌──────────────────────────▼────────────────────────────────┐
│  Layer 1 — memories (existing pgvector store)             │
│  ANN cosine search, promoter, forgetter                   │
└───────────────────────────────────────────────────────────┘
```

---

## memory_edges Table Schema

```sql
CREATE TYPE edge_type AS ENUM (
    'supports',
    'contradicts',
    'evolved_into',
    'depends_on',
    'related_to'
);

CREATE TABLE memory_edges (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id   UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
    target_id   UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
    edge_type   edge_type NOT NULL,
    confidence  FLOAT NOT NULL DEFAULT 1.0
                    CHECK (confidence >= 0.0 AND confidence <= 1.0),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    traversed_at TIMESTAMPTZ,
    CONSTRAINT no_self_loop CHECK (source_id != target_id),
    CONSTRAINT unique_directed_edge UNIQUE (source_id, target_id, edge_type)
);

CREATE INDEX idx_edges_source ON memory_edges (source_id);
CREATE INDEX idx_edges_target ON memory_edges (target_id);
CREATE INDEX idx_edges_type   ON memory_edges (edge_type);
CREATE INDEX idx_edges_confidence ON memory_edges (confidence);
```

### Edge Types

| Type | Meaning |
|---|---|
| `supports` | source fact reinforces or corroborates target fact |
| `contradicts` | source fact is in tension with or negates target fact |
| `evolved_into` | source fact was superseded or refined by target fact |
| `depends_on` | source fact is only valid if target fact holds |
| `related_to` | weak association; same topic but no strong semantic direction |

---

## Consolidator Edge Extraction

After extracting new facts at thread close (existing behaviour), the consolidator makes a **second LLM pass** (edge extraction pass) that:

1. Receives: the list of newly extracted facts + the top-20 recently retrieved memories for the agent.
2. Produces: a JSON list of `{source_content, target_content, edge_type, confidence}` tuples.
3. The consolidator resolves `source_content` / `target_content` to `memories.id` by exact text match or ANN lookup (threshold 0.92).
4. Inserts matched pairs into `memory_edges`. If a row with the same `(source_id, target_id, edge_type)` already exists, update `confidence = max(existing, new)`.

**Prompt guard**: the edge extraction prompt explicitly instructs the model to produce edges only when confidence ≥ 0.6 and to prefer `related_to` when the relationship is ambiguous.

---

## Edge-Aware Retrieval

```
retriever.retrieve(agent_id, query, k=12)
  → ANN top-k memories                  (existing)
  → for each returned memory:
      graph_expand(memory_id, hops=2, min_confidence=0.5)
        → BFS over memory_edges (source or target)
        → collect up to 8 additional memories per hop
  → merge ANN results + graph-expanded results
  → deduplicate by memory.id
  → re-rank: ANN score * 1.0, hop-1 neighbours * 0.8, hop-2 * 0.6
  → return top-20, annotate each with edge_path and edge_types traversed
```

Edge traversal is bounded: max 2 hops, max 16 expanded nodes total, to prevent runaway queries on densely connected subgraphs.

Update `memory_edges.traversed_at` for each edge used during retrieval.

---

## Edge Lint Job (Hallucination Mitigation)

The lint job runs as a **scheduled cron task** (default: weekly). It performs three passes:

### Pass 1 — Contradiction Audit

```
SELECT e.*
FROM memory_edges e
JOIN memories src ON e.source_id = src.id
JOIN memories tgt ON e.target_id = tgt.id
WHERE e.edge_type = 'contradicts'
  AND src.confidence >= 0.7
  AND tgt.confidence >= 0.7
  AND e.confidence >= 0.7
```

For each row returned: emit a `memory.edge_conflict` event to the event bus with the source/target text. The event is surfaced to the operator dashboard as a review item. No automatic resolution — a human or a governance-gated agent must decide which fact to demote.

### Pass 2 — Orphan Edge Decay

```
UPDATE memory_edges
SET confidence = confidence - 0.05
WHERE (traversed_at IS NULL OR traversed_at < now() - interval '30 days')
  AND edge_type != 'contradicts'
```

Edges that are never used decay toward deletion. This is the edge-level equivalent of `forgetter.py`'s memory decay.

### Pass 3 — Pruning

```
DELETE FROM memory_edges WHERE confidence < 0.3
```

Edges with confidence below 0.3 are hard-deleted. This prevents the graph from accumulating low-signal noise from early, uncertain consolidation passes.

---

## Wiki Layer (T1-Only)

### Directory Structure

```
data/agents/<agent_id>/workspace/
└── wiki/
    ├── index.md        # Table of contents, maintained by the agent
    └── log.md          # Append-only ingestion log
```

### Bootstrap

When a T1 agent's workspace is first created, the bootstrapper creates the `wiki/` directory with starter templates for `index.md` and `log.md`. The templates contain instructions for the agent on how to use the wiki.

### Ingest Flow

`wiki/` files are not monitored in real-time. Ingestion is a **skill script** (`skills/wiki_ingest.py`) that:

1. Lists markdown files under `wiki/` (excluding `log.md`).
2. Chunks each file into paragraphs.
3. Embeds each paragraph and upserts into `memories` with `tier = 'personal'`, `confidence = 1.0`, `source = 'wiki'`.
4. Records the ingest in `log.md` with timestamp and paragraph count.

T2+ agents cannot invoke this skill (governance blocks it). Wiki memories carry `source = 'wiki'` and are never decayed by `forgetter.py`.

---

## Hallucination Risk Mitigation Summary

| Risk | Mitigation |
|---|---|
| Consolidator extracts a false edge | Edge confidence starts low (LLM output), decays if never traversed, pruned at 0.3 |
| Contradictory facts both reach the LLM | Contradiction audit emits event; operator resolves; edge confidence surfaced in retrieval metadata |
| High-confidence false edge taints retrieval | Lint pass 1 catches both-high-confidence contradictions and flags for human review |
| Wiki ingest introduces false premises | Wiki memories are `source = 'wiki'` and attributed to a human action; they are never auto-decayed, making the operator responsible |
| Edge extraction prompt hallucinates relationship | Prompt requires ≥ 0.6 confidence threshold and biases toward `related_to` for ambiguous cases |
