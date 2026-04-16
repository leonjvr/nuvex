# Local Model Routing & Offline Inference — Proposal

## Why

NUVEX currently routes **all** LLM calls through cloud providers (OpenAI, Anthropic, Google). This creates:

1. **Single point of failure** — if all cloud providers are down or rate-limited, agents cannot function
2. **Cost scaling** — high-volume or low-criticality tasks (summarisation, classification) burn cloud tokens unnecessarily
3. **Privacy requirements** — some deployments need data to stay on-premises; cloud inference leaks conversation content
4. **Latency** — edge deployments with poor connectivity suffer from round-trip to cloud APIs

A classical OS supports multiple compute backends (local CPU, GPU, remote cluster). An AI OS should similarly route inference to the best available backend — cloud for capability, local for cost/privacy/resilience.

## What

Add a **local model provider** layer that:

- Integrates with **Ollama** (primary) and **llama.cpp server** (alternative) as local LLM backends
- Extends the existing model routing in `src/brain/` to treat local models as first-class providers alongside OpenAI/Anthropic/Google
- Applies governance to local model usage (T1–T4 tier gating, budget tracking)
- Falls back to local models when cloud providers are unavailable (and vice versa)
- Manages model lifecycle: pull, list, delete, health-check

## Capabilities Added

| Capability | Description |
|---|---|
| Local inference | Run LLM calls against Ollama/llama.cpp on the same host or LAN |
| Routing rules | Per-agent or per-task rules: "use local for T3+", "cloud-only for T1" |
| Fallback chain | Cloud → local (or local → cloud) with configurable priority |
| Model management | Pull/delete models, check availability, report VRAM usage |
| Budget tracking | Local inference tracked in budget_ledger at $0 (or custom cost) |
| Governance gating | divisions.yaml controls which agents may use local models |

## Impact

- **New module**: `src/brain/providers/local.py` — Ollama/llama.cpp client
- **New module**: `src/brain/providers/router.py` — multi-provider routing logic
- **Modified**: `src/shared/config.py` — new `providers` section in divisions.yaml
- **Modified**: `src/brain/governance/` — local-model tier validation
- **Modified**: `src/brain/models/` — budget ledger entries for local inference
- **No breaking changes** — local models are opt-in; default behaviour remains cloud-only
- **Docker**: optional `ollama` service in docker-compose.local.yml

## Priority

**LOW** — This is a resilience and cost optimisation feature. Not blocking any current workflow. Should be implemented after core platform, org isolation, and higher-priority AI OS gaps (sandboxing, browser control, scheduling) are complete.
