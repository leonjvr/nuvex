# SIDJUA Model Recommendations

## Decision Matrix

| Use Case                  | Recommended Model              | Provider      | Cost     |
|---------------------------|-------------------------------|---------------|----------|
| Complex reasoning          | claude-opus-4-6               | Anthropic     | High     |
| General development tasks  | claude-sonnet-4-6             | Anthropic     | Medium   |
| Fast, lightweight tasks    | claude-haiku-4-5-20251001     | Anthropic     | Low      |
| Cost-effective coding      | deepseek-chat                 | DeepSeek      | Very Low |
| Extended reasoning chains  | deepseek-reasoner             | DeepSeek      | Low      |
| Free tier / prototyping    | @cf/meta/llama-3.1-8b-instruct| Cloudflare AI | Free     |
| Large context (128k)       | moonshot-v1-128k              | Kimi          | Medium   |
| Real-time data access      | grok-3-latest                 | Grok          | High     |

## By Agent Tier

### Tier 1 (T1) — Orchestration / Planning
High-stakes decision making. Use most capable models.
- **Preferred**: `claude-opus-4-6` (Anthropic)
- **Alternative**: `grok-3-latest` (Grok)
- **Budget**: `gpt-4o` (OpenAI)

### Tier 2 (T2) — Development / Implementation
Complex multi-step coding and analysis.
- **Preferred**: `claude-sonnet-4-6` (Anthropic)
- **Alternative**: `gpt-4o-mini` (OpenAI)
- **Budget**: `deepseek-chat` (DeepSeek)

### Tier 3 (T3) — Execution / Simple Tasks
Fast, focused single-step operations.
- **Preferred**: `claude-haiku-4-5-20251001` (Anthropic)
- **Alternative**: `deepseek-chat` (DeepSeek)
- **Free**: `@cf/meta/llama-3.1-8b-instruct` (Cloudflare AI)

## Context Window Comparison

| Model                          | Context Window | Best For             |
|-------------------------------|----------------|----------------------|
| claude-opus-4-6               | 200k tokens    | Long documents       |
| claude-sonnet-4-6             | 200k tokens    | Long documents       |
| claude-haiku-4-5-20251001     | 200k tokens    | Fast responses       |
| gpt-4o                        | 128k tokens    | General tasks        |
| grok-3-latest                 | 131k tokens    | Real-time data       |
| moonshot-v1-128k              | 128k tokens    | Long documents       |
| deepseek-chat                 | 64k tokens     | Coding & reasoning   |
| llama-3.1-8b-instruct (local) | 8k tokens      | Simple tasks         |

## Pricing Reference (per million tokens)

| Model                 | Input    | Output   |
|-----------------------|----------|----------|
| claude-opus-4-6       | $15.00   | $75.00   |
| claude-sonnet-4-6     | $3.00    | $15.00   |
| claude-haiku-4-5      | $0.25    | $1.25    |
| gpt-4o                | $2.50    | $10.00   |
| gpt-4o-mini           | $0.15    | $0.60    |
| deepseek-chat         | $0.27    | $1.10    |
| deepseek-reasoner     | $0.55    | $2.19    |
| grok-3-latest         | $3.00    | $15.00   |
| moonshot-v1-128k      | $2.40    | $9.60    |
| Cloudflare AI         | Free (10k neurons/day) | |

*Prices approximate. Check provider websites for current rates.*

## Local Model Recommendations (Ollama / LM Studio)

| Model             | Size  | Use Case               | Context |
|-------------------|-------|------------------------|---------|
| llama3.2:3b       | 2GB   | Fast T3 tasks          | 128k    |
| llama3.2:8b       | 5GB   | Balanced T2/T3         | 128k    |
| qwen2.5-coder:7b  | 4.7GB | Code generation        | 128k    |
| mistral:7b        | 4.1GB | General purpose        | 32k     |
| deepseek-r1:8b    | 5GB   | Reasoning tasks        | 128k    |

## Recommendations for Different Budgets

### Zero Budget (Free)
1. Cloudflare Workers AI (10k neurons/day)
2. Ollama with llama3.2:3b (local)
3. LM Studio with any GGUF model (local)

### Low Budget (<$10/month)
1. DeepSeek Chat — excellent quality/cost ratio
2. GPT-4o Mini — fast and reliable
3. Claude Haiku — best Anthropic quality at low cost

### Standard Budget ($10-100/month)
1. Claude Sonnet — recommended default
2. GPT-4o — strong all-rounder
3. Mix: Sonnet for T1/T2, Haiku for T3

### High Budget ($100+/month)
1. Claude Opus for all T1 tasks
2. Claude Sonnet for T2
3. Claude Haiku for T3
