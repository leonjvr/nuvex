## 1. Local Model Provider

> Spec: `specs/local-model-provider/spec.md`
>
> Ollama/llama.cpp client with health checking and model lifecycle.
>
> **Priority: LOW** — Foundational module for local inference support.

- [ ] 1.1 Create `src/brain/providers/__init__.py` — exports `LocalProvider`, `ModelRouter`, `get_model`
- [ ] 1.2 Create `src/brain/providers/local.py` — `LocalProvider` class: `__init__(base_url)`, `is_healthy() -> bool`, `list_models() -> list[LocalModel]`, `pull_model(name) -> AsyncIterator[PullProgress]`, `delete_model(name) -> bool`, `get_chat_model(name) -> ChatOpenAI`
- [ ] 1.3 Implement cached health check — `_health_cache: tuple[bool, float]`; refresh if older than 30s; emit `provider.health_changed` on transition
- [ ] 1.4 Create `src/brain/providers/models.py` — Pydantic models: `LocalModel(name, size_bytes, quantisation, modified_at)`, `PullProgress(status, completed, total)`, `ResourceReport(total_disk_bytes, ollama_version, gpu_available, gpu_vram_bytes)`
- [ ] 1.5 Add `OLLAMA_BASE_URL` to `src/shared/config.py` — default `http://localhost:11434`; loaded from env or nuvex.yaml

## 2. Model Router

> Spec: `specs/routing-fallback/spec.md`
>
> Multi-provider routing with preference modes and tier gating.
>
> **Priority: LOW** — Depends on §1.

- [ ] 2.1 Create `src/brain/providers/router.py` — `ModelRouter` class: `get_model(agent_config, routing_context) -> BaseChatModel`
- [ ] 2.2 Implement `cloud` preference mode — return cloud model; fallback to local if cloud unhealthy and fallback=local
- [ ] 2.3 Implement `local` preference mode — return local model; fallback to cloud if local unhealthy and fallback=cloud
- [ ] 2.4 Implement `cost-optimal` mode — below `cost_optimal_threshold_tokens` → local; above → cloud
- [ ] 2.5 Implement tier gating — check `local_allowed_tiers` against invocation governance tier; block local if tier not allowed
- [ ] 2.6 Create `src/brain/providers/health.py` — `ProviderHealthAggregator`: maintains health status for all configured providers; 30s cache per provider
- [ ] 2.7 Emit `model.routed` event on every routing decision with agent_id, model, provider, was_fallback, reason
- [ ] 2.8 Raise `NoHealthyProviderError` when both primary and fallback are unhealthy

## 3. Config & Governance Integration

> Spec: `specs/routing-fallback/spec.md` (config section)
>
> Parse routing config from divisions.yaml and enforce governance.
>
> **Priority: LOW** — Depends on §2.

- [ ] 3.1 Add `RoutingConfig` Pydantic model to `src/shared/config.py` — fields: `prefer`, `fallback`, `local_allowed_tiers`, `cost_optimal_threshold_tokens`; all optional with defaults
- [ ] 3.2 Add `local_fallback: str | None = None` and `routing: RoutingConfig | None = None` to `AgentDefinition`
- [ ] 3.3 Update model resolution in brain startup — replace direct `ChatOpenAI()`/`ChatAnthropic()` construction with `ModelRouter.get_model()` call
- [ ] 3.4 Update `src/brain/governance/budget.py` — record local inference with `provider="local/ollama"`, cost from config or `0.0`

## 4. Model Management API

> Spec: `specs/model-management/spec.md`
>
> REST endpoints for model lifecycle.
>
> **Priority: LOW** — Depends on §1.

- [ ] 4.1 Create `src/brain/routers/models.py` — FastAPI router mounted at `/api/v1/models/local`
- [ ] 4.2 Implement `GET /api/v1/models/local` — list models from `LocalProvider.list_models()`
- [ ] 4.3 Implement `POST /api/v1/models/local/pull` — start async pull; return 202 with task_id; SSE endpoint for progress
- [ ] 4.4 Implement `DELETE /api/v1/models/local/{name}` — delete model; require operator role
- [ ] 4.5 Implement `GET /api/v1/models/local/resources` — disk/GPU report from `LocalProvider`
- [ ] 4.6 Implement `GET /api/v1/models/local/health` — return provider health status
- [ ] 4.7 Add auth guards — pull/delete require T1 or operator; list/health require any authenticated user

## 5. Startup & Docker

> **Priority: LOW** — Optional Ollama service for local dev.

- [ ] 5.1 Add model availability pre-check on brain startup — warn if configured `local_fallback` model is not present in Ollama
- [ ] 5.2 Add optional `ollama` service to `docker-compose.local.yml` — `ollama/ollama:latest`, port 11434, GPU passthrough if available, volume for model storage
- [ ] 5.3 Document Ollama setup in `docs/LOCAL-MODELS.md` — installation, GPU support, model pulling, troubleshooting

## 6. Testing

> **Priority: LOW** — Verify routing correctness and fallback behaviour.

- [ ] 6.1 Write unit test: `LocalProvider.is_healthy()` — mock Ollama reachable → True; unreachable → False; cache 30s TTL
- [ ] 6.2 Write unit test: `LocalProvider.list_models()` — mock Ollama response → correct `LocalModel` list
- [ ] 6.3 Write unit test: `LocalProvider.get_chat_model()` — returns `ChatOpenAI` with correct base_url and model name
- [ ] 6.4 Write unit test: `ModelRouter` cloud mode — healthy cloud → cloud model; unhealthy cloud + healthy local → local fallback
- [ ] 6.5 Write unit test: `ModelRouter` local mode — healthy local → local model; unhealthy local + healthy cloud → cloud fallback
- [ ] 6.6 Write unit test: `ModelRouter` cost-optimal — tokens < threshold → local; tokens >= threshold → cloud
- [ ] 6.7 Write unit test: tier gating — T2 invocation with `local_allowed_tiers: [T3, T4]` → cloud only
- [ ] 6.8 Write unit test: `NoHealthyProviderError` — both providers unhealthy → exception raised
- [ ] 6.9 Write unit test: budget tracking — local call → ledger entry with provider="local/ollama", cost=0.0
- [ ] 6.10 Write integration test: mock Ollama server → full routing flow with health checks and fallback
