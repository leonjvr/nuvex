# SIDJUA Quick Start Guide

## 1. Install

```bash
npm install -g sidjua
```

## 2. Initialize your workspace

```bash
sidjua apply --config divisions.yaml
```

## 3. Add a provider key

```bash
# Via environment variable (recommended)
export ANTHROPIC_API_KEY=sk-ant-...

# Or add to .env file
echo "ANTHROPIC_API_KEY=sk-ant-..." >> .env
```

## 4. Verify the key

```bash
sidjua key test anthropic
```

## 5. Run your first task

```bash
sidjua run "Summarize the quarterly report"
```

## 6. Check task status

```bash
sidjua task <task-id> --watch
```

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

- See `provider-guide.md` for detailed provider configuration
- See `model-recommendations.md` for model selection guidance
- Run `sidjua setup --ask` for interactive guided setup
