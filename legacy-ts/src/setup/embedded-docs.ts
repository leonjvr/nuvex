// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * Embedded setup documentation — bundled at build time by tsup.
 * Keeps `sidjua setup` functional in Docker without filesystem access to src/.
 */

export const DOCS: Record<"quick-start" | "provider-guide" | "model-recommendations", string> = {
  "quick-start": `# SIDJUA Quick Start Guide

## 1. Install

\`\`\`bash
npm install -g sidjua
\`\`\`

## 2. Initialize your workspace

\`\`\`bash
sidjua apply --config divisions.yaml
\`\`\`

## 3. Add a provider key

\`\`\`bash
# Via environment variable (recommended)
export ANTHROPIC_API_KEY=sk-ant-...

# Or add to .env file
echo "ANTHROPIC_API_KEY=sk-ant-..." >> .env
\`\`\`

## 4. Verify the key

\`\`\`bash
sidjua key test anthropic
\`\`\`

## 5. Run your first task

\`\`\`bash
sidjua run "Summarize the quarterly report"
\`\`\`

## 6. Check task status

\`\`\`bash
sidjua task <task-id> --watch
\`\`\`

## Supported Providers

| Provider       | Env Var                 | Free Tier |
|----------------|-------------------------|-----------|
| Anthropic      | ANTHROPIC_API_KEY       | No        |
| OpenAI         | OPENAI_API_KEY          | No        |
| DeepSeek       | DEEPSEEK_API_KEY        | No        |
| Cloudflare AI  | CLOUDFLARE_AI_API_KEY   | Yes       |
| Grok (xAI)     | GROK_API_KEY            | No        |
| Kimi (Moonshot)| KIMI_API_KEY            | No        |

## Next Steps

- See \`sidjua setup --ask provider-guide\` for detailed provider configuration
- See \`sidjua setup --ask model-recommendations\` for model selection guidance
- Run \`sidjua setup --ask\` for interactive guided setup
- Docs: https://github.com/GoetzKohlberg/sidjua
`,

  "provider-guide": `# SIDJUA Provider Configuration Guide

## Overview

SIDJUA supports multiple LLM providers. Providers are selected based on available API keys.
The priority order for automatic selection is: Anthropic → DeepSeek → Cloudflare AI → OpenAI.

## Cloud Providers

### Anthropic
- **Models**: Claude Opus 4.6, Claude Sonnet 4.6, Claude Haiku 4.5
- **Env var**: \`ANTHROPIC_API_KEY\`
- **Get key**: https://console.anthropic.com/
- **Best for**: Complex reasoning, code generation, long-form analysis

### OpenAI
- **Models**: GPT-4o, GPT-4o Mini
- **Env var**: \`OPENAI_API_KEY\`
- **Get key**: https://platform.openai.com/
- **Best for**: General-purpose tasks, function calling

### DeepSeek
- **Models**: DeepSeek V3, DeepSeek R1
- **Env var**: \`DEEPSEEK_API_KEY\`
- **Get key**: https://platform.deepseek.com/
- **Best for**: Cost-effective coding and reasoning

### Grok (xAI)
- **Models**: Grok-3
- **Env var**: \`GROK_API_KEY\`
- **Get key**: https://console.x.ai/
- **Best for**: Real-time information, large context

### Kimi (Moonshot)
- **Models**: Moonshot 128k
- **Env var**: \`KIMI_API_KEY\`
- **Get key**: https://platform.moonshot.ai/
- **Best for**: Long document processing

## Local / Self-Hosted Providers

### Ollama
- **Setup**: Install from https://ollama.com/, run \`ollama serve\`
- **Base URL**: \`http://localhost:11434/v1\`
- **No API key required**

\`\`\`bash
sidjua provider add-custom --id ollama \\
  --name "Ollama (local)" \\
  --base-url http://localhost:11434/v1 \\
  --model llama3.2
\`\`\`

### LM Studio
- **Setup**: Install from https://lmstudio.ai/, start local server
- **Base URL**: \`http://localhost:1234/v1\`

### vLLM
- **Setup**: Deploy vLLM server with your model
- **Base URL**: \`http://your-server:8000/v1\`

### Cloudflare Workers AI
- **Env vars**: \`CLOUDFLARE_AI_API_KEY\`, \`CLOUDFLARE_ACCOUNT_ID\`
- **Get key**: https://dash.cloudflare.com/
- **Free tier**: Yes — 10k neurons/day free

## Custom OpenAI-Compatible Endpoints

Any endpoint that implements the OpenAI Chat Completions API can be added:

\`\`\`bash
sidjua provider add-custom \\
  --id my-provider \\
  --name "My Custom Provider" \\
  --base-url https://my-api.example.com/v1 \\
  --model my-model-name \\
  --api-key sk-...
\`\`\`

## Troubleshooting

| Error | Solution |
|-------|----------|
| \`PROV-005: Authentication failed\` | Check your API key is set correctly |
| \`PROV-001: Provider unavailable\` | Check network connectivity and base URL |
| \`PROV-002: Rate limited\` | Wait for retry or switch providers |
| \`PROV-006: Bad request\` | Check model name and request parameters |
`,

  "model-recommendations": `# SIDJUA Model Recommendations

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
- **Preferred**: \`claude-opus-4-6\` (Anthropic)
- **Alternative**: \`grok-3-latest\` (Grok)
- **Budget**: \`gpt-4o\` (OpenAI)

### Tier 2 (T2) — Development / Implementation
- **Preferred**: \`claude-sonnet-4-6\` (Anthropic)
- **Alternative**: \`gpt-4o-mini\` (OpenAI)
- **Budget**: \`deepseek-chat\` (DeepSeek)

### Tier 3 (T3) — Execution / Simple Tasks
- **Preferred**: \`claude-haiku-4-5-20251001\` (Anthropic)
- **Alternative**: \`deepseek-chat\` (DeepSeek)
- **Free**: \`@cf/meta/llama-3.1-8b-instruct\` (Cloudflare AI)

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
`,
};
