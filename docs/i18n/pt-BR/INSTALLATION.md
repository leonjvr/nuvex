> Este documento foi traduzido por IA do [original em inglês](../INSTALLATION.md). Encontrou um erro? [Reporte-o](https://github.com/GoetzKohlberg/sidjua/issues).

# Guia de Instalação do SIDJUA

SIDJUA versão: 1.0.0 | Licença: AGPL-3.0-only | Atualizado: 2026-03-25

## Índice

1. [Matriz de Suporte de Plataformas](#1-matriz-de-suporte-de-plataformas)
2. [Pré-requisitos](#2-pré-requisitos)
3. [Métodos de Instalação](#3-métodos-de-instalação)
4. [Estrutura de Diretórios](#4-estrutura-de-diretórios)
5. [Variáveis de Ambiente](#5-variáveis-de-ambiente)
6. [Configuração de Provedores](#6-configuração-de-provedores)
7. [GUI de Desktop (Opcional)](#7-gui-de-desktop-opcional)
8. [Sandboxing de Agentes](#8-sandboxing-de-agentes)
9. [Busca Semântica (Opcional)](#9-busca-semântica-opcional)
10. [Solução de Problemas](#10-solução-de-problemas)
11. [Referência de Volumes Docker](#11-referência-de-volumes-docker)
12. [Atualização](#12-atualização)
13. [Próximos Passos](#13-próximos-passos)

---

## 1. Matriz de Suporte de Plataformas

| Recurso | Linux | macOS | Windows WSL2 | Windows (nativo) |
|---------|-------|-------|--------------|------------------|
| CLI + REST API | ✅ Completo | ✅ Completo | ✅ Completo | ✅ Completo |
| Docker | ✅ Completo | ✅ Docker Desktop | ✅ Docker Desktop | ✅ Docker Desktop |
| Sandboxing (bubblewrap) | ✅ Completo | ❌ Usa `none` como fallback | ✅ Completo (dentro do WSL2) | ❌ Usa `none` como fallback |
| Web Management Console | ✅ Full | ✅ Full | ✅ Full | ✅ Full |
| Busca Semântica (Qdrant) | ✅ | ✅ | ✅ | ✅ |

**Nota sobre bubblewrap:** Sandboxing de namespace de usuário Linux. macOS e Windows nativo fazem fallback automaticamente para o modo sandbox `none` — nenhuma configuração necessária.

---

## 2. Pré-requisitos

### Node.js >= 22.0.0

**Por quê:** SIDJUA usa módulos ES, `fetch()` nativo e `crypto.subtle` — tudo requer Node.js 22+.

**Ubuntu / Debian:**
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

**Fedora / RHEL / CentOS:**
```bash
curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
sudo dnf install -y nodejs
```

**Arch Linux:**
```bash
sudo pacman -S nodejs npm
```

**macOS (Homebrew):**
```bash
brew install node@22
echo 'export PATH="/opt/homebrew/opt/node@22/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

**macOS (instalador .pkg):** Baixar de [nodejs.org/en/download](https://nodejs.org/en/download).

**Windows (winget):**
```powershell
winget install OpenJS.NodeJS.LTS
```

**Windows (.msi):** Baixar de [nodejs.org/en/download](https://nodejs.org/en/download).

**WSL2:** Use as instruções do Ubuntu/Debian acima dentro do seu terminal WSL2.

Verificar:
```bash
node --version   # deve ser >= 22.0.0
npm --version    # deve ser >= 10.0.0
```

---

### Cadeia de Ferramentas C/C++ (apenas para builds a partir do código-fonte)

**Por quê:** `better-sqlite3` e `argon2` compilam add-ons nativos do Node.js durante `npm ci`. Usuários Docker podem pular isso.

**Ubuntu / Debian:**
```bash
sudo apt-get install -y python3 make g++ build-essential linux-headers-$(uname -r)
```

**Fedora / RHEL:**
```bash
sudo dnf groupinstall "Development Tools"
sudo dnf install python3
```

**Arch Linux:**
```bash
sudo pacman -S base-devel python
```

**macOS:**
```bash
xcode-select --install
```

**Windows:** Instale o [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) com a carga de trabalho **Desenvolvimento para desktop com C++**, depois:
```powershell
npm install --global windows-build-tools
```

**Alpine Linux:**
```bash
apk add python3 make g++ build-base linux-headers
```

---

### Docker >= 24 (opcional)

Necessário apenas para o método de instalação Docker. O plugin Docker Compose V2 (`docker compose`) deve estar disponível.

**Linux:** Siga as instruções em [docs.docker.com/engine/install](https://docs.docker.com/engine/install/).
Docker Compose V2 está incluído no Docker Engine >= 24.

**macOS / Windows:** Instale o [Docker Desktop](https://www.docker.com/products/docker-desktop/) (inclui Docker Compose V2).

Verificar:
```bash
docker --version          # deve ser >= 24.0.0
docker compose version    # deve mostrar v2.x.x
```

---

### Git

Qualquer versão recente. Instale via o gerenciador de pacotes do seu sistema operacional ou [git-scm.com](https://git-scm.com).

---

## 3. Métodos de Instalação

### Método A — Docker (Recomendado)

A forma mais rápida de obter uma instalação funcional do SIDJUA. Todas as dependências estão incluídas na imagem.

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
docker compose up -d
```

Aguarde os serviços ficarem saudáveis (até ~60 segundos no primeiro build):

```bash
docker compose ps
# NAME              STATUS
# sidjua            Up X seconds (healthy)
# sidjua-qdrant     Up X seconds (healthy)
```

Recuperar a chave API gerada automaticamente:

```bash
docker compose exec sidjua cat /app/.system/api-key
```

Inicializar a governança a partir do seu `divisions.yaml`:

```bash
docker compose exec sidjua sidjua apply --verbose
```

Executar a verificação de saúde do sistema:

```bash
docker compose exec sidjua sidjua selftest
```

**Nota ARM64:** A imagem Docker é construída sobre `node:22-alpine` que suporta `linux/amd64` e `linux/arm64`. Raspberry Pi (64 bits) e Macs com Apple Silicon (via Docker Desktop) são suportados nativamente.

**Bubblewrap no Docker:** Para habilitar o sandboxing de agentes dentro do contêiner, adicione `--cap-add=SYS_ADMIN` ao seu comando Docker run ou defina-o em `docker-compose.yml`:
```yaml
cap_add:
  - SYS_ADMIN
```

---

### Método B — Instalação Global npm

```bash
npm install -g sidjua
```

Executar o assistente de configuração interativo (3 etapas: local do espaço de trabalho, provedor, primeiro agente):
```bash
sidjua init
```

Para ambientes CI ou contêineres não interativos:
```bash
sidjua init --yes
```

Iniciar o guia de IA sem configuração (nenhuma chave API necessária):
```bash
sidjua chat guide
```

---

### Método C — Build a partir do Código-Fonte

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
npm ci
npm run build
```

O processo de build usa `tsup` para compilar `src/index.ts` em:
- `dist/index.js` (ESM)
- `dist/index.cjs` (CommonJS)

As etapas pós-build copiam arquivos de localidade i18n, funções padrão, divisões e modelos de base de conhecimento para `dist/`.

Executar a partir do código-fonte:
```bash
node dist/index.js --help
```

Executar a suite de testes:
```bash
npm test                    # todos os testes
npm run test:coverage       # com relatório de cobertura
npx tsc --noEmit            # apenas verificação de tipos
```

---

## 4. Estrutura de Diretórios

### Caminhos de Implantação Docker

| Caminho | Volume Docker | Propósito | Gerenciado por |
|------|---------------|---------|------------|
| `/app/dist/` | Camada de imagem | Aplicação compilada | SIDJUA |
| `/app/node_modules/` | Camada de imagem | Dependências Node.js | SIDJUA |
| `/app/system/` | Camada de imagem | Padrões e modelos integrados | SIDJUA |
| `/app/defaults/` | Camada de imagem | Arquivos de configuração padrão | SIDJUA |
| `/app/docs/` | Camada de imagem | Documentação incluída | SIDJUA |
| `/app/data/` | `sidjua-data` | Bancos de dados SQLite, backups, coleções de conhecimento | Usuário |
| `/app/config/` | `sidjua-config` | `divisions.yaml` e configuração personalizada | Usuário |
| `/app/logs/` | `sidjua-logs` | Arquivos de log estruturados | Usuário |
| `/app/.system/` | `sidjua-system` | Chave API, estado de atualização, bloqueio de processo | Gerenciado pelo SIDJUA |
| `/app/agents/` | `sidjua-workspace` | Definições de agentes, habilidades, modelos | Usuário |
| `/app/governance/` | `sidjua-governance` | Trilha de auditoria, snapshots de governança | Usuário |

---

### Caminhos de Instalação Manual / npm

Após `sidjua init`, seu espaço de trabalho está organizado como:

```
~/sidjua-workspace/           # ou SIDJUA_CONFIG_DIR
├── divisions.yaml            # Sua configuração de governança
├── .sidjua/                  # Estado interno (WAL, buffer de telemetria)
│   └── telemetry.db
├── data/
│   ├── sidjua.db             # Banco de dados principal (agentes, tarefas, auditoria, custos)
│   ├── knowledge/            # Bancos de dados de conhecimento por agente
│   │   └── <agent-id>.db
│   └── backups/              # Arquivos de backup assinados com HMAC
├── agents/                   # Diretórios de habilidades de agentes
├── governance/               # Trilha de auditoria (somente acréscimo)
├── logs/                     # Logs da aplicação
└── system/                   # Estado em tempo de execução
```

---

### Bancos de Dados SQLite

| Banco de Dados | Caminho | Conteúdo |
|----------|------|----------|
| Principal | `data/sidjua.db` | Agentes, tarefas, custos, snapshots de governança, chaves API, log de auditoria |
| Telemetria | `.sidjua/telemetry.db` | Relatórios de erros opcionais com consentimento (com PII removido) |
| Conhecimento | `data/knowledge/<agent-id>.db` | Embeddings vetoriais por agente e índice BM25 |

Os bancos de dados SQLite são arquivos únicos, multiplataforma e portáteis. Faça backup com `sidjua backup create`.

---

## 5. Variáveis de Ambiente

Copie `.env.example` para `.env` e personalize. Todas as variáveis são opcionais, salvo indicação em contrário.

### Servidor

| Variável | Padrão | Descrição |
|----------|---------|-------------|
| `SIDJUA_PORT` | `3000` | Porta de escuta da REST API |
| `SIDJUA_HOST` | `127.0.0.1` | Endereço de bind da REST API. Use `0.0.0.0` para acesso remoto |
| `NODE_ENV` | `production` | Modo de execução (`production` ou `development`) |
| `SIDJUA_API_KEY` | Gerado automaticamente | Token bearer da REST API. Criado automaticamente no primeiro início se ausente |
| `SIDJUA_MAX_BODY_SIZE` | `2097152` (2 MiB) | Tamanho máximo do corpo da requisição de entrada em bytes |

### Substituições de Diretório

| Variável | Padrão | Descrição |
|----------|---------|-------------|
| `SIDJUA_DATA_DIR` | `<workspace>/data` | Substituir o local do diretório de dados |
| `SIDJUA_CONFIG_DIR` | `<workspace>` | Substituir o local do diretório de configuração |
| `SIDJUA_LOG_DIR` | `<workspace>/logs` | Substituir o local do diretório de logs |

### Busca Semântica

| Variável | Padrão | Descrição |
|----------|---------|-------------|
| `SIDJUA_QDRANT_URL` | `http://localhost:6333` | Endpoint do banco de dados vetorial Qdrant. Padrão Docker: `http://qdrant:6333` |
| `OPENAI_API_KEY` | — | Necessário para embeddings `text-embedding-3-large` do OpenAI |
| `SIDJUA_CF_ACCOUNT_ID` | — | ID de conta Cloudflare para embeddings gratuitos |
| `SIDJUA_CF_TOKEN` | — | Token API Cloudflare para embeddings gratuitos |

### Provedores LLM

| Variável | Provedor |
|----------|----------|
| `ANTHROPIC_API_KEY` | Anthropic (Claude) |
| `OPENAI_API_KEY` | OpenAI (GPT-4, embeddings) |
| `GOOGLE_AI_API_KEY` | Google AI (Gemini) |
| `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` | Cloudflare Workers AI (nível gratuito) |
| `GROQ_API_KEY` | Groq (inferência rápida, nível gratuito disponível) |
| `DEEPSEEK_API_KEY` | DeepSeek |

---

## 6. Configuração de Provedores

### Opção Sem Configuração

`sidjua chat guide` funciona sem nenhuma chave API. Ele se conecta ao Cloudflare Workers AI através do proxy SIDJUA. Com limite de taxa, mas adequado para avaliação e integração.

### Adicionando Seu Primeiro Provedor

**Groq (nível gratuito, sem cartão de crédito necessário):**
```bash
sidjua key set groq <your-groq-api-key>
sidjua provider list
```
Obtenha uma chave gratuita em [console.groq.com](https://console.groq.com).

**Anthropic (recomendado para produção):**
```bash
export ANTHROPIC_API_KEY=sk-ant-...
sidjua key set anthropic $ANTHROPIC_API_KEY
```

**Ollama (implantação air-gap / local):**
```bash
sidjua provider add-custom \
  --id ollama \
  --name "Ollama (local)" \
  --base-url http://localhost:11434/v1 \
  --model llama3.2
```

Validar todos os provedores configurados:
```bash
sidjua setup --validate
```

---

## 7. Web Management Console (Optional)

The SIDJUA Web Management Console is a React/TypeScript application served via the Hono REST API. It is optional — the CLI and REST API work without it.

No additional installation steps are required. The web console is served automatically when the SIDJUA API server is running.

### Accessing the Console

Once the API server is started, open a browser at:

```
http://localhost:PORT
```

Where `PORT` is the API server port (default: `4000`). The console requires authentication using your API key or a scoped token.

---

## 8. Sandboxing de Agentes

SIDJUA usa uma interface `SandboxProvider` plugável. O sandbox envolve a execução de habilidades de agentes em isolamento de processo no nível do sistema operacional.

### Suporte de Sandbox por Plataforma

| Plataforma | Provedor de Sandbox | Observações |
|----------|-----------------|-------|
| Linux (nativo) | `bubblewrap` | Isolamento completo de namespace de usuário |
| Docker (contêiner Linux) | `bubblewrap` | Requer `--cap-add=SYS_ADMIN` |
| macOS | `none` (fallback automático) | macOS não suporta namespaces de usuário Linux |
| Windows WSL2 | `bubblewrap` | Instalar como no Linux dentro do WSL2 |
| Windows (nativo) | `none` (fallback automático) | |

### Instalando bubblewrap (Linux)

**Ubuntu / Debian:**
```bash
sudo apt-get install -y bubblewrap socat
```

**Fedora / RHEL:**
```bash
sudo dnf install -y bubblewrap socat
```

**Arch Linux:**
```bash
sudo pacman -S bubblewrap socat
```

### Configuração

Em `divisions.yaml`:
```yaml
governance:
  sandbox: bubblewrap    # ou: none
```

Verificar disponibilidade do sandbox:
```bash
sidjua sandbox check
```

---

## 9. Busca Semântica (Opcional)

A busca semântica potencializa `sidjua memory search` e a recuperação de conhecimento dos agentes. Requer um banco de dados vetorial Qdrant e um provedor de embeddings.

### Perfil do Docker Compose

O `docker-compose.yml` incluído tem um perfil `semantic-search`:
```bash
docker compose --profile semantic-search up -d
```
Isso inicia um contêiner Qdrant junto ao SIDJUA.

### Qdrant Independente

```bash
docker run -d \
  --name sidjua-qdrant \
  -p 6333:6333 \
  -v qdrant-storage:/qdrant/storage \
  qdrant/qdrant:v1.13.2
```

Definir o endpoint:
```bash
export SIDJUA_QDRANT_URL=http://localhost:6333
```

### Sem Qdrant

Se o Qdrant não estiver disponível, `sidjua memory import` e `sidjua memory search` são desabilitados. Todos os outros recursos do SIDJUA (CLI, REST API, execução de agentes, governança, auditoria) funcionam normalmente. O sistema usa a busca por palavras-chave BM25 como fallback para quaisquer consultas de conhecimento.

---

## 10. Solução de Problemas

### Todas as Plataformas

**`npm ci` falha com erros de `node-pre-gyp` ou `node-gyp`:**
```
gyp ERR! build error
```
Instale a cadeia de ferramentas C/C++ (consulte a seção de Pré-requisitos). No Ubuntu: `sudo apt-get install -y python3 make g++ build-essential`.

**`Cannot find divisions.yaml`:**
Verifique `SIDJUA_CONFIG_DIR`. O arquivo deve estar em `$SIDJUA_CONFIG_DIR/divisions.yaml`. Execute `sidjua init` para criar a estrutura do espaço de trabalho.

**A REST API retorna 401 Unauthorized:**
Verifique o cabeçalho `Authorization: Bearer <key>`. Recupere a chave gerada automaticamente com:
```bash
cat ~/.sidjua/.system/api-key          # instalação manual
docker compose exec sidjua cat /app/.system/api-key  # Docker
```

**Porta 3000 já em uso:**
```bash
SIDJUA_PORT=3001 sidjua server start
# ou definir em .env: SIDJUA_PORT=3001
```

---

### Ubuntu / Debian

**`better-sqlite3` falha ao compilar, `futex.h` não encontrado:**
```bash
sudo apt-get install -y linux-headers-$(uname -r)
```

---

### Fedora / RHEL

**SELinux bloqueia montagens de volume Docker:**
```yaml
# Adicionar rótulo :Z para contexto SELinux
volumes:
  - ./my-config:/app/config:Z
```
Ou definir o contexto SELinux manualmente:
```bash
chcon -Rt svirt_sandbox_file_t ./my-config
```

---

### Arch Linux

**Versão do Node.js muito antiga:**
Use `nvm` para instalar o Node.js 22:
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
nvm install 22
nvm use 22
```

---

### macOS

**`xcrun: error: invalid active developer path`:**
```bash
xcode-select --install
```

**Docker Desktop fica sem memória:**
Abra o Docker Desktop → Configurações → Recursos → Memória. Aumente para pelo menos 4 GB.

**Apple Silicon — incompatibilidade de arquitetura:**
Verifique se sua instalação do Node.js é ARM64 nativo (não Rosetta):
```bash
node -e "console.log(process.arch)"
# esperado: arm64
```
Se imprimir `x64`, reinstale o Node.js usando o instalador ARM64 de nodejs.org.

---

### Windows (nativo)

**`MSBuild` ou `cl.exe` não encontrado:**
Instale o [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) e selecione a carga de trabalho **Desenvolvimento para desktop com C++**. Depois execute:
```powershell
npm install --global windows-build-tools
```

**Erros de caminho longo (`ENAMETOOLONG`):**
Habilite o suporte a caminhos longos no registro do Windows:
```powershell
# Executar como Administrador
Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" `
  -Name LongPathsEnabled -Value 1
```

**Comando `sidjua` não encontrado após `npm install -g`:**
Adicione o diretório bin global do npm ao seu PATH:
```powershell
npm config get prefix  # mostra ex. C:\Users\you\AppData\Roaming\npm
# Adicione esse caminho às Variáveis de Ambiente do Sistema → Caminho
```

---

### Windows WSL2

**Docker falha ao iniciar dentro do WSL2:**
Abra o Docker Desktop → Configurações → Geral → habilite **Usar o motor baseado em WSL 2**.
Em seguida, reinicie o Docker Desktop e seu terminal WSL2.

**Erros de permissão em arquivos sob `/mnt/c/`:**
Volumes Windows NTFS montados no WSL2 têm permissões restritas. Mova seu espaço de trabalho para um caminho nativo Linux:
```bash
mkdir ~/sidjua-workspace
cd ~/sidjua-workspace
sidjua init
```

---

### Raspberry Pi / ARM64

**`npm ci` é muito lento (5-10 minutos):**
Isso é normal. A compilação de add-ons nativos no ARM64 leva mais tempo. Considere usar a imagem Docker em vez disso:
```bash
docker pull sidjua/sidjua:latest-arm64
```

**Sem memória durante o build:**
Adicionar espaço de swap:
```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

---

## 11. Referência de Volumes Docker

### Volumes Nomeados

| Nome do Volume | Caminho no Contêiner | Propósito |
|-------------|---------------|---------|
| `sidjua-data` | `/app/data` | Bancos de dados SQLite, arquivos de backup, coleções de conhecimento |
| `sidjua-config` | `/app/config` | `divisions.yaml`, configuração personalizada |
| `sidjua-logs` | `/app/logs` | Logs de aplicação estruturados |
| `sidjua-system` | `/app/.system` | Chave API, estado de atualização, arquivo de bloqueio de processo |
| `sidjua-workspace` | `/app/agents` | Diretórios de habilidades de agentes, definições, modelos |
| `sidjua-governance` | `/app/governance` | Trilha de auditoria imutável, snapshots de governança |
| `qdrant-storage` | `/qdrant/storage` | Índice vetorial Qdrant (somente perfil de busca semântica) |

### Usando um Diretório do Host

Para montar seu próprio `divisions.yaml` em vez de editá-lo dentro do contêiner:

```yaml
# docker-compose.override.yml
services:
  sidjua:
    volumes:
      - ./my-config:/app/config   # substitui o volume nomeado sidjua-config
```

### Backup

```bash
sidjua backup create                    # de dentro do contêiner
# ou
docker compose exec sidjua sidjua backup create
```

Os backups são arquivos assinados com HMAC armazenados em `/app/data/backups/`.

---

## 12. Atualização

### Docker

```bash
git pull
docker compose build --no-cache
docker compose up -d
docker compose exec sidjua sidjua apply    # executar migrações de esquema
```

`sidjua apply` é idempotente — sempre seguro para reexecutar após uma atualização.

### Instalação Global npm

```bash
npm update -g sidjua
sidjua apply    # executar migrações de esquema
```

### Build a partir do Código-Fonte

```bash
git pull
npm ci
npm run build
node dist/index.js apply    # executar migrações de esquema
```

### Reversão

SIDJUA cria um snapshot de governança antes de cada `sidjua apply`. Para reverter:

```bash
sidjua rollback list
sidjua rollback <version>
```

---

## 13. Próximos Passos

| Recurso | Comando / Link |
|----------|---------------|
| Início Rápido | [docs/QUICK-START.md](QUICK-START.md) |
| Referência da CLI | [docs/CLI-REFERENCE.md](CLI-REFERENCE.md) |
| Exemplos de Governança | [docs/GOVERNANCE-EXAMPLES.md](GOVERNANCE-EXAMPLES.md) |
| Guia de Provedores LLM Gratuitos | [docs/FREE-LLM-PROVIDER-GUIDE.md](FREE-LLM-PROVIDER-GUIDE.md) |
| Solução de Problemas | [docs/TROUBLESHOOTING.md](TROUBLESHOOTING.md) |

Primeiros comandos a executar após a instalação:

```bash
sidjua chat guide    # guia de IA sem configuração — nenhuma chave API necessária
sidjua selftest      # verificação de saúde do sistema (7 categorias, pontuação 0-100)
sidjua apply         # provisionar agentes a partir de divisions.yaml
```
