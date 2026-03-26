# SIDJUA Provider Configuration Guide

## Overview

SIDJUA supports multiple LLM providers. Providers are selected based on available API keys.
The priority order for automatic selection is: Anthropic → DeepSeek → Cloudflare AI → OpenAI.

## Cloud Providers

### Anthropic
- **Models**: Claude Opus 4.6, Claude Sonnet 4.6, Claude Haiku 4.5
- **Env var**: `ANTHROPIC_API_KEY`
- **Get key**: https://console.anthropic.com/
- **Best for**: Complex reasoning, code generation, long-form analysis

### OpenAI
- **Models**: GPT-4o, GPT-4o Mini
- **Env var**: `OPENAI_API_KEY`
- **Get key**: https://platform.openai.com/
- **Best for**: General-purpose tasks, function calling

### DeepSeek
- **Models**: DeepSeek V3, DeepSeek R1
- **Env var**: `DEEPSEEK_API_KEY`
- **Get key**: https://platform.deepseek.com/
- **Best for**: Cost-effective coding and reasoning

### Grok (xAI)
- **Models**: Grok-3
- **Env var**: `GROK_API_KEY`
- **Get key**: https://console.x.ai/
- **Best for**: Real-time information, large context

### Kimi (Moonshot)
- **Models**: Moonshot 128k
- **Env var**: `KIMI_API_KEY`
- **Get key**: https://platform.moonshot.ai/
- **Best for**: Long document processing

## Local / Self-Hosted Providers

### Ollama
- **Setup**: Install from https://ollama.com/, run `ollama serve`
- **Base URL**: `http://localhost:11434/v1`
- **No API key required**

```bash
sidjua provider add-custom --id ollama \
  --name "Ollama (local)" \
  --base-url http://localhost:11434/v1 \
  --model llama3.2
```

### LM Studio
- **Setup**: Install from https://lmstudio.ai/, start local server
- **Base URL**: `http://localhost:1234/v1`

### vLLM
- **Setup**: Deploy vLLM server with your model
- **Base URL**: `http://your-server:8000/v1`

### Cloudflare Workers AI
- **Env vars**: `CLOUDFLARE_AI_API_KEY`, `CLOUDFLARE_ACCOUNT_ID`
- **Get key**: https://dash.cloudflare.com/
- **Free tier**: Yes — 10k neurons/day free

## Custom OpenAI-Compatible Endpoints

Any endpoint that implements the OpenAI Chat Completions API can be added:

```bash
sidjua provider add-custom \
  --id my-provider \
  --name "My Custom Provider" \
  --base-url https://my-api.example.com/v1 \
  --model my-model-name \
  --api-key sk-...
```

Optional: test capability detection before adding:

```bash
sidjua provider test --base-url https://my-api.example.com/v1 --model my-model
```

## Provider Selection

Providers are selected per-agent in divisions.yaml:

```yaml
agents:
  - id: my-agent
    provider: anthropic
    model: claude-sonnet-4-6
```

Or use the default (first available provider in priority order).

## Troubleshooting

| Error | Solution |
|-------|----------|
| `PROV-005: Authentication failed` | Check your API key is set correctly |
| `PROV-001: Provider unavailable` | Check network connectivity and base URL |
| `PROV-002: Rate limited` | Wait for retry or switch providers |
| `PROV-006: Bad request` | Check model name and request parameters |
