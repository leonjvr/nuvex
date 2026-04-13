# Local Model Routing & Offline Inference — Design

## Context

NUVEX uses LangChain/LangGraph model abstractions (`ChatOpenAI`, `ChatAnthropic`, `ChatGoogleGenerativeAI`) configured per-agent in `divisions.yaml`. The current flow:

1. Agent config specifies `model: "gpt-4o"` or `model: "claude-sonnet-4-20250514"`
2. `src/shared/config.py` resolves model string to a LangChain chat model class
3. The graph passes the model to LLM-calling nodes
4. All calls go to external cloud APIs

This design adds a routing layer between config resolution and LLM call execution.

## Goals

1. Treat local models (Ollama, llama.cpp) as first-class LangChain chat models
2. Route based on configurable rules: agent tier, task priority, model capability, provider health
3. Fall back gracefully when primary provider is unavailable
4. Track all inference (cloud and local) in the budget ledger
5. Allow model management (pull, list, delete) via API and CLI

## Key Decisions

### D1: Ollama as Primary Local Backend

**Decision**: Use Ollama's OpenAI-compatible API as the primary integration point.

**Rationale**: Ollama exposes `/v1/chat/completions` — LangChain's `ChatOpenAI` works with Ollama by setting `base_url`. This means zero custom client code for inference. Ollama also handles model download, VRAM management, and quantisation.

**Consequence**: llama.cpp server support is also covered (same OpenAI-compatible API).

### D2: Router as Middleware, Not Graph Node

**Decision**: The router sits between config resolution and model instantiation — it is NOT a separate LangGraph node.

**Rationale**: Adding a router node would change the graph topology for all agents. Instead, the router is a model factory: `get_model(agent_config, routing_context) -> BaseChatModel`. Existing nodes call the model as before.

**Consequence**: Zero changes to graph.py. Routing is transparent to nodes.

### D3: Routing Rules in divisions.yaml

**Decision**: Routing rules are per-agent config, not global.

```yaml
agents:
  researcher:
    model: "claude-sonnet-4-20250514"
    local_fallback: "llama3.1:8b"
    routing:
      prefer: cloud           # cloud | local | cost-optimal
      fallback: local         # cloud | local | none
      local_allowed_tiers: [T3, T4]  # only route low-sensitivity to local
```

**Rationale**: Different agents have different privacy/capability needs. A researcher may use local for drafts but cloud for final output.

### D4: Budget Tracking for Local Inference

**Decision**: Local inference creates budget_ledger entries with `cost_usd = 0.0` (or configurable per-model cost) and `provider = "local/ollama"`.

**Rationale**: Governance needs to see all inference, even free local calls, for audit and fair-share scheduling.

### D5: Health-Based Fallback

**Decision**: Router pings provider health before routing. If primary is unhealthy, use fallback. Health check is cached for 30 seconds.

## Module Breakdown

| Module | Responsibility |
|---|---|
| `src/brain/providers/__init__.py` | Exports `get_model`, `ModelRouter`, `LocalProvider` |
| `src/brain/providers/local.py` | Ollama/llama.cpp health check, model listing, pull/delete |
| `src/brain/providers/router.py` | `ModelRouter`: resolve agent config → `BaseChatModel` with routing + fallback |
| `src/brain/providers/health.py` | Cached health check for cloud and local providers |
| `src/shared/config.py` (modified) | Parse new `routing` section of agent config |
| `src/brain/governance/budget.py` (modified) | Record local inference in budget ledger |

## Testing Strategy

- **Unit tests**: Router logic (prefer cloud, fallback to local, tier gating)
- **Unit tests**: Health check caching (healthy, unhealthy, stale cache)
- **Unit tests**: Config parsing for routing rules
- **Integration test**: Ollama mock server; route call, verify correct base_url used
- **Integration test**: Cloud mock down → verify fallback to local model
- **No Docker required** for unit tests (mock Ollama HTTP responses)
