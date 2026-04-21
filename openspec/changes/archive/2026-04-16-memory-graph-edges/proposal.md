# Proposal: Memory Graph Edges + Wiki Layer

## Problem

Analysis of NUVEX's current memory subsystem reveals structural limitations that become more pronounced as agents accumulate facts over time.

1. **Flat memory bag — no relationships**: `memories` rows are independent facts stored in a flat table. An agent can know "Alice is trusted" and "Alice was deceptive last week" simultaneously with no machine-readable link between them. There is no way to query "what memories contradict this fact?" without a full scan.

2. **Contradictions silently coexist**: When new facts are extracted at thread close, the consolidator does not check whether a new fact contradicts an existing one. Both persist. The agent will receive contradictory context in the same retrieval block, which increases hallucination risk in its next response.

3. **No causal or temporal chains**: Facts like "A depends on B" or "C evolved from D" cannot be expressed. The agent is forced to re-derive relationships from raw text every invocation, which wastes tokens and produces inconsistent results.

4. **Retrieved memories have no provenance graph**: The retriever returns a ranked list of facts but cannot tell the agent which facts reinforce each other vs. conflict. Without this, the LLM must resolve conflicts itself — unreliably.

5. **Hallucination propagation**: A hallucinated fact extracted by the consolidator can acquire high confidence over time simply by never being challenged. Once it is linked (implicitly) to real facts, the entire chain becomes tainted. There is no mechanism to detect or decay suspicious edges.

6. **T1 agents have no workspace document store**: High-trust agents like Maya benefit from a persistent, human-readable knowledge base that complements the vector store. The current system offers no equivalent to a wiki or reference document layer. Agents must re-derive complex background context from raw chat history.

## Recommendation

Extend the PostgreSQL memory schema with a `memory_edges` table that encodes typed, confidence-weighted directed relationships between existing `memories` rows. Augment the consolidator to extract edges during thread close, augment the retriever to traverse those edges, and add a lint/audit cron job to detect contradictions and decay orphaned edges — mitigating hallucination propagation.

In parallel, add an opt-in wiki layer for T1 agents: a filesystem workspace directory (`wiki/`) with human-editable markdown files that are ingested as high-confidence, manually curated memories.

**No new infrastructure is required.** PostgreSQL already carries everything needed; no graph database is necessary.
