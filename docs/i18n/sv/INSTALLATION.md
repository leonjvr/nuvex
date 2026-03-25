> Det här dokumentet har automatiskt översatts av AI från [det engelska originalet](../INSTALLATION.md). Hittade du ett fel? [Rapportera det](https://github.com/GoetzKohlberg/sidjua/issues).

# SIDJUA Installationsguide

SIDJUA version: 1.0.0 | Licens: AGPL-3.0-only | Uppdaterad: 2026-03-25

## Innehållsförteckning

1. [Plattformsstödmatris](#1-plattformsstödmatris)
2. [Förutsättningar](#2-förutsättningar)
3. [Installationsmetoder](#3-installationsmetoder)
4. [Katalogstruktur](#4-katalogstruktur)
5. [Miljövariabler](#5-miljövariabler)
6. [Leverantörskonfiguration](#6-leverantörskonfiguration)
7. [Skrivbordsapplikation (valfritt)](#7-skrivbordsapplikation-valfritt)
8. [Agentisolering](#8-agentisolering)
9. [Semantisk sökning (valfritt)](#9-semantisk-sökning-valfritt)
10. [Felsökning](#10-felsökning)
11. [Docker-volymreferens](#11-docker-volymreferens)
12. [Uppgradering](#12-uppgradering)
13. [Nästa steg](#13-nästa-steg)

---

## 1. Plattformsstödmatris

| Funktion | Linux | macOS | Windows WSL2 | Windows (nativt) |
|---------|-------|-------|--------------|-----------------|
| CLI + REST API | ✅ Fullt | ✅ Fullt | ✅ Fullt | ✅ Fullt |
| Docker | ✅ Fullt | ✅ Docker Desktop | ✅ Docker Desktop | ✅ Docker Desktop |
| Isolering (bubblewrap) | ✅ Fullt | ❌ Faller tillbaka till `none` | ✅ Fullt (inuti WSL2) | ❌ Faller tillbaka till `none` |
| Web Management Console | ✅ Full | ✅ Full | ✅ Full | ✅ Full |
| Semantisk sökning (Qdrant) | ✅ | ✅ | ✅ | ✅ |

**Obs om bubblewrap:** Isolering med Linux-användarnamnrymder. macOS och Windows (nativt) faller automatiskt tillbaka till isoleringsläget `none` — ingen konfiguration behövs.

---

## 2. Förutsättningar

### Node.js >= 22.0.0

**Varför:** SIDJUA använder ES-moduler, nativ `fetch()` och `crypto.subtle` — allt kräver Node.js 22+.

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

**macOS (.pkg-installationsprogram):** Ladda ned från [nodejs.org/en/download](https://nodejs.org/en/download).

**Windows (winget):**
```powershell
winget install OpenJS.NodeJS.LTS
```

**Windows (.msi):** Ladda ned från [nodejs.org/en/download](https://nodejs.org/en/download).

**WSL2:** Använd Ubuntu/Debian-instruktionerna ovan i din WSL2-terminal.

Verifiera:
```bash
node --version   # måste vara >= 22.0.0
npm --version    # måste vara >= 10.0.0
```

---

### C/C++-verktygskedja (endast för källkodsbyggen)

**Varför:** `better-sqlite3` och `argon2` kompilerar nativa Node.js-tillägg under `npm ci`. Docker-användare kan hoppa över detta.

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

**Windows:** Installera [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) med arbetsbelastningen **Skrivbordsutveckling med C++**, sedan:
```powershell
npm install --global windows-build-tools
```

**Alpine Linux:**
```bash
apk add python3 make g++ build-base linux-headers
```

---

### Docker >= 24 (valfritt)

Krävs endast för Docker-installationsmetoden. Plugin-programmet Docker Compose V2 (`docker compose`) måste vara tillgängligt.

**Linux:** Följ instruktionerna på [docs.docker.com/engine/install](https://docs.docker.com/engine/install/).
Docker Compose V2 ingår i Docker Engine >= 24.

**macOS / Windows:** Installera [Docker Desktop](https://www.docker.com/products/docker-desktop/) (inkluderar Docker Compose V2).

Verifiera:
```bash
docker --version          # måste vara >= 24.0.0
docker compose version    # måste visa v2.x.x
```

---

### Git

Vilken nylig version som helst. Installera via ditt operativsystems pakethanterare eller från [git-scm.com](https://git-scm.com).

---

## 3. Installationsmetoder

### Metod A — Docker (rekommenderas)

Den snabbaste vägen till en fungerande SIDJUA-installation. Alla beroenden är inkluderade i avbildningen.

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
docker compose up -d
```

Vänta tills tjänsterna blir friska (upp till ~60 sekunder vid första bygget):

```bash
docker compose ps
# NAME              STATUS
# sidjua            Up X seconds (healthy)
# sidjua-qdrant     Up X seconds (healthy)
```

Hämta den automatiskt genererade API-nyckeln:

```bash
docker compose exec sidjua cat /app/.system/api-key
```

Initiera styrning från din `divisions.yaml`:

```bash
docker compose exec sidjua sidjua apply --verbose
```

Kör systemhälsokontrollen:

```bash
docker compose exec sidjua sidjua selftest
```

**ARM64-notering:** Docker-avbildningen är byggd på `node:22-alpine` som stöder `linux/amd64` och `linux/arm64`. Raspberry Pi (64-bitars) och Apple Silicon Mac-datorer (via Docker Desktop) stöds direkt.

**Bubblewrap i Docker:** För att aktivera agentisolering inuti containern, lägg till `--cap-add=SYS_ADMIN` i din Docker-körningskommando eller ange det i `docker-compose.yml`:
```yaml
cap_add:
  - SYS_ADMIN
```

---

### Metod B — Global npm-installation

```bash
npm install -g sidjua
```

Kör den interaktiva installationsguiden (3 steg: arbetsytans plats, leverantör, första agent):
```bash
sidjua init
```

För icke-interaktiva CI- eller containermiljöer:
```bash
sidjua init --yes
```

Starta AI-guiden utan konfiguration (ingen API-nyckel krävs):
```bash
sidjua chat guide
```

---

### Metod C — Källkodsbygge

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
npm ci
npm run build
```

Byggprocessen använder `tsup` för att kompilera `src/index.ts` till:
- `dist/index.js` (ESM)
- `dist/index.cjs` (CommonJS)

Steg efter bygget kopierar i18n-lokalfiler, standardroller, avdelningar och kunskapsbastmallar till `dist/`.

Kör från källkod:
```bash
node dist/index.js --help
```

Kör testsviten:
```bash
npm test                    # alla tester
npm run test:coverage       # med täckningsrapport
npx tsc --noEmit            # typkontroll endast
```

---

## 4. Katalogstruktur

### Docker-distributionssökvägar

| Sökväg | Docker-volym | Syfte | Hanteras av |
|--------|-------------|-------|-------------|
| `/app/dist/` | Avbildningslager | Kompilerad applikation | SIDJUA |
| `/app/node_modules/` | Avbildningslager | Node.js-beroenden | SIDJUA |
| `/app/system/` | Avbildningslager | Inbyggda standardvärden och mallar | SIDJUA |
| `/app/defaults/` | Avbildningslager | Standardkonfigurationsfiler | SIDJUA |
| `/app/docs/` | Avbildningslager | Medföljande dokumentation | SIDJUA |
| `/app/data/` | `sidjua-data` | SQLite-databaser, säkerhetskopior, kunskapssamlingar | Användare |
| `/app/config/` | `sidjua-config` | `divisions.yaml` och anpassad konfiguration | Användare |
| `/app/logs/` | `sidjua-logs` | Strukturerade loggfiler | Användare |
| `/app/.system/` | `sidjua-system` | API-nyckel, uppdateringstillstånd, processlås | Hanteras av SIDJUA |
| `/app/agents/` | `sidjua-workspace` | Agentdefinitioner, färdigheter, mallar | Användare |
| `/app/governance/` | `sidjua-governance` | Granskningslogg, styrningsögonblicksbilder | Användare |

---

### Manuella / npm-installationssökvägar

Efter `sidjua init` är din arbetsyta organiserad som:

```
~/sidjua-workspace/           # eller SIDJUA_CONFIG_DIR
├── divisions.yaml            # Din styrningskonfiguration
├── .sidjua/                  # Internt tillstånd (WAL, telemetribuffert)
│   └── telemetry.db
├── data/
│   ├── sidjua.db             # Huvuddatabas (agenter, uppgifter, granskning, kostnader)
│   ├── knowledge/            # Kunskapsdatabaser per agent
│   │   └── <agent-id>.db
│   └── backups/              # HMAC-signerade säkerhetskopieringsarkiv
├── agents/                   # Agentfärdighetskataloger
├── governance/               # Granskningslogg (endast tillägg)
├── logs/                     # Applikationsloggar
└── system/                   # Körningsläge
```

---

### SQLite-databaser

| Databas | Sökväg | Innehåll |
|---------|--------|----------|
| Huvud | `data/sidjua.db` | Agenter, uppgifter, kostnader, styrningsögonblicksbilder, API-nycklar, granskningslogg |
| Telemetri | `.sidjua/telemetry.db` | Valfria felrapporter med samtycke (PII-redigerade) |
| Kunskap | `data/knowledge/<agent-id>.db` | Vektorinbäddningar per agent och BM25-index |

SQLite-databaser är enfils-, plattformsoberoende och portabla. Säkerhetskopiera dem med `sidjua backup create`.

---

## 5. Miljövariabler

Kopiera `.env.example` till `.env` och anpassa. Alla variabler är valfria om inget annat anges.

### Server

| Variabel | Standard | Beskrivning |
|---------|---------|-------------|
| `SIDJUA_PORT` | `3000` | REST API-lyssningsport |
| `SIDJUA_HOST` | `127.0.0.1` | REST API-bindningsadress. Använd `0.0.0.0` för fjärråtkomst |
| `NODE_ENV` | `production` | Körningsläge (`production` eller `development`) |
| `SIDJUA_API_KEY` | Autogenererad | REST API-bärartoken. Skapas automatiskt vid första start om den saknas |
| `SIDJUA_MAX_BODY_SIZE` | `2097152` (2 MiB) | Maximal inkommande begäransdatastorlek i byte |

### Katalogsöverskridningar

| Variabel | Standard | Beskrivning |
|---------|---------|-------------|
| `SIDJUA_DATA_DIR` | `<workspace>/data` | Åsidosätt datakatalogplats |
| `SIDJUA_CONFIG_DIR` | `<workspace>` | Åsidosätt konfigurationskatalogplats |
| `SIDJUA_LOG_DIR` | `<workspace>/logs` | Åsidosätt loggkatalogplats |

### Semantisk sökning

| Variabel | Standard | Beskrivning |
|---------|---------|-------------|
| `SIDJUA_QDRANT_URL` | `http://localhost:6333` | Qdrant-vektordatabasändpunkt. Docker-standard: `http://qdrant:6333` |
| `OPENAI_API_KEY` | — | Krävs för OpenAI `text-embedding-3-large`-inbäddningar |
| `SIDJUA_CF_ACCOUNT_ID` | — | Cloudflare-konto-ID för gratis inbäddningar |
| `SIDJUA_CF_TOKEN` | — | Cloudflare API-token för gratis inbäddningar |

### LLM-leverantörer

| Variabel | Leverantör |
|---------|-----------|
| `ANTHROPIC_API_KEY` | Anthropic (Claude) |
| `OPENAI_API_KEY` | OpenAI (GPT-4, inbäddningar) |
| `GOOGLE_AI_API_KEY` | Google AI (Gemini) |
| `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` | Cloudflare Workers AI (gratisnivå) |
| `GROQ_API_KEY` | Groq (snabb inferens, gratisnivå tillgänglig) |
| `DEEPSEEK_API_KEY` | DeepSeek |

---

## 6. Leverantörskonfiguration

### Alternativ utan konfiguration

`sidjua chat guide` fungerar utan API-nyckel. Den ansluter till Cloudflare Workers AI via SIDJUA-proxyn. Hastighetsbegränsad men lämplig för utvärdering och introduktion.

### Lägga till din första leverantör

**Groq (gratisnivå, inget kreditkort krävs):**
```bash
sidjua key set groq <your-groq-api-key>
sidjua provider list
```
Hämta en gratisnyckel på [console.groq.com](https://console.groq.com).

**Anthropic (rekommenderas för produktion):**
```bash
export ANTHROPIC_API_KEY=sk-ant-...
sidjua key set anthropic $ANTHROPIC_API_KEY
```

**Ollama (luftgap / lokal driftsättning):**
```bash
sidjua provider add-custom \
  --id ollama \
  --name "Ollama (local)" \
  --base-url http://localhost:11434/v1 \
  --model llama3.2
```

Validera alla konfigurerade leverantörer:
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

## 8. Agentisolering

SIDJUA använder ett utbyggbart `SandboxProvider`-gränssnitt. Sandlådan omger agentfärdighetsexekvering med processisolering på OS-nivå.

### Isoleringstöd per plattform

| Plattform | Isoleringslevantör | Anteckningar |
|-----------|-------------------|-------------|
| Linux (nativt) | `bubblewrap` | Fullständig användarnamnrymdisolering |
| Docker (Linux-container) | `bubblewrap` | Kräver `--cap-add=SYS_ADMIN` |
| macOS | `none` (automatisk reserv) | macOS stöder inte Linux-användarnamnrymder |
| Windows WSL2 | `bubblewrap` | Installera som på Linux inuti WSL2 |
| Windows (nativt) | `none` (automatisk reserv) | |

### Installera bubblewrap (Linux)

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

### Konfiguration

I `divisions.yaml`:
```yaml
governance:
  sandbox: bubblewrap    # eller: none
```

Verifiera sandlådetillgänglighet:
```bash
sidjua sandbox check
```

---

## 9. Semantisk sökning (valfritt)

Semantisk sökning driver `sidjua memory search` och agentkunskapshämtning. Det kräver en Qdrant-vektordatabas och en inbäddningsleverantör.

### Docker Compose-profil

Den medföljande `docker-compose.yml` har en `semantic-search`-profil:
```bash
docker compose --profile semantic-search up -d
```
Detta startar en Qdrant-container vid sidan av SIDJUA.

### Fristående Qdrant

```bash
docker run -d \
  --name sidjua-qdrant \
  -p 6333:6333 \
  -v qdrant-storage:/qdrant/storage \
  qdrant/qdrant:v1.13.2
```

Ange ändpunkten:
```bash
export SIDJUA_QDRANT_URL=http://localhost:6333
```

### Utan Qdrant

Om Qdrant inte är tillgängligt inaktiveras `sidjua memory import` och `sidjua memory search`. Alla andra SIDJUA-funktioner (CLI, REST API, agentexekvering, styrning, granskning) fungerar normalt. Systemet faller tillbaka till BM25-nyckelordssökning för kunskapsfrågor.

---

## 10. Felsökning

### Alla plattformar

**`npm ci` misslyckas med `node-pre-gyp`- eller `node-gyp`-fel:**
```
gyp ERR! build error
```
Installera C/C++-verktygskedjan (se avsnittet Förutsättningar). På Ubuntu: `sudo apt-get install -y python3 make g++ build-essential`.

**`Cannot find divisions.yaml`:**
Kontrollera `SIDJUA_CONFIG_DIR`. Filen måste finnas på `$SIDJUA_CONFIG_DIR/divisions.yaml`. Kör `sidjua init` för att skapa arbetsytans struktur.

**REST API returnerar 401 Unauthorized:**
Verifiera `Authorization: Bearer <key>`-rubriken. Hämta den autogenererade nyckeln med:
```bash
cat ~/.sidjua/.system/api-key          # manuell installation
docker compose exec sidjua cat /app/.system/api-key  # Docker
```

**Port 3000 används redan:**
```bash
SIDJUA_PORT=3001 sidjua server start
# eller ange i .env: SIDJUA_PORT=3001
```

---

### Ubuntu / Debian

**`better-sqlite3` kompilerar inte, `futex.h` hittades inte:**
```bash
sudo apt-get install -y linux-headers-$(uname -r)
```

---

### Fedora / RHEL

**SELinux blockerar Docker-volymmonteringar:**
```yaml
# Lägg till :Z-etikett för SELinux-kontext
volumes:
  - ./my-config:/app/config:Z
```
Eller ange SELinux-kontexten manuellt:
```bash
chcon -Rt svirt_sandbox_file_t ./my-config
```

---

### Arch Linux

**Node.js-versionen är för gammal:**
Använd `nvm` för att installera Node.js 22:
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

**Docker Desktop får slut på minne:**
Öppna Docker Desktop → Inställningar → Resurser → Minne. Öka till minst 4 GB.

**Apple Silicon — arkitekturmismatch:**
Kontrollera att din Node.js-installation är nativ ARM64 (inte Rosetta):
```bash
node -e "console.log(process.arch)"
# förväntat: arm64
```
Om det skriver ut `x64`, installera om Node.js med ARM64-installationsprogrammet från nodejs.org.

---

### Windows (nativt)

**`MSBuild` eller `cl.exe` hittades inte:**
Installera [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) och välj arbetsbelastningen **Skrivbordsutveckling med C++**. Kör sedan:
```powershell
npm install --global windows-build-tools
```

**Långa sökvägsfel (`ENAMETOOLONG`):**
Aktivera stöd för långa sökvägar i Windows-registret:
```powershell
# Kör som administratör
Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" `
  -Name LongPathsEnabled -Value 1
```

**Kommandot `sidjua` hittades inte efter `npm install -g`:**
Lägg till npm:s globala bin-katalog i din PATH:
```powershell
npm config get prefix  # visar t.ex. C:\Users\you\AppData\Roaming\npm
# Lägg till den sökvägen i Systemmiljövariabler → Path
```

---

### Windows WSL2

**Docker startar inte inuti WSL2:**
Öppna Docker Desktop → Inställningar → Allmänt → aktivera **Use the WSL 2 based engine**.
Starta sedan om Docker Desktop och din WSL2-terminal.

**Behörighetsfel på filer under `/mnt/c/`:**
Windows NTFS-volymer monterade i WSL2 har begränsade behörigheter. Flytta din arbetsyta till en Linux-nativ sökväg:
```bash
mkdir ~/sidjua-workspace
cd ~/sidjua-workspace
sidjua init
```

---

### Raspberry Pi / ARM64

**`npm ci` är mycket långsamt (5-10 minuter):**
Detta är normalt. Nativ tilläggscompilering på ARM64 tar längre tid. Överväg att använda Docker-avbildningen istället:
```bash
docker pull sidjua/sidjua:latest-arm64
```

**Slut på minne under bygget:**
Lägg till växelminne:
```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

---

## 11. Docker-volymreferens

### Namngivna volymer

| Volymnamn | Containersökväg | Syfte |
|-----------|----------------|-------|
| `sidjua-data` | `/app/data` | SQLite-databaser, säkerhetskopieringsarkiv, kunskapssamlingar |
| `sidjua-config` | `/app/config` | `divisions.yaml`, anpassad konfiguration |
| `sidjua-logs` | `/app/logs` | Strukturerade applikationsloggar |
| `sidjua-system` | `/app/.system` | API-nyckel, uppdateringstillstånd, processlåsfil |
| `sidjua-workspace` | `/app/agents` | Agentfärdighetskataloger, definitioner, mallar |
| `sidjua-governance` | `/app/governance` | Oföränderlig granskningslogg, styrningsögonblicksbilder |
| `qdrant-storage` | `/qdrant/storage` | Qdrant-vektorindex (endast semantisk sökning-profil) |

### Använda en värdkatalog

För att montera din egen `divisions.yaml` istället för att redigera inuti containern:

```yaml
# docker-compose.override.yml
services:
  sidjua:
    volumes:
      - ./my-config:/app/config   # ersätter den namngivna volymen sidjua-config
```

### Säkerhetskopiering

```bash
sidjua backup create                    # inifrån containern
# eller
docker compose exec sidjua sidjua backup create
```

Säkerhetskopior är HMAC-signerade arkiv lagrade i `/app/data/backups/`.

---

## 12. Uppgradering

### Docker

```bash
git pull
docker compose build --no-cache
docker compose up -d
docker compose exec sidjua sidjua apply    # kör schemamigrationer
```

`sidjua apply` är idempotent — alltid säkert att köra om efter en uppgradering.

### Global npm-installation

```bash
npm update -g sidjua
sidjua apply    # kör schemamigrationer
```

### Källkodsbygge

```bash
git pull
npm ci
npm run build
node dist/index.js apply    # kör schemamigrationer
```

### Återställning

SIDJUA skapar en styrningsögonblicksbild före varje `sidjua apply`. För att återgå:

```bash
sidjua rollback list
sidjua rollback <version>
```

---

## 13. Nästa steg

| Resurs | Kommando / Länk |
|--------|----------------|
| Snabbstart | [docs/QUICK-START.md](QUICK-START.md) |
| CLI-referens | [docs/CLI-REFERENCE.md](CLI-REFERENCE.md) |
| Styrningsexempel | [docs/GOVERNANCE-EXAMPLES.md](GOVERNANCE-EXAMPLES.md) |
| Guide för gratis LLM-leverantörer | [docs/FREE-LLM-PROVIDER-GUIDE.md](FREE-LLM-PROVIDER-GUIDE.md) |
| Felsökning | [docs/TROUBLESHOOTING.md](TROUBLESHOOTING.md) |

Första kommandon att köra efter installationen:

```bash
sidjua chat guide    # AI-guide utan konfiguration — ingen API-nyckel behövs
sidjua selftest      # systemhälsokontroll (7 kategorier, poäng 0-100)
sidjua apply         # provisionera agenter från divisions.yaml
```
