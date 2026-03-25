> Questo documento è stato tradotto dall'IA dall'[originale inglese](../INSTALLATION.md). Trovato un errore? [Segnalalo](https://github.com/GoetzKohlberg/sidjua/issues).

# Guida all'Installazione di SIDJUA

SIDJUA versione: 1.0.0 | Licenza: AGPL-3.0-only | Aggiornato: 2026-03-25

## Sommario

1. [Matrice di Supporto delle Piattaforme](#1-matrice-di-supporto-delle-piattaforme)
2. [Prerequisiti](#2-prerequisiti)
3. [Metodi di Installazione](#3-metodi-di-installazione)
4. [Struttura delle Directory](#4-struttura-delle-directory)
5. [Variabili d'Ambiente](#5-variabili-dambiente)
6. [Configurazione dei Provider](#6-configurazione-dei-provider)
7. [GUI Desktop (Opzionale)](#7-gui-desktop-opzionale)
8. [Sandboxing degli Agenti](#8-sandboxing-degli-agenti)
9. [Ricerca Semantica (Opzionale)](#9-ricerca-semantica-opzionale)
10. [Risoluzione dei Problemi](#10-risoluzione-dei-problemi)
11. [Riferimento Volumi Docker](#11-riferimento-volumi-docker)
12. [Aggiornamento](#12-aggiornamento)
13. [Prossimi Passi](#13-prossimi-passi)

---

## 1. Matrice di Supporto delle Piattaforme

| Funzionalità | Linux | macOS | Windows WSL2 | Windows (nativo) |
|---------|-------|-------|--------------|------------------|
| CLI + REST API | ✅ Completo | ✅ Completo | ✅ Completo | ✅ Completo |
| Docker | ✅ Completo | ✅ Docker Desktop | ✅ Docker Desktop | ✅ Docker Desktop |
| Sandboxing (bubblewrap) | ✅ Completo | ❌ Ricade su `none` | ✅ Completo (dentro WSL2) | ❌ Ricade su `none` |
| Web Management Console | ✅ Full | ✅ Full | ✅ Full | ✅ Full |
| Ricerca Semantica (Qdrant) | ✅ | ✅ | ✅ | ✅ |

**Nota su bubblewrap:** Sandboxing tramite spazio dei nomi utente Linux. macOS e Windows nativo ricadono automaticamente sulla modalità sandbox `none` — nessuna configurazione necessaria.

---

## 2. Prerequisiti

### Node.js >= 22.0.0

**Perché:** SIDJUA utilizza i moduli ES, `fetch()` nativo e `crypto.subtle` — tutto richiede Node.js 22+.

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

**macOS (programma di installazione .pkg):** Scaricare da [nodejs.org/en/download](https://nodejs.org/en/download).

**Windows (winget):**
```powershell
winget install OpenJS.NodeJS.LTS
```

**Windows (.msi):** Scaricare da [nodejs.org/en/download](https://nodejs.org/en/download).

**WSL2:** Utilizzare le istruzioni Ubuntu/Debian sopra all'interno del terminale WSL2.

Verifica:
```bash
node --version   # deve essere >= 22.0.0
npm --version    # deve essere >= 10.0.0
```

---

### Toolchain C/C++ (solo per le build dal sorgente)

**Perché:** `better-sqlite3` e `argon2` compilano addon nativi Node.js durante `npm ci`. Gli utenti Docker possono saltare questo passaggio.

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

**Windows:** Installare [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) con il carico di lavoro **Sviluppo desktop con C++**, quindi:
```powershell
npm install --global windows-build-tools
```

**Alpine Linux:**
```bash
apk add python3 make g++ build-base linux-headers
```

---

### Docker >= 24 (opzionale)

Richiesto solo per il metodo di installazione Docker. Il plugin Docker Compose V2 (`docker compose`) deve essere disponibile.

**Linux:** Seguire le istruzioni su [docs.docker.com/engine/install](https://docs.docker.com/engine/install/).
Docker Compose V2 è incluso con Docker Engine >= 24.

**macOS / Windows:** Installare [Docker Desktop](https://www.docker.com/products/docker-desktop/) (include Docker Compose V2).

Verifica:
```bash
docker --version          # deve essere >= 24.0.0
docker compose version    # deve mostrare v2.x.x
```

---

### Git

Qualsiasi versione recente. Installare tramite il gestore di pacchetti del proprio sistema operativo o [git-scm.com](https://git-scm.com).

---

## 3. Metodi di Installazione

### Metodo A — Docker (Consigliato)

Il modo più rapido per ottenere un'installazione SIDJUA funzionante. Tutte le dipendenze sono incluse nell'immagine.

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
docker compose up -d
```

Attendere che i servizi diventino operativi (fino a ~60 secondi alla prima build):

```bash
docker compose ps
# NAME              STATUS
# sidjua            Up X seconds (healthy)
# sidjua-qdrant     Up X seconds (healthy)
```

Recuperare la chiave API generata automaticamente:

```bash
docker compose exec sidjua cat /app/.system/api-key
```

Inizializzare la governance dal proprio `divisions.yaml`:

```bash
docker compose exec sidjua sidjua apply --verbose
```

Eseguire il controllo dello stato di salute del sistema:

```bash
docker compose exec sidjua sidjua selftest
```

**Nota ARM64:** L'immagine Docker è costruita su `node:22-alpine` che supporta `linux/amd64` e `linux/arm64`. Raspberry Pi (64-bit) e Mac con Apple Silicon (tramite Docker Desktop) sono supportati immediatamente.

**Bubblewrap in Docker:** Per abilitare il sandboxing degli agenti all'interno del container, aggiungere `--cap-add=SYS_ADMIN` al comando Docker run o impostarlo in `docker-compose.yml`:
```yaml
cap_add:
  - SYS_ADMIN
```

---

### Metodo B — Installazione Globale npm

```bash
npm install -g sidjua
```

Eseguire la procedura guidata di configurazione interattiva (3 passaggi: posizione dello spazio di lavoro, provider, primo agente):
```bash
sidjua init
```

Per ambienti CI o container non interattivi:
```bash
sidjua init --yes
```

Avviare la guida IA senza configurazione (nessuna chiave API richiesta):
```bash
sidjua chat guide
```

---

### Metodo C — Build dal Sorgente

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
npm ci
npm run build
```

Il processo di build utilizza `tsup` per compilare `src/index.ts` in:
- `dist/index.js` (ESM)
- `dist/index.cjs` (CommonJS)

I passaggi post-build copiano i file di localizzazione i18n, i ruoli predefiniti, le divisioni e i modelli della base di conoscenza in `dist/`.

Eseguire dal sorgente:
```bash
node dist/index.js --help
```

Eseguire la suite di test:
```bash
npm test                    # tutti i test
npm run test:coverage       # con report di copertura
npx tsc --noEmit            # solo verifica dei tipi
```

---

## 4. Struttura delle Directory

### Percorsi di Distribuzione Docker

| Percorso | Volume Docker | Scopo | Gestito da |
|------|---------------|---------|------------|
| `/app/dist/` | Livello immagine | Applicazione compilata | SIDJUA |
| `/app/node_modules/` | Livello immagine | Dipendenze Node.js | SIDJUA |
| `/app/system/` | Livello immagine | Valori predefiniti e modelli integrati | SIDJUA |
| `/app/defaults/` | Livello immagine | File di configurazione predefiniti | SIDJUA |
| `/app/docs/` | Livello immagine | Documentazione inclusa | SIDJUA |
| `/app/data/` | `sidjua-data` | Database SQLite, backup, raccolte di conoscenze | Utente |
| `/app/config/` | `sidjua-config` | `divisions.yaml` e configurazione personalizzata | Utente |
| `/app/logs/` | `sidjua-logs` | File di log strutturati | Utente |
| `/app/.system/` | `sidjua-system` | Chiave API, stato aggiornamento, blocco processo | Gestito da SIDJUA |
| `/app/agents/` | `sidjua-workspace` | Definizioni degli agenti, competenze, modelli | Utente |
| `/app/governance/` | `sidjua-governance` | Registro di audit, snapshot di governance | Utente |

---

### Percorsi di Installazione Manuale / npm

Dopo `sidjua init`, lo spazio di lavoro è organizzato come segue:

```
~/sidjua-workspace/           # o SIDJUA_CONFIG_DIR
├── divisions.yaml            # La tua configurazione di governance
├── .sidjua/                  # Stato interno (WAL, buffer di telemetria)
│   └── telemetry.db
├── data/
│   ├── sidjua.db             # Database principale (agenti, attività, audit, costi)
│   ├── knowledge/            # Database di conoscenza per agente
│   │   └── <agent-id>.db
│   └── backups/              # Archivi di backup firmati con HMAC
├── agents/                   # Directory delle competenze degli agenti
├── governance/               # Registro di audit (solo append)
├── logs/                     # Log dell'applicazione
└── system/                   # Stato di runtime
```

---

### Database SQLite

| Database | Percorso | Contenuto |
|----------|------|----------|
| Principale | `data/sidjua.db` | Agenti, attività, costi, snapshot di governance, chiavi API, registro di audit |
| Telemetria | `.sidjua/telemetry.db` | Report di errori opzionali con consenso (con PII rimosso) |
| Conoscenza | `data/knowledge/<agent-id>.db` | Embedding vettoriali per agente e indice BM25 |

I database SQLite sono file singoli, multipiattaforma e portabili. Eseguire il backup con `sidjua backup create`.

---

## 5. Variabili d'Ambiente

Copiare `.env.example` in `.env` e personalizzare. Tutte le variabili sono opzionali salvo indicazione contraria.

### Server

| Variabile | Predefinito | Descrizione |
|----------|---------|-------------|
| `SIDJUA_PORT` | `3000` | Porta di ascolto della REST API |
| `SIDJUA_HOST` | `127.0.0.1` | Indirizzo di binding della REST API. Usare `0.0.0.0` per l'accesso remoto |
| `NODE_ENV` | `production` | Modalità di runtime (`production` o `development`) |
| `SIDJUA_API_KEY` | Generato automaticamente | Token bearer della REST API. Creato automaticamente al primo avvio se assente |
| `SIDJUA_MAX_BODY_SIZE` | `2097152` (2 MiB) | Dimensione massima del corpo della richiesta in entrata in byte |

### Override delle Directory

| Variabile | Predefinito | Descrizione |
|----------|---------|-------------|
| `SIDJUA_DATA_DIR` | `<workspace>/data` | Override della posizione della directory dei dati |
| `SIDJUA_CONFIG_DIR` | `<workspace>` | Override della posizione della directory di configurazione |
| `SIDJUA_LOG_DIR` | `<workspace>/logs` | Override della posizione della directory dei log |

### Ricerca Semantica

| Variabile | Predefinito | Descrizione |
|----------|---------|-------------|
| `SIDJUA_QDRANT_URL` | `http://localhost:6333` | Endpoint del database vettoriale Qdrant. Predefinito Docker: `http://qdrant:6333` |
| `OPENAI_API_KEY` | — | Richiesto per gli embedding `text-embedding-3-large` di OpenAI |
| `SIDJUA_CF_ACCOUNT_ID` | — | ID account Cloudflare per embedding gratuiti |
| `SIDJUA_CF_TOKEN` | — | Token API Cloudflare per embedding gratuiti |

### Provider LLM

| Variabile | Provider |
|----------|----------|
| `ANTHROPIC_API_KEY` | Anthropic (Claude) |
| `OPENAI_API_KEY` | OpenAI (GPT-4, embedding) |
| `GOOGLE_AI_API_KEY` | Google AI (Gemini) |
| `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` | Cloudflare Workers AI (livello gratuito) |
| `GROQ_API_KEY` | Groq (inferenza rapida, livello gratuito disponibile) |
| `DEEPSEEK_API_KEY` | DeepSeek |

---

## 6. Configurazione dei Provider

### Opzione Senza Configurazione

`sidjua chat guide` funziona senza alcuna chiave API. Si connette a Cloudflare Workers AI tramite il proxy SIDJUA. Con limite di frequenza ma adatto per la valutazione e l'onboarding.

### Aggiungere il Primo Provider

**Groq (livello gratuito, nessuna carta di credito richiesta):**
```bash
sidjua key set groq <your-groq-api-key>
sidjua provider list
```
Ottenere una chiave gratuita su [console.groq.com](https://console.groq.com).

**Anthropic (consigliato per la produzione):**
```bash
export ANTHROPIC_API_KEY=sk-ant-...
sidjua key set anthropic $ANTHROPIC_API_KEY
```

**Ollama (distribuzione air-gap / locale):**
```bash
sidjua provider add-custom \
  --id ollama \
  --name "Ollama (local)" \
  --base-url http://localhost:11434/v1 \
  --model llama3.2
```

Validare tutti i provider configurati:
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

## 8. Sandboxing degli Agenti

SIDJUA utilizza un'interfaccia `SandboxProvider` modulare. Il sandbox avvolge l'esecuzione delle competenze degli agenti in un isolamento del processo a livello di sistema operativo.

### Supporto Sandbox per Piattaforma

| Piattaforma | Provider Sandbox | Note |
|----------|-----------------|-------|
| Linux (nativo) | `bubblewrap` | Isolamento completo dello spazio dei nomi utente |
| Docker (container Linux) | `bubblewrap` | Richiede `--cap-add=SYS_ADMIN` |
| macOS | `none` (fallback automatico) | macOS non supporta gli spazi dei nomi utente Linux |
| Windows WSL2 | `bubblewrap` | Installare come su Linux all'interno di WSL2 |
| Windows (nativo) | `none` (fallback automatico) | |

### Installazione di bubblewrap (Linux)

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

### Configurazione

In `divisions.yaml`:
```yaml
governance:
  sandbox: bubblewrap    # o: none
```

Verificare la disponibilità del sandbox:
```bash
sidjua sandbox check
```

---

## 9. Ricerca Semantica (Opzionale)

La ricerca semantica alimenta `sidjua memory search` e il recupero delle conoscenze degli agenti. Richiede un database vettoriale Qdrant e un provider di embedding.

### Profilo Docker Compose

Il `docker-compose.yml` incluso ha un profilo `semantic-search`:
```bash
docker compose --profile semantic-search up -d
```
Questo avvia un container Qdrant insieme a SIDJUA.

### Qdrant Autonomo

```bash
docker run -d \
  --name sidjua-qdrant \
  -p 6333:6333 \
  -v qdrant-storage:/qdrant/storage \
  qdrant/qdrant:v1.13.2
```

Impostare l'endpoint:
```bash
export SIDJUA_QDRANT_URL=http://localhost:6333
```

### Senza Qdrant

Se Qdrant non è disponibile, `sidjua memory import` e `sidjua memory search` sono disabilitati. Tutte le altre funzionalità di SIDJUA (CLI, REST API, esecuzione degli agenti, governance, audit) funzionano normalmente. Il sistema ricade sulla ricerca per parole chiave BM25 per qualsiasi query di conoscenza.

---

## 10. Risoluzione dei Problemi

### Tutte le Piattaforme

**`npm ci` fallisce con errori `node-pre-gyp` o `node-gyp`:**
```
gyp ERR! build error
```
Installare la toolchain C/C++ (vedere la sezione Prerequisiti). Su Ubuntu: `sudo apt-get install -y python3 make g++ build-essential`.

**`Cannot find divisions.yaml`:**
Verificare `SIDJUA_CONFIG_DIR`. Il file deve trovarsi in `$SIDJUA_CONFIG_DIR/divisions.yaml`. Eseguire `sidjua init` per creare la struttura dello spazio di lavoro.

**La REST API restituisce 401 Unauthorized:**
Verificare l'intestazione `Authorization: Bearer <key>`. Recuperare la chiave generata automaticamente con:
```bash
cat ~/.sidjua/.system/api-key          # installazione manuale
docker compose exec sidjua cat /app/.system/api-key  # Docker
```

**La porta 3000 è già in uso:**
```bash
SIDJUA_PORT=3001 sidjua server start
# o impostare in .env: SIDJUA_PORT=3001
```

---

### Ubuntu / Debian

**`better-sqlite3` non riesce a compilare, `futex.h` non trovato:**
```bash
sudo apt-get install -y linux-headers-$(uname -r)
```

---

### Fedora / RHEL

**SELinux blocca i montaggi dei volumi Docker:**
```yaml
# Aggiungere etichetta :Z per il contesto SELinux
volumes:
  - ./my-config:/app/config:Z
```
O impostare il contesto SELinux manualmente:
```bash
chcon -Rt svirt_sandbox_file_t ./my-config
```

---

### Arch Linux

**Versione di Node.js troppo vecchia:**
Usare `nvm` per installare Node.js 22:
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

**Docker Desktop esaurisce la memoria:**
Aprire Docker Desktop → Impostazioni → Risorse → Memoria. Aumentare ad almeno 4 GB.

**Apple Silicon — incompatibilità di architettura:**
Verificare che l'installazione di Node.js sia ARM64 nativo (non Rosetta):
```bash
node -e "console.log(process.arch)"
# atteso: arm64
```
Se stampa `x64`, reinstallare Node.js usando il programma di installazione ARM64 da nodejs.org.

---

### Windows (nativo)

**`MSBuild` o `cl.exe` non trovato:**
Installare [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) e selezionare il carico di lavoro **Sviluppo desktop con C++**. Quindi eseguire:
```powershell
npm install --global windows-build-tools
```

**Errori di percorso lungo (`ENAMETOOLONG`):**
Abilitare il supporto per percorsi lunghi nel registro di Windows:
```powershell
# Eseguire come Amministratore
Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" `
  -Name LongPathsEnabled -Value 1
```

**Comando `sidjua` non trovato dopo `npm install -g`:**
Aggiungere la directory bin globale di npm al PATH:
```powershell
npm config get prefix  # mostra es. C:\Users\you\AppData\Roaming\npm
# Aggiungere quel percorso a Variabili di ambiente di sistema → Percorso
```

---

### Windows WSL2

**Docker non si avvia all'interno di WSL2:**
Aprire Docker Desktop → Impostazioni → Generale → abilitare **Usa il motore basato su WSL 2**.
Quindi riavviare Docker Desktop e il terminale WSL2.

**Errori di autorizzazione sui file sotto `/mnt/c/`:**
I volumi Windows NTFS montati in WSL2 hanno autorizzazioni limitate. Spostare lo spazio di lavoro in un percorso nativo Linux:
```bash
mkdir ~/sidjua-workspace
cd ~/sidjua-workspace
sidjua init
```

---

### Raspberry Pi / ARM64

**`npm ci` è molto lento (5-10 minuti):**
Questo è normale. La compilazione degli addon nativi su ARM64 richiede più tempo. Considerare invece l'utilizzo dell'immagine Docker:
```bash
docker pull sidjua/sidjua:latest-arm64
```

**Memoria esaurita durante la build:**
Aggiungere spazio di swap:
```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

---

## 11. Riferimento Volumi Docker

### Volumi con Nome

| Nome del Volume | Percorso nel Container | Scopo |
|-------------|---------------|---------|
| `sidjua-data` | `/app/data` | Database SQLite, archivi di backup, raccolte di conoscenze |
| `sidjua-config` | `/app/config` | `divisions.yaml`, configurazione personalizzata |
| `sidjua-logs` | `/app/logs` | Log dell'applicazione strutturati |
| `sidjua-system` | `/app/.system` | Chiave API, stato aggiornamento, file di blocco del processo |
| `sidjua-workspace` | `/app/agents` | Directory delle competenze degli agenti, definizioni, modelli |
| `sidjua-governance` | `/app/governance` | Registro di audit immutabile, snapshot di governance |
| `qdrant-storage` | `/qdrant/storage` | Indice vettoriale Qdrant (solo profilo di ricerca semantica) |

### Utilizzo di una Directory dell'Host

Per montare il proprio `divisions.yaml` invece di modificarlo all'interno del container:

```yaml
# docker-compose.override.yml
services:
  sidjua:
    volumes:
      - ./my-config:/app/config   # sostituisce il volume con nome sidjua-config
```

### Backup

```bash
sidjua backup create                    # dall'interno del container
# o
docker compose exec sidjua sidjua backup create
```

I backup sono archivi firmati con HMAC archiviati in `/app/data/backups/`.

---

## 12. Aggiornamento

### Docker

```bash
git pull
docker compose build --no-cache
docker compose up -d
docker compose exec sidjua sidjua apply    # eseguire le migrazioni dello schema
```

`sidjua apply` è idempotente — sempre sicuro da rieseguire dopo un aggiornamento.

### Installazione Globale npm

```bash
npm update -g sidjua
sidjua apply    # eseguire le migrazioni dello schema
```

### Build dal Sorgente

```bash
git pull
npm ci
npm run build
node dist/index.js apply    # eseguire le migrazioni dello schema
```

### Rollback

SIDJUA crea uno snapshot di governance prima di ogni `sidjua apply`. Per ripristinare:

```bash
sidjua rollback list
sidjua rollback <version>
```

---

## 13. Prossimi Passi

| Risorsa | Comando / Link |
|----------|---------------|
| Avvio Rapido | [docs/QUICK-START.md](QUICK-START.md) |
| Riferimento CLI | [docs/CLI-REFERENCE.md](CLI-REFERENCE.md) |
| Esempi di Governance | [docs/GOVERNANCE-EXAMPLES.md](GOVERNANCE-EXAMPLES.md) |
| Guida ai Provider LLM Gratuiti | [docs/FREE-LLM-PROVIDER-GUIDE.md](FREE-LLM-PROVIDER-GUIDE.md) |
| Risoluzione dei Problemi | [docs/TROUBLESHOOTING.md](TROUBLESHOOTING.md) |

Primi comandi da eseguire dopo l'installazione:

```bash
sidjua chat guide    # guida IA senza configurazione — nessuna chiave API richiesta
sidjua selftest      # controllo dello stato di salute del sistema (7 categorie, punteggio 0-100)
sidjua apply         # provisioning degli agenti da divisions.yaml
```
