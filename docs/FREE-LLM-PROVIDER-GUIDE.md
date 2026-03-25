# Free LLM Provider Guide

How to run SIDJUA without spending anything on AI model costs.

SIDJUA supports 12 cloud providers and 8 local options out of the box. Several of these have free tiers that are more than sufficient for personal use, small teams, and evaluation. This guide covers the best free options, step-by-step setup, and how to configure automatic failover so your agents keep running even when one provider hits a rate limit.

---

## The Recommended Free Setup: Cloudflare Workers AI

**Cloudflare Workers AI** is the only provider in SIDJUA's catalog with a `free` pricing tier — it costs $0 per token and requires no credit card. It is the natural first choice for zero-cost deployments.

The free allowance is based on a daily neuron (compute unit) budget rather than tokens. For typical SIDJUA workloads — task delegation, document summarization, code review — you will not hit the daily limit under normal use. Cloudflare publishes the exact daily neuron budget in their Workers AI documentation.

The catalog includes three Cloudflare Workers AI models:

| Model | Context | Tool Use | Recommended Tier |
|-------|---------|----------|-----------------|
| `@cf/meta/llama-4-scout-17b-16e-instruct` | 128k | Yes | T1 |
| `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | 131k | Yes | T2 |
| `@cf/zai-org/glm-4.7-flash` | 32k | Yes | T3 |

---

## Cloudflare Workers AI Setup

### Prerequisites

- A free Cloudflare account at [cloudflare.com](https://cloudflare.com)
- No credit card required for the free tier

### Step 1: Get your Account ID

1. Log in to [dash.cloudflare.com](https://dash.cloudflare.com)
2. In the right sidebar, find your **Account ID** (a 32-character hex string)
3. Copy it

### Step 2: Create an API Token

1. Go to **My Profile → API Tokens**
2. Click **Create Token**
3. Use the template **"Workers AI"** (read access is enough)
4. Set token expiry if required by your security policy
5. Click **Create Token** and copy the token

### Step 3: Configure SIDJUA

```bash
export CLOUDFLARE_ACCOUNT_ID=your-account-id-here
export CLOUDFLARE_API_TOKEN=your-token-here

# Register the key reference (stores the env var name, not the key itself)
sidjua key add cloudflare-key \
  --provider cloudflare-ai \
  --source env:CLOUDFLARE_API_TOKEN

# For Docker: add to .env file
echo "CLOUDFLARE_ACCOUNT_ID=your-account-id-here" >> .env
echo "CLOUDFLARE_API_TOKEN=your-token-here" >> .env
docker compose up -d sidjua
```

### Step 4: Create an Agent Using Cloudflare

```bash
sidjua agent create my-worker \
  --name "My Worker" \
  --provider cloudflare-ai \
  --model "@cf/meta/llama-3.3-70b-instruct-fp8-fast" \
  --division engineering \
  --tier 3 \
  --budget-per-task 0.00 \
  --budget-monthly 0.00
```

Or in YAML (`agents/definitions/my-worker.yaml`):

```yaml
schema_version: "1.0"
id: my-worker
name: My Worker
tier: 3
division: engineering
provider: cloudflare-ai
model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast"
skill: agents/skills/my-worker.md
capabilities: [text-generation, summarization]
budget:
  per_task_usd: 0.00
  per_hour_usd: 0.00
  per_month_usd: 0.00
```

---

## Second Option: Groq

**Groq** offers a free plan (no credit card required) at [console.groq.com](https://console.groq.com). The free plan has rate limits but no token cost. Once you exceed the free limits, usage is billed at very low rates ($0.05–$0.59 per million tokens depending on the model).

The catalog includes two Groq models:

| Model | Context | Tool Use | Recommended Tier | Pricing |
|-------|---------|----------|-----------------|---------|
| `llama-3.3-70b-versatile` | 128k | Yes | T2 | $0.59/$0.79 per 1M |
| `llama-3.1-8b-instant` | 128k | Yes | T3 | $0.05/$0.08 per 1M |

### Free Tier Rate Limits (approximate, check Groq's docs for current values)

- 30 requests per minute
- 6,000 tokens per minute
- 500 requests per day (free plan)

For a personal SIDJUA deployment running a few agents on non-time-critical tasks, the free tier is usually sufficient.

### Step 1: Create a Groq Account

1. Go to [console.groq.com](https://console.groq.com)
2. Sign up with email — no credit card required
3. Navigate to **API Keys → Create API Key**
4. Copy the key (starts with `gsk_`)

### Step 2: Configure SIDJUA

```bash
export GROQ_API_KEY=gsk_your-key-here

sidjua key add groq-key \
  --provider groq \
  --source env:GROQ_API_KEY
```

### Step 3: Create an Agent Using Groq

```yaml
schema_version: "1.0"
id: groq-worker
name: Groq Worker
tier: 3
division: engineering
provider: groq
model: llama-3.3-70b-versatile
skill: agents/skills/groq-worker.md
capabilities: [text-generation, coding]
budget:
  per_task_usd: 0.10
  per_month_usd: 5.00
