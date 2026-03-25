[English](../../README.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [Français](README.fr.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [中文 (简体)](README.zh-CN.md) | [中文 (繁體)](README.zh-TW.md) | [العربية](README.ar.md) | [বাংলা](README.bn.md) | [Čeština](README.cs.md) | [Filipino](README.fil.md) | [हिन्दी](README.hi.md) | [Bahasa Indonesia](README.id.md) | [Italiano](README.it.md) | [Bahasa Melayu](README.ms.md) | [Nederlands](README.nl.md) | [Polski](README.pl.md) | [Português (BR)](README.pt-BR.md) | [Română](README.ro.md) | [Русский](README.ru.md) | [Svenska](README.sv.md) | [ภาษาไทย](README.th.md) | [Türkçe](README.tr.md) | [Українська](README.uk.md) | [Tiếng Việt](README.vi.md)

> *Esta página foi traduzida automaticamente do [original em inglês](../../README.md). Encontrou um erro? [Reporte-o](https://github.com/GoetzKohlberg/sidjua/issues).*

# SIDJUA — A Plataforma de Governança de Agentes de IA

> A única plataforma de agentes onde a governança é aplicada pela arquitetura, não pela esperança de que o modelo se comporte.

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Docker](https://img.shields.io/badge/Docker-sidjua%2Fsidjua-blue)](https://hub.docker.com/r/sidjua/sidjua)
[![Version](https://img.shields.io/badge/version-1.0.0-green)](https://github.com/sidjua-dev/sidjua/releases)

---

## Instalação

### Pré-requisitos

| Ferramenta | Obrigatório | Observações |
|------------|-------------|-------------|
| **Node.js** | >= 22.0.0 | Módulos ES, `fetch()`, `crypto.subtle`. [Download](https://nodejs.org) |
| **Conjunto de Ferramentas C/C++** | Somente compilação a partir do código-fonte | `better-sqlite3` e `argon2` compilam extensões nativas |
| **Docker** | >= 24 (opcional) | Somente para implantação com Docker |

Instalar Node.js 22: Ubuntu/Debian (`curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs`), macOS (`brew install node@22`), Windows (`winget install OpenJS.NodeJS.LTS`).

Instalar ferramentas C/C++: Ubuntu (`sudo apt-get install -y python3 make g++ build-essential`), macOS (`xcode-select --install`), Windows (`npm install --global windows-build-tools`).

### Opção A — Docker (Recomendado)

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
docker compose up -d
```

```bash
# Visualizar a chave de API gerada automaticamente
docker compose exec sidjua cat /app/.system/api-key

# Inicializar a governança
docker compose exec sidjua sidjua apply --verbose

# Verificação de saúde do sistema
docker compose exec sidjua sidjua selftest
```

Suporta **linux/amd64** e **linux/arm64** (Raspberry Pi, Apple Silicon).

### Opção B — Instalação Global via npm

```bash
npm install -g sidjua
sidjua init          # Configuração interativa em 3 etapas
sidjua chat guide    # Guia de IA sem configuração (sem necessidade de chave de API)
```

### Opção C — Compilação a partir do Código-Fonte

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
npm ci && npm run build
node dist/index.js --help
```

### Notas de Plataforma

| Funcionalidade | Linux | macOS | Windows (WSL2) | Windows (nativo) |
|----------------|-------|-------|----------------|------------------|
| CLI + REST API | ✅ Completo | ✅ Completo | ✅ Completo | ✅ Completo |
| Docker | ✅ Completo | ✅ Completo (Desktop) | ✅ Completo (Desktop) | ✅ Completo (Desktop) |
| Sandboxing (bubblewrap) | ✅ Completo | ❌ Reverte para `none` | ✅ Completo (dentro do WSL2) | ❌ Reverte para `none` |
| Web Management Console | ✅ Full | ✅ Full | ✅ Full | ✅ Full |

Nenhum banco de dados externo é necessário. SIDJUA usa SQLite. Qdrant é opcional (somente para busca semântica).

Consulte [docs/INSTALLATION.md](docs/INSTALLATION.md) para o guia completo com estrutura de diretórios, variáveis de ambiente, solução de problemas por sistema operacional e referência de volumes Docker.

---

## Por que SIDJUA?

Todo framework de agentes de IA hoje depende da mesma premissa falha: que você pode confiar que a IA seguirá suas próprias regras.

**O problema com a governança baseada em prompts:**

Você dá a um agente um prompt de sistema que diz "nunca acesse dados pessoais de clientes". O agente lê a instrução. O agente também lê a mensagem do usuário pedindo que ele busque o histórico de pagamentos de João da Silva. O agente decide — por conta própria — se vai cumprir. Isso não é governança. É uma sugestão com tom firme.

**SIDJUA é diferente.**

A governança fica **fora** do agente. Cada ação passa por um pipeline de aplicação de 5 etapas **antes** de ser executada. Você define as regras em YAML. O sistema as aplica. O agente nunca decide se vai segui-las, porque a verificação acontece antes que o agente aja.

Isso é governança por arquitetura — não por prompts, não por ajuste fino, não pela esperança.

---

## Como Funciona

SIDJUA envolve seus agentes em uma camada de governança externa. A chamada LLM do agente nunca acontece até que a ação proposta passe por um pipeline de aplicação de 5 estágios:

**Estágio 1 — Proibido:** Ações bloqueadas são rejeitadas imediatamente. Sem chamada LLM, sem entrada no log marcada como "permitida", sem segunda chance. Se a ação estiver na lista de proibidos, ela para aqui.

**Estágio 2 — Aprovação:** Ações que requerem autorização humana ficam em espera antes da execução. O agente aguarda. O humano decide.

**Estágio 3 — Orçamento:** Cada tarefa é executada contra limites de custo em tempo real. Orçamentos por tarefa e por agente são aplicados. Quando o limite é atingido, a tarefa é cancelada — não sinalizada, não registrada para revisão, *cancelada*.

**Estágio 4 — Classificação:** Dados que cruzam fronteiras de divisão são verificados contra regras de classificação. Um agente de Nível 2 não pode acessar dados SECRETOS. Um agente na Divisão A não pode ler os segredos da Divisão B.

**Estágio 5 — Política:** Regras organizacionais personalizadas, aplicadas estruturalmente. Limites de frequência de chamadas de API, limites de tokens de saída, restrições de janela de tempo.

Todo o pipeline é executado antes que qualquer ação seja executada. Não existe modo de "registrar e revisar depois" para operações críticas de governança.

### Arquivo de Configuração Único

Toda a sua organização de agentes vive em um único `divisions.yaml`:

```yaml
divisions:
  - name: engineering
    agents:
      - name: research-agent
        provider: anthropic
        model: claude-haiku-4-5-20251001
        tier: 2
        budget:
          per_task_usd: 0.50
          per_month_usd: 50.00
    governance:
      rules:
        - no_external_api_calls: true
        - max_tokens_per_response: 4096
        - require_human_approval: [delete, send_email]
```

`sidjua apply` lê este arquivo e provisiona a infraestrutura completa de agentes: agentes, divisões, RBAC, roteamento, tabelas de auditoria, caminhos de segredos e regras de governança — em 10 etapas reproduzíveis.

### Arquitetura de Agentes

Os agentes são organizados em **divisões** (grupos funcionais) e **níveis** (graus de confiança). Agentes de Nível 1 têm autonomia total dentro de seu envelope de governança. Agentes de Nível 2 requerem aprovação para operações sensíveis. Agentes de Nível 3 são totalmente supervisionados. O sistema de níveis é aplicado estruturalmente — um agente não pode se auto-promover.

```
┌─────────────────────────────────────────────────┐
│                 SIDJUA Platform                 │
│                                                 │
│  ┌─────────────────────────────────────────┐   │
│  │           Governance Layer              │   │
│  │  Forbidden → Approval → Budget →        │   │
│  │  Classification → Policy (Stage 0)      │   │
│  └────────────────────┬────────────────────┘   │
│                       │ ✅ cleared              │
│            ┌──────────▼──────────┐             │
│            │   Agent Runtime     │             │
│            │  (any LLM provider) │             │
│            └──────────┬──────────┘             │
│                       │                        │
│  ┌────────────────────▼────────────────────┐   │
│  │            Audit Trail                  │   │
│  │  (WAL-integrity-verified, append-only)  │   │
│  └─────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

---

## Restrições de Arquitetura

SIDJUA aplica essas restrições no nível da arquitetura — elas não podem ser desabilitadas, contornadas ou substituídas por agentes:

1. **A governança é externa**: A camada de governança envolve o agente. O agente não tem acesso ao código de governança, não pode modificar regras e não pode detectar se a governança está presente.

2. **Pré-ação, não pós-ação**: Cada ação é verificada ANTES da execução. Não existe modo de "registrar e revisar depois" para operações críticas de governança.

3. **Aplicação estrutural**: As regras são aplicadas por caminhos de código, não por prompts ou instruções do modelo. Um agente não pode fazer "jailbreak" da governança porque a governança não é implementada como instruções para o modelo.

4. **Imutabilidade da auditoria**: O Write-Ahead Log (WAL) é apenas para escrita, com verificação de integridade. Entradas adulteradas são detectadas e excluídas.

5. **Isolamento de divisões**: Agentes em diferentes divisões não podem acessar os dados, segredos ou canais de comunicação uns dos outros.

---

## Comparação

| Funcionalidade | SIDJUA | CrewAI | AutoGen | LangGraph | OpenClaw |
|----------------|--------|--------|---------|-----------|----------|
| Governança Externa | ✅ Arquitetura | ❌ | ❌ | ❌ | ❌ |
| Aplicação Pré-Ação | ✅ Pipeline de 5 Etapas | ❌ | ❌ | ❌ | ❌ |
| Conformidade com Lei de IA da UE | ✅ | ❌ | ❌ | ❌ | ❌ |
| Auto-Hospedado | ✅ | ❌ Nuvem | ❌ Nuvem | ❌ Nuvem | ✅ Plugin |
| Capaz de Operar Sem Internet | ✅ | ❌ | ❌ | ❌ | ❌ |
| Agnóstico de Modelo | ✅ Qualquer LLM | Parcial | Parcial | Parcial | ✅ |
| E-mail Bidirecional | ✅ | ❌ | ❌ | ❌ | ❌ |
| Gateway Discord | ✅ | ❌ | ❌ | ❌ | ❌ |
| Agentes Hierárquicos | ✅ Divisões + Níveis | Básico | Básico | Grafo | ❌ |
| Aplicação de Orçamento | ✅ Limites por Agente | ❌ | ❌ | ❌ | ❌ |
| Isolamento Sandbox | ✅ bubblewrap | ❌ | ❌ | ❌ | ❌ |
| Imutabilidade da Auditoria | ✅ WAL + integridade | ❌ | ❌ | ❌ | ❌ |
| Licença | AGPL-3.0 | MIT | MIT | MIT | Mista |
| Auditorias Independentes | ✅ 2 Externas | ❌ | ❌ | ❌ | ❌ |

---

## Funcionalidades

### Governança e Conformidade

**Pipeline Pré-Ação (Estágio 0)** é executado antes de cada ação do agente: Verificação de proibição → Aprovação Humana → Aplicação de orçamento → Classificação de dados → Política Personalizada. Todos os cinco estágios são estruturais — eles executam em código, não no prompt do agente.

**Regras de Base Obrigatórias** são fornecidas com cada instalação: 10 regras de governança (`SYS-SEC-001` a `SYS-GOV-002`) que não podem ser removidas ou enfraquecidas pela configuração do usuário. Regras personalizadas estendem a base; elas não podem substituí-la.

**Conformidade com a Lei de IA da UE** — trilha de auditoria, framework de classificação e fluxos de trabalho de aprovação mapeiam diretamente para os requisitos dos Artigos 9, 12 e 17. O prazo de conformidade de agosto de 2026 está incorporado no roteiro do produto.

**Relatórios de Conformidade** via `sidjua audit report/violations/agents/export`: pontuação de conformidade, pontuações de confiança por agente, histórico de violações, exportação em CSV/JSON para auditores externos ou integração SIEM.

**Write-Ahead Log (WAL)** com verificação de integridade: cada decisão de governança é gravada em um log de apenas escrita antes da execução. Entradas adulteradas são detectadas na leitura. `sidjua memory recover` revalida e repara.

### Comunicação

Os agentes não apenas respondem a chamadas de API — eles participam de canais de comunicação reais.

**E-mail Bidirecional** (`sidjua email status/test/threads`): agentes recebem e-mail via polling IMAP e respondem via SMTP. O mapeamento de threads via cabeçalhos In-Reply-To mantém as conversas coerentes. Listas brancas de remetentes, limites de tamanho do corpo e remoção de HTML protegem o pipeline do agente de entradas maliciosas.

**Bot Gateway Discord**: interface completa de comandos slash via `sidjua module install discord`. Os agentes respondem a mensagens do Discord, mantêm threads de conversas e enviam notificações proativas.

**Integração Telegram**: alertas e notificações de agentes via bot Telegram. O padrão de adaptador multicanal suporta Telegram, Discord, ntfy e E-mail em paralelo.

### Operações

**Comando Docker único** para produção:

```bash
docker run -p 4200:4200 sidjua/sidjua:latest
```

A chave de API é gerada automaticamente na primeira inicialização e exibida nos logs do contêiner. Nenhuma variável de ambiente é necessária. Nenhuma configuração é necessária. Nenhum servidor de banco de dados é necessário — SIDJUA usa SQLite, um arquivo de banco de dados por agente.

**Gerenciamento via CLI** — ciclo de vida completo a partir de um único binário:

```bash
sidjua init                      # Configuração interativa do espaço de trabalho (3 etapas)
sidjua apply                     # Provisionar a partir de divisions.yaml
sidjua agent create/list/stop    # Ciclo de vida do agente
sidjua run "tarefa..." --wait    # Enviar tarefa com aplicação de governança
sidjua audit report              # Relatório de conformidade
sidjua costs                     # Detalhamento de custos por divisão/agente
sidjua backup create/restore     # Gerenciamento de backups assinados com HMAC
sidjua update                    # Atualização de versão com pré-backup automático
sidjua rollback                  # Restauração com 1 clique para versão anterior
sidjua email status/test         # Gerenciamento do canal de e-mail
sidjua secret set/get/rotate     # Gerenciamento de segredos criptografados
sidjua memory import/search      # Pipeline de conhecimento semântico
sidjua selftest                  # Verificação de saúde do sistema (7 categorias, pontuação 0-100)
```

**Memória Semântica** — importe conversas e documentos (`sidjua memory import ~/exports/claude-chats.zip`), pesquise com classificação híbrida de vetor + BM25. Suporta embeddings do Cloudflare Workers AI (gratuito, sem configuração) e embeddings grandes da OpenAI (maior qualidade para grandes bases de conhecimento).

**Chunking Adaptativo** — o pipeline de memória ajusta automaticamente os tamanhos de chunks para permanecer dentro do limite de tokens de cada modelo de embedding.

**Guia Sem Configuração** — `sidjua chat guide` lança um assistente de IA interativo sem nenhuma chave de API, alimentado pelo Cloudflare Workers AI através do proxy SIDJUA. Pergunte como configurar agentes, configurar governança ou entender o que aconteceu no log de auditoria.

**Implantação sem Internet** — execute totalmente desconectado da internet usando LLMs locais via Ollama ou qualquer endpoint compatível com OpenAI. Sem telemetria por padrão. Relatório opcional de falhas com total redação de PII.

### Segurança

**Isolamento Sandbox** — as habilidades do agente são executadas dentro do isolamento de processo no nível do SO via bubblewrap (namespaces de usuário Linux). Zero overhead adicional de RAM. Interface `SandboxProvider` plugável: `none` para desenvolvimento, `bubblewrap` para produção.

**Gerenciamento de Segredos** — armazenamento de segredos criptografados com RBAC (`sidjua secret set/get/list/delete/rotate/namespaces`). Nenhum cofre externo necessário.

**Construção com Segurança em Primeiro Lugar** — extenso conjunto de testes interno mais validação independente por 2 auditores de código externos (DeepSeek V3 e xAI Grok). Cabeçalhos de segurança, proteção CSRF, limitação de taxa e sanitização de entrada em cada superfície de API. Prevenção de injeção SQL com consultas parametrizadas em todo o sistema.

**Integridade de Backup** — arquivos de backup assinados com HMAC com proteção contra zip-slip, prevenção de zip bomb e verificação de checksum do manifesto na restauração.

---

## Importar de Outros Frameworks

```bash
# Visualizar o que será importado — nenhuma alteração feita
sidjua import openclaw --dry-run

# Importar configuração + arquivos de habilidades
sidjua import openclaw --skills
```

Seus agentes existentes mantêm sua identidade, modelos e habilidades. SIDJUA adiciona governança, trilhas de auditoria e controles de orçamento automaticamente.

---

## Referência de Configuração

Um `divisions.yaml` mínimo para começar:

```yaml
organization:
  name: "my-org"
  tier: 1

divisions:
  - name: operations
    tier: 2
    agents:
      - name: ops-agent
        provider: anthropic
        model: claude-haiku-4-5-20251001
        division: operations
        budget:
          per_task_usd: 0.25
          per_month_usd: 25.00

governance:
  stage0:
    enabled: true
    forbidden_actions:
      - delete_database
      - exfiltrate_data
    classification:
      default_level: INTERNAL
      max_agent_level: CONFIDENTIAL
```

`sidjua apply` provisiona a infraestrutura completa a partir deste arquivo. Execute novamente após alterações — é idempotente.

Consulte [docs/SIDJUA-APPLY-TECH-SPEC-V1.md](docs/SIDJUA-APPLY-TECH-SPEC-V1.md) para a especificação completa de todas as 10 etapas de provisionamento.

---

## REST API

A REST API do SIDJUA é executada na mesma porta que o painel:

```bash
sidjua server start --port 4200 --api-key $SIDJUA_API_KEY
```

Endpoints principais:

```
GET  /api/v1/health          # Verificação de saúde pública (sem autenticação)
GET  /api/v1/info            # Metadados do sistema (autenticado)
POST /api/v1/execute/run     # Enviar uma tarefa
GET  /api/v1/execute/:id/status  # Status da tarefa
GET  /api/v1/execute/:id/result  # Resultado da tarefa
GET  /api/v1/events          # Fluxo de eventos SSE
GET  /api/v1/audit/report    # Relatório de conformidade
```

Todos os endpoints, exceto `/health`, requerem autenticação Bearer. Gere uma chave:

```bash
sidjua api-key generate
```

---

## Docker Compose

```yaml
services:
  sidjua:
    image: sidjua/sidjua:latest
    ports:
      - "4200:4200"
    volumes:
      - sidjua-data:/data
    restart: unless-stopped

volumes:
  sidjua-data:
```

Ou use o `docker-compose.yml` incluído, que adiciona volumes nomeados para configuração, logs e espaço de trabalho do agente, além de um serviço Qdrant opcional para busca semântica:

```bash
docker compose up -d
docker compose exec sidjua sidjua init
docker compose exec sidjua sidjua apply
```

---

## Provedores

SIDJUA conecta-se a qualquer provedor LLM sem dependência exclusiva:

| Provedor | Modelos | Chave de API |
|----------|---------|--------------|
| Anthropic | Claude Sonnet 4.6, Haiku 4.5, Opus 4.6 | `ANTHROPIC_API_KEY` |
| Google | Gemini 2.0, Gemini 1.5 Pro | `GOOGLE_API_KEY` |
| Groq | Llama 3.x, Mixtral | `GROQ_API_KEY` (nível gratuito) |
| Cloudflare Workers AI | Llama, Mistral, Phi | `CF_ACCOUNT_ID` + `CF_TOKEN` |
| Ollama | Qualquer modelo local | Sem chave (local) |
| Compatível com OpenAI | Qualquer endpoint | URL + chave personalizadas |

```bash
# Adicionar uma chave de provedor
sidjua key set groq gsk_...

# Listar provedores e modelos disponíveis
sidjua provider list
```

---

## Roteiro

Roteiro completo em [sidjua.com/roadmap](https://sidjua.com/roadmap).

Próximos passos:
- Padrões de orquestração de múltiplos agentes (V1.1)
- Gatilhos de entrada via webhook (V1.1)
- Comunicação entre agentes (V1.2)
- Integração SSO empresarial (V1.x)
- Serviço de validação de governança hospedado na nuvem (V1.x)

---

## Comunidade

- **Discord**: [sidjua.com/discord](https://sidjua.com/discord)
- **Issues no GitHub**: [github.com/sidjua-dev/sidjua/issues](https://github.com/sidjua-dev/sidjua/issues)
- **E-mail**: contact@sidjua.com
- **Docs**: [sidjua.com/docs](https://sidjua.com/docs)

Se você encontrar um bug, abra uma issue — agimos rapidamente.

---

## Traduções

SIDJUA está disponível em 26 idiomas. Inglês e Alemão são mantidos pela equipe principal. Todas as outras traduções são geradas por IA e mantidas pela comunidade.

**Documentação:** Este README e o [Guia de Instalação](docs/INSTALLATION.md) estão disponíveis em todos os 26 idiomas. Veja o seletor de idiomas no topo desta página.

| Região | Idiomas |
|--------|---------|
| Américas | Inglês, Espanhol, Português (Brasil) |
| Europa | Alemão, Francês, Italiano, Holandês, Polonês, Tcheco, Romeno, Russo, Ucraniano, Sueco, Turco |
| Oriente Médio | Árabe |
| Ásia | Hindi, Bengali, Filipino, Indonésio, Malaio, Tailandês, Vietnamita, Japonês, Coreano, Chinês (Simplificado), Chinês (Tradicional) |

Encontrou um erro de tradução? Por favor, abra uma Issue no GitHub com:
- Idioma e código de localidade (ex.: `pt-BR`)
- O texto incorreto ou a chave do arquivo de localidade (ex.: `gui.nav.dashboard`)
- A tradução correta

Quer manter um idioma? Veja [CONTRIBUTING.md](CONTRIBUTING.md#translations) — usamos um modelo de mantenedor por idioma.

---

## Licença

**AGPL-3.0** — você pode usar, modificar e distribuir SIDJUA livremente, desde que compartilhe as modificações sob a mesma licença. O código-fonte está sempre disponível para os usuários de uma implantação hospedada.

Licença empresarial disponível para organizações que precisam de implantação proprietária sem obrigações AGPL.
[contact@sidjua.com](mailto:contact@sidjua.com)
