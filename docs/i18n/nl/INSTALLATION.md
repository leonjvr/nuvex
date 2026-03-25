> Dit document is AI-vertaald vanuit het [Engelse origineel](../INSTALLATION.md). Een fout gevonden? [Meld het](https://github.com/GoetzKohlberg/sidjua/issues).

# SIDJUA Installatiegids

SIDJUA versie: 1.0.0 | Licentie: AGPL-3.0-only | Bijgewerkt: 2026-03-25

## Inhoudsopgave

1. [Platformondersteuningsmatrix](#1-platformondersteuningsmatrix)
2. [Vereisten](#2-vereisten)
3. [Installatiemethoden](#3-installatiemethoden)
4. [Mapstructuur](#4-mapstructuur)
5. [Omgevingsvariabelen](#5-omgevingsvariabelen)
6. [Providerconfiguratie](#6-providerconfiguratie)
7. [Desktop-GUI (Optioneel)](#7-desktop-gui-optioneel)
8. [Agent-sandboxing](#8-agent-sandboxing)
9. [Semantisch Zoeken (Optioneel)](#9-semantisch-zoeken-optioneel)
10. [Probleemoplossing](#10-probleemoplossing)
11. [Docker-volumereferentie](#11-docker-volumereferentie)
12. [Upgraden](#12-upgraden)
13. [Volgende Stappen](#13-volgende-stappen)

---

## 1. Platformondersteuningsmatrix

| Functie | Linux | macOS | Windows WSL2 | Windows (native) |
|---------|-------|-------|--------------|------------------|
| CLI + REST API | ✅ Volledig | ✅ Volledig | ✅ Volledig | ✅ Volledig |
| Docker | ✅ Volledig | ✅ Docker Desktop | ✅ Docker Desktop | ✅ Docker Desktop |
| Sandboxing (bubblewrap) | ✅ Volledig | ❌ Valt terug op `none` | ✅ Volledig (binnen WSL2) | ❌ Valt terug op `none` |
| Web Management Console | ✅ Full | ✅ Full | ✅ Full | ✅ Full |
| Semantisch Zoeken (Qdrant) | ✅ | ✅ | ✅ | ✅ |

**Opmerking over bubblewrap:** Linux-gebruikersnamespace-sandboxing. macOS en Windows native vallen automatisch terug op sandboxmodus `none` — geen configuratie vereist.

---

## 2. Vereisten

### Node.js >= 22.0.0

**Waarom:** SIDJUA gebruikt ES-modules, native `fetch()` en `crypto.subtle` — dit alles vereist Node.js 22+.

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

**macOS (.pkg-installatieprogramma):** Downloaden van [nodejs.org/en/download](https://nodejs.org/en/download).

**Windows (winget):**
```powershell
winget install OpenJS.NodeJS.LTS
```

**Windows (.msi):** Downloaden van [nodejs.org/en/download](https://nodejs.org/en/download).

**WSL2:** Gebruik de Ubuntu/Debian-instructies hierboven in uw WSL2-terminal.

Verifiëren:
```bash
node --version   # moet >= 22.0.0 zijn
npm --version    # moet >= 10.0.0 zijn
```

---

### C/C++-toolchain (alleen voor bronbuilds)

**Waarom:** `better-sqlite3` en `argon2` compileren native Node.js-add-ons tijdens `npm ci`. Docker-gebruikers slaan dit over.

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

**Windows:** Installeer [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) met de workload **Desktopontwikkeling met C++**, dan:
```powershell
npm install --global windows-build-tools
```

**Alpine Linux:**
```bash
apk add python3 make g++ build-base linux-headers
```

---

### Docker >= 24 (optioneel)

Alleen vereist voor de Docker-installatiemethode. De Docker Compose V2-plug-in (`docker compose`) moet beschikbaar zijn.

**Linux:** Volg de instructies op [docs.docker.com/engine/install](https://docs.docker.com/engine/install/).
Docker Compose V2 is inbegrepen bij Docker Engine >= 24.

**macOS / Windows:** Installeer [Docker Desktop](https://www.docker.com/products/docker-desktop/) (inclusief Docker Compose V2).

Verifiëren:
```bash
docker --version          # moet >= 24.0.0 zijn
docker compose version    # moet v2.x.x tonen
```

---

### Git

Elke recente versie. Installeer via uw OS-pakketbeheerder of [git-scm.com](https://git-scm.com).

---

## 3. Installatiemethoden

### Methode A — Docker (Aanbevolen)

De snelste manier om een werkende SIDJUA-installatie te krijgen. Alle afhankelijkheden zijn gebundeld in de image.

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
docker compose up -d
```

Wacht tot de services gezond worden (tot ~60 seconden bij de eerste build):

```bash
docker compose ps
# NAME              STATUS
# sidjua            Up X seconds (healthy)
# sidjua-qdrant     Up X seconds (healthy)
```

De automatisch gegenereerde API-sleutel ophalen:

```bash
docker compose exec sidjua cat /app/.system/api-key
```

Governance initialiseren vanuit uw `divisions.yaml`:

```bash
docker compose exec sidjua sidjua apply --verbose
```

Systeemgezondheidscontrole uitvoeren:

```bash
docker compose exec sidjua sidjua selftest
```

**ARM64-opmerking:** De Docker-image is gebouwd op `node:22-alpine` die `linux/amd64` en `linux/arm64` ondersteunt. Raspberry Pi (64-bit) en Apple Silicon Macs (via Docker Desktop) worden standaard ondersteund.

**Bubblewrap in Docker:** Om agent-sandboxing binnen de container in te schakelen, voeg `--cap-add=SYS_ADMIN` toe aan uw Docker run-opdracht of stel het in in `docker-compose.yml`:
```yaml
cap_add:
  - SYS_ADMIN
```

---

### Methode B — Globale npm-installatie

```bash
npm install -g sidjua
```

De interactieve installatiewizard uitvoeren (3 stappen: werkruimtelocatie, provider, eerste agent):
```bash
sidjua init
```

Voor niet-interactieve CI- of containeromgevingen:
```bash
sidjua init --yes
```

De zero-config AI-gids starten (geen API-sleutel vereist):
```bash
sidjua chat guide
```

---

### Methode C — Bronbuild

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
npm ci
npm run build
```

Het bouwproces gebruikt `tsup` om `src/index.ts` te compileren naar:
- `dist/index.js` (ESM)
- `dist/index.cjs` (CommonJS)

Na-bouwstappen kopiëren i18n-localebestanden, standaardrollen, divisies en kennisbasistemplates naar `dist/`.

Uitvoeren vanuit bron:
```bash
node dist/index.js --help
```

De testsuite uitvoeren:
```bash
npm test                    # alle tests
npm run test:coverage       # met dekkingsrapport
npx tsc --noEmit            # alleen typecontrole
```

---

## 4. Mapstructuur

### Docker-implementatiepaden

| Pad | Docker-volume | Doel | Beheerd door |
|------|---------------|---------|------------|
| `/app/dist/` | Image-laag | Gecompileerde applicatie | SIDJUA |
| `/app/node_modules/` | Image-laag | Node.js-afhankelijkheden | SIDJUA |
| `/app/system/` | Image-laag | Ingebouwde standaarden en templates | SIDJUA |
| `/app/defaults/` | Image-laag | Standaard configuratiebestanden | SIDJUA |
| `/app/docs/` | Image-laag | Meegeleverde documentatie | SIDJUA |
| `/app/data/` | `sidjua-data` | SQLite-databases, back-ups, kennissameningen | Gebruiker |
| `/app/config/` | `sidjua-config` | `divisions.yaml` en aangepaste configuratie | Gebruiker |
| `/app/logs/` | `sidjua-logs` | Gestructureerde logbestanden | Gebruiker |
| `/app/.system/` | `sidjua-system` | API-sleutel, updatestatus, procesvergrendeling | Beheerd door SIDJUA |
| `/app/agents/` | `sidjua-workspace` | Agentdefinities, vaardigheden, templates | Gebruiker |
| `/app/governance/` | `sidjua-governance` | Audittrail, governance-snapshots | Gebruiker |

---

### Handmatige / npm-installatiepaden

Na `sidjua init` is uw werkruimte als volgt georganiseerd:

```
~/sidjua-workspace/           # of SIDJUA_CONFIG_DIR
├── divisions.yaml            # Uw governance-configuratie
├── .sidjua/                  # Interne status (WAL, telemetriebuffer)
│   └── telemetry.db
├── data/
│   ├── sidjua.db             # Hoofddatabase (agents, taken, audit, kosten)
│   ├── knowledge/            # Per-agent kennisdatabases
│   │   └── <agent-id>.db
│   └── backups/              # HMAC-ondertekende back-uparchieven
├── agents/                   # Agentvaardighedenmappen
├── governance/               # Audittrail (alleen toevoegen)
├── logs/                     # Applicatielogboeken
└── system/                   # Runtimestatus
```

---

### SQLite-databases

| Database | Pad | Inhoud |
|----------|------|----------|
| Hoofd | `data/sidjua.db` | Agents, taken, kosten, governance-snapshots, API-sleutels, auditlogboek |
| Telemetrie | `.sidjua/telemetry.db` | Optionele foutmeldingen met toestemming (met PII verwijderd) |
| Kennis | `data/knowledge/<agent-id>.db` | Per-agent vectorembeddings en BM25-index |

SQLite-databases zijn afzonderlijke bestanden, platformonafhankelijk en draagbaar. Maak er een back-up van met `sidjua backup create`.

---

## 5. Omgevingsvariabelen

Kopieer `.env.example` naar `.env` en pas aan. Alle variabelen zijn optioneel, tenzij anders vermeld.

### Server

| Variabele | Standaard | Beschrijving |
|----------|---------|-------------|
| `SIDJUA_PORT` | `3000` | REST API-luisterpoort |
| `SIDJUA_HOST` | `127.0.0.1` | REST API-bindadres. Gebruik `0.0.0.0` voor externe toegang |
| `NODE_ENV` | `production` | Runtimemodus (`production` of `development`) |
| `SIDJUA_API_KEY` | Automatisch gegenereerd | REST API-bearertoken. Automatisch aangemaakt bij eerste start als afwezig |
| `SIDJUA_MAX_BODY_SIZE` | `2097152` (2 MiB) | Maximale grootte van de inkomende aanvraagtekst in bytes |

### Mapoverschrijvingen

| Variabele | Standaard | Beschrijving |
|----------|---------|-------------|
| `SIDJUA_DATA_DIR` | `<workspace>/data` | Locatie van de gegevensmap overschrijven |
| `SIDJUA_CONFIG_DIR` | `<workspace>` | Locatie van de configuratiemap overschrijven |
| `SIDJUA_LOG_DIR` | `<workspace>/logs` | Locatie van de logmap overschrijven |

### Semantisch Zoeken

| Variabele | Standaard | Beschrijving |
|----------|---------|-------------|
| `SIDJUA_QDRANT_URL` | `http://localhost:6333` | Qdrant vectordatabase-eindpunt. Docker-standaard: `http://qdrant:6333` |
| `OPENAI_API_KEY` | — | Vereist voor OpenAI `text-embedding-3-large`-embeddings |
| `SIDJUA_CF_ACCOUNT_ID` | — | Cloudflare-account-ID voor gratis embeddings |
| `SIDJUA_CF_TOKEN` | — | Cloudflare API-token voor gratis embeddings |

### LLM-providers

| Variabele | Provider |
|----------|----------|
| `ANTHROPIC_API_KEY` | Anthropic (Claude) |
| `OPENAI_API_KEY` | OpenAI (GPT-4, embeddings) |
| `GOOGLE_AI_API_KEY` | Google AI (Gemini) |
| `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` | Cloudflare Workers AI (gratis laag) |
| `GROQ_API_KEY` | Groq (snelle inferentie, gratis laag beschikbaar) |
| `DEEPSEEK_API_KEY` | DeepSeek |

---

## 6. Providerconfiguratie

### Zero-config optie

`sidjua chat guide` werkt zonder API-sleutel. Het maakt verbinding met Cloudflare Workers AI via de SIDJUA-proxy. Snelheidsbegrensd maar geschikt voor evaluatie en onboarding.

### Uw Eerste Provider Toevoegen

**Groq (gratis laag, geen creditcard vereist):**
```bash
sidjua key set groq <your-groq-api-key>
sidjua provider list
```
Haal een gratis sleutel op bij [console.groq.com](https://console.groq.com).

**Anthropic (aanbevolen voor productie):**
```bash
export ANTHROPIC_API_KEY=sk-ant-...
sidjua key set anthropic $ANTHROPIC_API_KEY
```

**Ollama (air-gap / lokale implementatie):**
```bash
sidjua provider add-custom \
  --id ollama \
  --name "Ollama (local)" \
  --base-url http://localhost:11434/v1 \
  --model llama3.2
```

Alle geconfigureerde providers valideren:
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

## 8. Agent-sandboxing

SIDJUA gebruikt een pluggable `SandboxProvider`-interface. De sandbox omhult de uitvoering van agentvaardigheden in OS-niveau procesissolatie.

### Sandbox-ondersteuning per Platform

| Platform | Sandbox-provider | Opmerkingen |
|----------|-----------------|-------|
| Linux (native) | `bubblewrap` | Volledige gebruikersnamespace-isolatie |
| Docker (Linux-container) | `bubblewrap` | Vereist `--cap-add=SYS_ADMIN` |
| macOS | `none` (automatisch terugval) | macOS ondersteunt geen Linux-gebruikersnamespaces |
| Windows WSL2 | `bubblewrap` | Installeer zoals op Linux binnen WSL2 |
| Windows (native) | `none` (automatisch terugval) | |

### bubblewrap installeren (Linux)

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

### Configuratie

In `divisions.yaml`:
```yaml
governance:
  sandbox: bubblewrap    # of: none
```

Sandbox-beschikbaarheid verifiëren:
```bash
sidjua sandbox check
```

---

## 9. Semantisch Zoeken (Optioneel)

Semantisch zoeken ondersteunt `sidjua memory search` en het ophalen van agentkennis. Het vereist een Qdrant-vectordatabase en een embeddingprovider.

### Docker Compose-profiel

Het meegeleverde `docker-compose.yml` heeft een `semantic-search`-profiel:
```bash
docker compose --profile semantic-search up -d
```
Dit start een Qdrant-container naast SIDJUA.

### Zelfstandige Qdrant

```bash
docker run -d \
  --name sidjua-qdrant \
  -p 6333:6333 \
  -v qdrant-storage:/qdrant/storage \
  qdrant/qdrant:v1.13.2
```

Het eindpunt instellen:
```bash
export SIDJUA_QDRANT_URL=http://localhost:6333
```

### Zonder Qdrant

Als Qdrant niet beschikbaar is, zijn `sidjua memory import` en `sidjua memory search` uitgeschakeld. Alle andere SIDJUA-functies (CLI, REST API, agentuitvoering, governance, audit) werken normaal. Het systeem valt terug op BM25-trefwoordzoekacties voor kennisquery's.

---

## 10. Probleemoplossing

### Alle Platforms

**`npm ci` mislukt met `node-pre-gyp`- of `node-gyp`-fouten:**
```
gyp ERR! build error
```
Installeer de C/C++-toolchain (zie de sectie Vereisten). Op Ubuntu: `sudo apt-get install -y python3 make g++ build-essential`.

**`Cannot find divisions.yaml`:**
Controleer `SIDJUA_CONFIG_DIR`. Het bestand moet zich bevinden op `$SIDJUA_CONFIG_DIR/divisions.yaml`. Voer `sidjua init` uit om de werkruimtestructuur te maken.

**REST API geeft 401 Unauthorized terug:**
Verifieer de `Authorization: Bearer <key>`-header. Haal de automatisch gegenereerde sleutel op met:
```bash
cat ~/.sidjua/.system/api-key          # handmatige installatie
docker compose exec sidjua cat /app/.system/api-key  # Docker
```

**Poort 3000 al in gebruik:**
```bash
SIDJUA_PORT=3001 sidjua server start
# of instellen in .env: SIDJUA_PORT=3001
```

---

### Ubuntu / Debian

**`better-sqlite3` compileert niet, `futex.h` niet gevonden:**
```bash
sudo apt-get install -y linux-headers-$(uname -r)
```

---

### Fedora / RHEL

**SELinux blokkeert Docker-volume-mounts:**
```yaml
# Voeg :Z-label toe voor SELinux-context
volumes:
  - ./my-config:/app/config:Z
```
Of stel de SELinux-context handmatig in:
```bash
chcon -Rt svirt_sandbox_file_t ./my-config
```

---

### Arch Linux

**Node.js-versie te oud:**
Gebruik `nvm` om Node.js 22 te installeren:
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

**Docker Desktop heeft onvoldoende geheugen:**
Open Docker Desktop → Instellingen → Resources → Geheugen. Verhoog naar minimaal 4 GB.

**Apple Silicon — architectuurmismatch:**
Verifieer dat uw Node.js-installatie native ARM64 is (niet Rosetta):
```bash
node -e "console.log(process.arch)"
# verwacht: arm64
```
Als het `x64` afdrukt, herinstalleer Node.js met het ARM64-installatieprogramma van nodejs.org.

---

### Windows (native)

**`MSBuild` of `cl.exe` niet gevonden:**
Installeer [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) en selecteer de workload **Desktopontwikkeling met C++**. Voer dan uit:
```powershell
npm install --global windows-build-tools
```

**Lange padfouten (`ENAMETOOLONG`):**
Schakel ondersteuning voor lange paden in het Windows-register in:
```powershell
# Uitvoeren als Beheerder
Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" `
  -Name LongPathsEnabled -Value 1
```

**`sidjua`-opdracht niet gevonden na `npm install -g`:**
Voeg de globale npm-bin-map toe aan uw PATH:
```powershell
npm config get prefix  # toont bijv. C:\Users\you\AppData\Roaming\npm
# Voeg dat pad toe aan Systeemomgevingsvariabelen → Pad
```

---

### Windows WSL2

**Docker start niet binnen WSL2:**
Open Docker Desktop → Instellingen → Algemeen → schakel **De op WSL 2 gebaseerde engine gebruiken** in.
Start vervolgens Docker Desktop en uw WSL2-terminal opnieuw op.

**Machtigingsfouten op bestanden onder `/mnt/c/`:**
Windows NTFS-volumes die in WSL2 zijn gekoppeld, hebben beperkte machtigingen. Verplaats uw werkruimte naar een Linux-native pad:
```bash
mkdir ~/sidjua-workspace
cd ~/sidjua-workspace
sidjua init
```

---

### Raspberry Pi / ARM64

**`npm ci` is erg traag (5-10 minuten):**
Dit is normaal. Compilatie van native add-ons op ARM64 duurt langer. Overweeg in plaats daarvan de Docker-image te gebruiken:
```bash
docker pull sidjua/sidjua:latest-arm64
```

**Onvoldoende geheugen tijdens de build:**
Wisselruimte toevoegen:
```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

---

## 11. Docker-volumereferentie

### Benoemde Volumes

| Volumenaam | Containerpad | Doel |
|-------------|---------------|---------|
| `sidjua-data` | `/app/data` | SQLite-databases, back-uparchieven, kennissamelingen |
| `sidjua-config` | `/app/config` | `divisions.yaml`, aangepaste configuratie |
| `sidjua-logs` | `/app/logs` | Gestructureerde applicatielogboeken |
| `sidjua-system` | `/app/.system` | API-sleutel, updatestatus, procesvergrendelingsbestand |
| `sidjua-workspace` | `/app/agents` | Agentvaardighedenmappen, definities, templates |
| `sidjua-governance` | `/app/governance` | Onveranderlijke audittrail, governance-snapshots |
| `qdrant-storage` | `/qdrant/storage` | Qdrant-vectorindex (alleen semantisch zoekprofiel) |

### Een Hostmap Gebruiken

Om uw eigen `divisions.yaml` te koppelen in plaats van het binnen de container te bewerken:

```yaml
# docker-compose.override.yml
services:
  sidjua:
    volumes:
      - ./my-config:/app/config   # vervangt het benoemde sidjua-config-volume
```

### Back-up

```bash
sidjua backup create                    # vanuit de container
# of
docker compose exec sidjua sidjua backup create
```

Back-ups zijn HMAC-ondertekende archieven opgeslagen in `/app/data/backups/`.

---

## 12. Upgraden

### Docker

```bash
git pull
docker compose build --no-cache
docker compose up -d
docker compose exec sidjua sidjua apply    # schemamigraties uitvoeren
```

`sidjua apply` is idempotent — altijd veilig om opnieuw uit te voeren na een upgrade.

### Globale npm-installatie

```bash
npm update -g sidjua
sidjua apply    # schemamigraties uitvoeren
```

### Bronbuild

```bash
git pull
npm ci
npm run build
node dist/index.js apply    # schemamigraties uitvoeren
```

### Terugdraaien

SIDJUA maakt een governance-snapshot voor elke `sidjua apply`. Om terug te draaien:

```bash
sidjua rollback list
sidjua rollback <version>
```

---

## 13. Volgende Stappen

| Bron | Opdracht / Link |
|----------|---------------|
| Snelle Start | [docs/QUICK-START.md](QUICK-START.md) |
| CLI-referentie | [docs/CLI-REFERENCE.md](CLI-REFERENCE.md) |
| Governance-voorbeelden | [docs/GOVERNANCE-EXAMPLES.md](GOVERNANCE-EXAMPLES.md) |
| Gids voor Gratis LLM-providers | [docs/FREE-LLM-PROVIDER-GUIDE.md](FREE-LLM-PROVIDER-GUIDE.md) |
| Probleemoplossing | [docs/TROUBLESHOOTING.md](TROUBLESHOOTING.md) |

Eerste opdrachten om uit te voeren na de installatie:

```bash
sidjua chat guide    # zero-config AI-gids — geen API-sleutel nodig
sidjua selftest      # systeemgezondheidscontrole (7 categorieën, score 0-100)
sidjua apply         # agents inrichten vanuit divisions.yaml
```