```

---

## Third Option: Google Gemini (AI Studio free tier)

**Google AI Studio** offers a free API tier for Gemini models. The free tier is generous for evaluation and low-volume use.

The catalog includes three Gemini models:

| Model | Context | Tool Use | Free Tier |
|-------|---------|----------|-----------|
| `gemini-2.5-pro` | 1M tokens | Yes | Yes (rate-limited) |
| `gemini-2.0-flash` | 1M tokens | Yes | Yes (rate-limited) |
| `gemini-2.0-flash-lite` | 1M tokens | Yes | Yes (rate-limited) |

Note: Paid pricing applies if you use Google AI Studio through a Google Cloud project. The free tier is available directly via [aistudio.google.com](https://aistudio.google.com).

### Step 1: Get a Google AI Studio API Key

1. Go to [aistudio.google.com](https://aistudio.google.com)
2. Sign in with a Google account
3. Click **Get API key → Create API key in new project**
4. Copy the key

### Step 2: Configure SIDJUA

```bash
export GOOGLE_AI_API_KEY=AIza...

sidjua key add google-key \
  --provider google-gemini \
  --source env:GOOGLE_AI_API_KEY
```

### Step 3: Create an Agent Using Gemini

```yaml
schema_version: "1.0"
id: gemini-analyst
name: Gemini Analyst
tier: 2
division: engineering
provider: google-gemini
model: gemini-2.0-flash
skill: agents/skills/gemini-analyst.md
capabilities: [analysis, delegation, summarization]
budget:
  per_task_usd: 1.00
  per_month_usd: 20.00
```

---

## Configuring Automatic Failover

Each agent can specify a `fallback_provider` and `fallback_model`. If the primary provider returns an error (rate limit, timeout, outage), SIDJUA retries the same LLM call with the fallback automatically.

A recommended free setup: Cloudflare Workers AI as primary (free), Groq as fallback (very cheap):

```yaml
schema_version: "1.0"
id: resilient-worker
name: Resilient Worker
tier: 3
division: engineering
provider: cloudflare-ai
model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast"
fallback_provider: groq
fallback_model: llama-3.1-8b-instant
skill: agents/skills/resilient-worker.md
capabilities: [text-generation]
budget:
  per_task_usd: 0.05
  per_month_usd: 2.00
```

With this setup, the agent tries Cloudflare Workers AI first. If that fails, it automatically retries with Groq's Llama 3.1 8B. The budget is set to allow for occasional Groq usage.

---

## What Rate Limit Errors Look Like

When an agent hits a provider rate limit, SIDJUA logs a `PROVIDER_CALL_COMPLETE` event with an error. The reasoning loop retries once before escalating the task. If a fallback provider is configured, the retry uses the fallback instead of the same provider.

If you see tasks frequently escalating with "LLM call timed out" or "provider error" messages, it usually means:

1. Rate limit on primary provider — configure a fallback
2. The model is too slow for the task's TTL — switch to a faster model
3. Network connectivity issue — check `sidjua setup --validate`

You can view provider errors in the event stream:

```bash
sidjua logs --type all --follow
```

---

## When to Consider Paid Providers

Free tiers are excellent for getting started, but consider upgrading to paid providers when:

- **T1 agents** need to handle complex strategic reasoning — free models often struggle with multi-step planning
- **Tool use accuracy** is critical — larger paid models are more reliable at structured tool calls
- **Task volume** regularly hits free tier rate limits — a $5–10/month paid plan often costs less than the time spent debugging rate limit failures
- **Context length** matters — some tasks need more than 32k tokens of context; not all free models support long contexts

The SIDJUA budget system protects you from surprise bills regardless of which provider you use. Set `per_month_usd` to the maximum you are willing to spend and the system will stop the agent when that limit is reached.

---

## A Note on DeepSeek

DeepSeek is in the SIDJUA provider catalog as a budget-tier option with very low pricing. However, DeepSeek is operated by a Chinese company, and data sent to DeepSeek's API leaves your infrastructure and passes through servers outside your control.

If data sovereignty matters for your use case — and for many organizations it does — do not use DeepSeek for tasks involving internal, confidential, or sensitive data. Use local providers (Ollama, LM Studio) or providers operating under applicable data protection regulations instead.

SIDJUA's data classification system (Chapter 13 in SIDJUA-CONCEPTS.md) lets you restrict specific agents to specific providers. You can allow DeepSeek for PUBLIC-classified research tasks while blocking it for INTERNAL or CONFIDENTIAL work.

---

## Local Providers — The Truly Free Option

If you have a computer with 8+ GB of RAM and a GPU (or patience), local providers are completely free with no rate limits:

| Provider | Default URL | Best For |
|----------|-------------|----------|
| Ollama | `http://localhost:11434/v1` | Easiest setup, Mac/Linux |
| LM Studio | `http://localhost:1234/v1` | GUI, Windows/Mac |
| llama.cpp server | `http://localhost:8080/v1` | Low-level control |
| vLLM | `http://localhost:8000/v1` | High-throughput Linux |

```bash
# Add a local Ollama provider
sidjua provider add-custom \
  --id ollama-local \
  --name "Ollama (local)" \
  --base-url http://localhost:11434/v1 \
  --model llama3.2
```

Local providers have no rate limits, no API keys, and no costs — but they require your own hardware and the model must be downloaded and running before agents can use it.
