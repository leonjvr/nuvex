> Ang dokumentong ito ay isinalin ng AI mula sa [orihinal na Ingles](../INSTALLATION.md). Nakahanap ng error? [I-ulat ito](https://github.com/GoetzKohlberg/sidjua/issues).

# Gabay sa Pag-install ng SIDJUA

SIDJUA bersyon: 1.0.0 | Lisensya: AGPL-3.0-only | Na-update: 2026-03-25

## Talaan ng Nilalaman

1. [Matrix ng Suporta sa Platform](#1-matrix-ng-suporta-sa-platform)
2. [Mga Kinakailangan](#2-mga-kinakailangan)
3. [Mga Paraan ng Pag-install](#3-mga-paraan-ng-pag-install)
4. [Layout ng Direktoryo](#4-layout-ng-direktoryo)
5. [Mga Variable ng Kapaligiran](#5-mga-variable-ng-kapaligiran)
6. [Konfigurasyon ng Provider](#6-konfigurasyon-ng-provider)
7. [Desktop GUI (Opsyonal)](#7-desktop-gui-opsyonal)
8. [Sandboxing ng Agent](#8-sandboxing-ng-agent)
9. [Semantikong Paghahanap (Opsyonal)](#9-semantikong-paghahanap-opsyonal)
10. [Pag-aayos ng Mga Problema](#10-pag-aayos-ng-mga-problema)
11. [Sanggunian sa Docker Volume](#11-sanggunian-sa-docker-volume)
12. [Pag-upgrade](#12-pag-upgrade)
13. [Mga Susunod na Hakbang](#13-mga-susunod-na-hakbang)

---

## 1. Matrix ng Suporta sa Platform

| Tampok | Linux | macOS | Windows WSL2 | Windows (katutubong) |
|---------|-------|-------|--------------|------------------|
| CLI + REST API | ✅ Buo | ✅ Buo | ✅ Buo | ✅ Buo |
| Docker | ✅ Buo | ✅ Docker Desktop | ✅ Docker Desktop | ✅ Docker Desktop |
| Sandboxing (bubblewrap) | ✅ Buo | ❌ Fallback sa `none` | ✅ Buo (sa loob ng WSL2) | ❌ Fallback sa `none` |
| Web Management Console | ✅ Full | ✅ Full | ✅ Full | ✅ Full |
| Semantikong Paghahanap (Qdrant) | ✅ | ✅ | ✅ | ✅ |

**Paalala tungkol sa bubblewrap:** Linux user-namespace sandboxing. Ang macOS at katutubong Windows ay awtomatikong bumabalik sa sandbox mode na `none` — walang kailangang konfigurasyon.

---

## 2. Mga Kinakailangan

### Node.js >= 22.0.0

**Bakit:** Gumagamit ang SIDJUA ng mga ES module, katutubong `fetch()`, at `crypto.subtle` — lahat ay nangangailangan ng Node.js 22+.

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

**macOS (installer na .pkg):** I-download mula sa [nodejs.org/en/download](https://nodejs.org/en/download).

**Windows (winget):**
```powershell
winget install OpenJS.NodeJS.LTS
```

**Windows (.msi):** I-download mula sa [nodejs.org/en/download](https://nodejs.org/en/download).

**WSL2:** Gamitin ang mga tagubilin para sa Ubuntu/Debian sa itaas sa loob ng iyong WSL2 terminal.

I-verify:
```bash
node --version   # dapat >= 22.0.0
npm --version    # dapat >= 10.0.0
```

---

### C/C++ Toolchain (para sa mga source build lamang)

**Bakit:** Ang `better-sqlite3` at `argon2` ay nag-co-compile ng mga katutubong Node.js addon sa panahon ng `npm ci`. Maaaring laktawan ng mga gumagamit ng Docker ito.

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

**Windows:** I-install ang [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) na may workload na **Desktop development with C++**, pagkatapos ay:
```powershell
npm install --global windows-build-tools
```

**Alpine Linux:**
```bash
apk add python3 make g++ build-base linux-headers
```

---

### Docker >= 24 (opsyonal)

Kinakailangan lamang para sa paraan ng pag-install gamit ang Docker. Ang Docker Compose V2 plugin (`docker compose`) ay dapat available.

**Linux:** Sundin ang mga tagubilin sa [docs.docker.com/engine/install](https://docs.docker.com/engine/install/).
Kasama ang Docker Compose V2 sa Docker Engine >= 24.

**macOS / Windows:** I-install ang [Docker Desktop](https://www.docker.com/products/docker-desktop/) (kasama ang Docker Compose V2).

I-verify:
```bash
docker --version          # dapat >= 24.0.0
docker compose version    # dapat magpakita ng v2.x.x
```

---

### Git

Anumang kamakailang bersyon. I-install sa pamamagitan ng package manager ng iyong OS o mula sa [git-scm.com](https://git-scm.com).

---

## 3. Mga Paraan ng Pag-install

### Paraan A — Docker (Inirerekomenda)

Ang pinakamabilis na landas patungo sa gumaganang pag-install ng SIDJUA. Lahat ng dependencies ay kasama sa image.

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
docker compose up -d
```

Hintayin ang mga serbisyo na maging malusog (hanggang ~60 segundo sa unang build):

```bash
docker compose ps
# NAME              STATUS
# sidjua            Up X seconds (healthy)
# sidjua-qdrant     Up X seconds (healthy)
```

Kunin ang awtomatikong nabuong API key:

```bash
docker compose exec sidjua cat /app/.system/api-key
```

I-bootstrap ang pamamahala mula sa iyong `divisions.yaml`:

```bash
docker compose exec sidjua sidjua apply --verbose
```

Patakbuhin ang pagsusuri ng kalusugan ng sistema:

```bash
docker compose exec sidjua sidjua selftest
```

**Paalala sa ARM64:** Ang Docker image ay binuo sa `node:22-alpine` na sumusuporta sa `linux/amd64` at `linux/arm64`. Ang Raspberry Pi (64-bit) at mga Mac na may Apple Silicon (sa pamamagitan ng Docker Desktop) ay sinusuportahan agad.

**Bubblewrap sa Docker:** Upang paganahin ang sandboxing ng agent sa loob ng container, magdagdag ng `--cap-add=SYS_ADMIN` sa iyong Docker run command o itakda ito sa `docker-compose.yml`:
```yaml
cap_add:
  - SYS_ADMIN
```

---

### Paraan B — Global na Pag-install ng npm

```bash
npm install -g sidjua
```

Patakbuhin ang interactive na setup wizard (3 hakbang: lokasyon ng workspace, provider, unang agent):
```bash
sidjua init
```

Para sa mga non-interactive na CI o container environment:
```bash
sidjua init --yes
```

Simulan ang zero-config AI guide (walang kailangang API key):
```bash
sidjua chat guide
```

---

### Paraan C — Source Build

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
npm ci
npm run build
```

Gumagamit ang proseso ng build ng `tsup` upang i-compile ang `src/index.ts` sa:
- `dist/index.js` (ESM)
- `dist/index.cjs` (CommonJS)

Ang mga hakbang pagkatapos ng build ay nagkokopya ng mga i18n locale file, mga default na papel, dibisyon, at mga template ng knowledge base sa `dist/`.

Patakbuhin mula sa source:
```bash
node dist/index.js --help
```

Patakbuhin ang test suite:
```bash
npm test                    # lahat ng test
npm run test:coverage       # na may ulat ng coverage
npx tsc --noEmit            # type check lamang
```

---

## 4. Layout ng Direktoryo

### Mga Path ng Docker Deployment

| Path | Docker Volume | Layunin | Pinamamahalaan Ng |
|------|---------------|---------|------------|
| `/app/dist/` | Layer ng image | Compiled na aplikasyon | SIDJUA |
| `/app/node_modules/` | Layer ng image | Mga dependency ng Node.js | SIDJUA |
| `/app/system/` | Layer ng image | Mga built-in na default at template | SIDJUA |
| `/app/defaults/` | Layer ng image | Mga default na config file | SIDJUA |
| `/app/docs/` | Layer ng image | Mga dokumentasyong kasama | SIDJUA |
| `/app/data/` | `sidjua-data` | Mga database ng SQLite, backup, koleksyon ng kaalaman | Gumagamit |
| `/app/config/` | `sidjua-config` | `divisions.yaml` at custom na config | Gumagamit |
| `/app/logs/` | `sidjua-logs` | Mga structured na log file | Gumagamit |
| `/app/.system/` | `sidjua-system` | API key, estado ng update, process lock | Pinamamahalaan ng SIDJUA |
| `/app/agents/` | `sidjua-workspace` | Mga kahulugan ng agent, kasanayan, template | Gumagamit |
| `/app/governance/` | `sidjua-governance` | Audit trail, mga snapshot ng pamamahala | Gumagamit |

---

### Mga Path ng Manual / npm Install

Pagkatapos ng `sidjua init`, ang iyong workspace ay nakaayos bilang:

```
~/sidjua-workspace/           # o SIDJUA_CONFIG_DIR
├── divisions.yaml            # Ang iyong konfigurasyon ng pamamahala
├── .sidjua/                  # Panloob na estado (WAL, buffer ng telemetry)
│   └── telemetry.db
├── data/
│   ├── sidjua.db             # Pangunahing database (mga agent, gawain, audit, gastos)
│   ├── knowledge/            # Mga database ng kaalaman bawat agent
│   │   └── <agent-id>.db
│   └── backups/              # Mga backup archive na may pirma ng HMAC
├── agents/                   # Mga direktoryo ng kasanayan ng agent
├── governance/               # Audit trail (append-only)
├── logs/                     # Mga log ng aplikasyon
└── system/                   # Estado sa runtime
```

---

### Mga Database ng SQLite

| Database | Path | Nilalaman |
|----------|------|----------|
| Pangunahin | `data/sidjua.db` | Mga agent, gawain, gastos, mga snapshot ng pamamahala, mga API key, audit log |
| Telemetry | `.sidjua/telemetry.db` | Opsyonal na mga ulat ng error na naka-opt-in (na-redact ang PII) |
| Kaalaman | `data/knowledge/<agent-id>.db` | Mga vector embedding bawat agent at index ng BM25 |

Ang mga database ng SQLite ay single-file, cross-platform, at portable. I-back up ang mga ito gamit ang `sidjua backup create`.

---

## 5. Mga Variable ng Kapaligiran

Kopyahin ang `.env.example` sa `.env` at i-customize. Lahat ng variable ay opsyonal maliban kung nabanggit.

### Server

| Variable | Default | Paglalarawan |
|----------|---------|-------------|
| `SIDJUA_PORT` | `3000` | Port na pinakikinggan ng REST API |
| `SIDJUA_HOST` | `127.0.0.1` | Address na ginagamit ng REST API. Gamitin ang `0.0.0.0` para sa remote na access |
| `NODE_ENV` | `production` | Mode sa runtime (`production` o `development`) |
| `SIDJUA_API_KEY` | Awtomatikong nagagawa | Bearer token ng REST API. Awtomatikong nalilikha sa unang pagsisimula kung wala |
| `SIDJUA_MAX_BODY_SIZE` | `2097152` (2 MiB) | Maximum na laki ng katawan ng papasok na kahilingan sa bytes |

### Mga Override ng Direktoryo

| Variable | Default | Paglalarawan |
|----------|---------|-------------|
| `SIDJUA_DATA_DIR` | `<workspace>/data` | I-override ang lokasyon ng direktoryo ng data |
| `SIDJUA_CONFIG_DIR` | `<workspace>` | I-override ang lokasyon ng direktoryo ng config |
| `SIDJUA_LOG_DIR` | `<workspace>/logs` | I-override ang lokasyon ng direktoryo ng log |

### Semantikong Paghahanap

| Variable | Default | Paglalarawan |
|----------|---------|-------------|
| `SIDJUA_QDRANT_URL` | `http://localhost:6333` | Endpoint ng Qdrant vector database. Docker default: `http://qdrant:6333` |
| `OPENAI_API_KEY` | — | Kinakailangan para sa mga embedding ng OpenAI `text-embedding-3-large` |
| `SIDJUA_CF_ACCOUNT_ID` | — | ID ng account ng Cloudflare para sa libreng mga embedding |
| `SIDJUA_CF_TOKEN` | — | Token ng API ng Cloudflare para sa libreng mga embedding |

### Mga Provider ng LLM

| Variable | Provider |
|----------|----------|
| `ANTHROPIC_API_KEY` | Anthropic (Claude) |
| `OPENAI_API_KEY` | OpenAI (GPT-4, mga embedding) |
| `GOOGLE_AI_API_KEY` | Google AI (Gemini) |
| `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` | Cloudflare Workers AI (libreng tier) |
| `GROQ_API_KEY` | Groq (mabilis na inference, available ang libreng tier) |
| `DEEPSEEK_API_KEY` | DeepSeek |

---

## 6. Konfigurasyon ng Provider

### Opsyong Walang Konfigurasyon

Gumagana ang `sidjua chat guide` nang walang anumang API key. Kumokonekta ito sa Cloudflare Workers AI sa pamamagitan ng proxy ng SIDJUA. May limitasyon sa rate ngunit angkop para sa pagsusuri at onboarding.

### Pagdaragdag ng Iyong Unang Provider

**Groq (libreng tier, walang credit card):**
```bash
sidjua key set groq <your-groq-api-key>
sidjua provider list
```
Kumuha ng libreng key sa [console.groq.com](https://console.groq.com).

**Anthropic (inirerekomenda para sa produksyon):**
```bash
export ANTHROPIC_API_KEY=sk-ant-...
sidjua key set anthropic $ANTHROPIC_API_KEY
```

**Ollama (air-gap / lokal na deployment):**
```bash
sidjua provider add-custom \
  --id ollama \
  --name "Ollama (local)" \
  --base-url http://localhost:11434/v1 \
  --model llama3.2
```

I-validate ang lahat ng na-configure na provider:
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

## 8. Sandboxing ng Agent

Gumagamit ang SIDJUA ng pluggable na interface na `SandboxProvider`. Binabalot ng sandbox ang pagpapatupad ng kasanayan ng agent sa page-isolate ng proseso sa antas ng OS.

### Suporta sa Sandbox ayon sa Platform

| Platform | Provider ng Sandbox | Mga Tala |
|----------|-----------------|-------|
| Linux (katutubong) | `bubblewrap` | Buong page-isolate ng user-namespace |
| Docker (container ng Linux) | `bubblewrap` | Nangangailangan ng `--cap-add=SYS_ADMIN` |
| macOS | `none` (awtomatikong fallback) | Hindi sinusuportahan ng macOS ang mga Linux user namespace |
| Windows WSL2 | `bubblewrap` | I-install tulad ng sa Linux sa loob ng WSL2 |
| Windows (katutubong) | `none` (awtomatikong fallback) | |

### Pag-install ng bubblewrap (Linux)

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

### Konfigurasyon

Sa `divisions.yaml`:
```yaml
governance:
  sandbox: bubblewrap    # o: none
```

I-verify ang availability ng sandbox:
```bash
sidjua sandbox check
```

---

## 9. Semantikong Paghahanap (Opsyonal)

Pinapagana ng semantikong paghahanap ang `sidjua memory search` at pagkuha ng kaalaman ng agent. Nangangailangan ito ng Qdrant vector database at isang provider ng embedding.

### Profile ng Docker Compose

Ang kasama na `docker-compose.yml` ay may profile na `semantic-search`:
```bash
docker compose --profile semantic-search up -d
```
Nagpapasinaya ito ng container ng Qdrant kasabay ng SIDJUA.

### Standalone na Qdrant

```bash
docker run -d \
  --name sidjua-qdrant \
  -p 6333:6333 \
  -v qdrant-storage:/qdrant/storage \
  qdrant/qdrant:v1.13.2
```

Itakda ang endpoint:
```bash
export SIDJUA_QDRANT_URL=http://localhost:6333
```

### Nang Walang Qdrant

Kung hindi available ang Qdrant, ang `sidjua memory import` at `sidjua memory search` ay hindi pinagana. Lahat ng iba pang tampok ng SIDJUA (CLI, REST API, pagpapatupad ng agent, pamamahala, audit) ay gumagana nang normal. Ang sistema ay bumabalik sa BM25 keyword search para sa anumang mga query sa kaalaman.

---

## 10. Pag-aayos ng Mga Problema

### Lahat ng Platform

**`npm ci` ay nabibigo na may mga error na `node-pre-gyp` o `node-gyp`:**
```
gyp ERR! build error
```
I-install ang C/C++ toolchain (tingnan ang seksyon ng Mga Kinakailangan). Sa Ubuntu: `sudo apt-get install -y python3 make g++ build-essential`.

**`Cannot find divisions.yaml`:**
Suriin ang `SIDJUA_CONFIG_DIR`. Ang file ay dapat nasa `$SIDJUA_CONFIG_DIR/divisions.yaml`. Patakbuhin ang `sidjua init` upang likhain ang istruktura ng workspace.

**REST API ay nagbabalik ng 401 Unauthorized:**
I-verify ang header na `Authorization: Bearer <key>`. Kunin ang awtomatikong nabuong key gamit ang:
```bash
cat ~/.sidjua/.system/api-key          # manual na install
docker compose exec sidjua cat /app/.system/api-key  # Docker
```

**Port 3000 ay ginagamit na:**
```bash
SIDJUA_PORT=3001 sidjua server start
# o itakda sa .env: SIDJUA_PORT=3001
```

---

### Ubuntu / Debian

**Ang `better-sqlite3` ay nabibigong mag-compile dahil hindi mahanap ang `futex.h`:**
```bash
sudo apt-get install -y linux-headers-$(uname -r)
```

---

### Fedora / RHEL

**Nino-block ng SELinux ang mga Docker volume mount:**
```yaml
# Magdagdag ng label na :Z para sa konteksto ng SELinux
volumes:
  - ./my-config:/app/config:Z
```
O itakda nang mano-mano ang konteksto ng SELinux:
```bash
chcon -Rt svirt_sandbox_file_t ./my-config
```

---

### Arch Linux

**Masyadong luma ang bersyon ng Node.js:**
Gamitin ang `nvm` upang i-install ang Node.js 22:
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

**Naubos ang memory ng Docker Desktop:**
Buksan ang Docker Desktop → Settings → Resources → Memory. Dagdagan sa hindi bababa sa 4 GB.

**Apple Silicon — hindi tugma ang arkitektura:**
I-verify na ang iyong pag-install ng Node.js ay katutubong ARM64 (hindi Rosetta):
```bash
node -e "console.log(process.arch)"
# inaasahan: arm64
```
Kung nagpi-print ito ng `x64`, muling i-install ang Node.js gamit ang ARM64 installer mula sa nodejs.org.

---

### Windows (katutubong)

**Hindi mahanap ang `MSBuild` o `cl.exe`:**
I-install ang [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) at piliin ang workload na **Desktop development with C++**. Pagkatapos ay patakbuhin:
```powershell
npm install --global windows-build-tools
```

**Mga error sa mahabang path (`ENAMETOOLONG`):**
I-enable ang suporta sa mahabang path sa registry ng Windows:
```powershell
# Patakbuhin bilang Administrator
Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" `
  -Name LongPathsEnabled -Value 1
```

**Hindi mahanap ang command na `sidjua` pagkatapos ng `npm install -g`:**
Idagdag ang global na direktoryo ng bin ng npm sa iyong PATH:
```powershell
npm config get prefix  # nagpapakita ng hal. C:\Users\you\AppData\Roaming\npm
# Idagdag ang path na iyon sa System Environment Variables → Path
```

---

### Windows WSL2

**Nabibigo ang Docker na magsimula sa loob ng WSL2:**
Buksan ang Docker Desktop → Settings → General → i-enable ang **Use the WSL 2 based engine**.
Pagkatapos ay i-restart ang Docker Desktop at ang iyong WSL2 terminal.

**Mga error sa pahintulot sa mga file sa ilalim ng `/mnt/c/`:**
Ang mga volume ng Windows NTFS na naka-mount sa WSL2 ay may mga pinaghigpitang pahintulot. Ilipat ang iyong workspace sa isang Linux-native na path:
```bash
mkdir ~/sidjua-workspace
cd ~/sidjua-workspace
sidjua init
```

---

### Raspberry Pi / ARM64

**Napakabagal ng `npm ci` (5–10 minuto):**
Ito ay normal. Ang pag-compile ng katutubong addon sa ARM64 ay mas matagal. Isaalang-alang ang paggamit ng Docker image sa halip:
```bash
docker pull sidjua/sidjua:latest-arm64
```

**Naubos ang memory sa panahon ng build:**
Magdagdag ng swap space:
```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

---

## 11. Sanggunian sa Docker Volume

### Mga Pinangalanang Volume

| Pangalan ng Volume | Path sa Container | Layunin |
|-------------|---------------|---------|
| `sidjua-data` | `/app/data` | Mga database ng SQLite, mga archive ng backup, mga koleksyon ng kaalaman |
| `sidjua-config` | `/app/config` | `divisions.yaml`, custom na konfigurasyon |
| `sidjua-logs` | `/app/logs` | Mga structured na log ng aplikasyon |
| `sidjua-system` | `/app/.system` | API key, estado ng update, file ng lock ng proseso |
| `sidjua-workspace` | `/app/agents` | Mga direktoryo ng kasanayan ng agent, mga kahulugan, mga template |
| `sidjua-governance` | `/app/governance` | Hindi nababago na audit trail, mga snapshot ng pamamahala |
| `qdrant-storage` | `/qdrant/storage` | Index ng vector ng Qdrant (para sa profile ng semantikong paghahanap lamang) |

### Paggamit ng Direktoryo ng Host

Upang i-mount ang iyong sariling `divisions.yaml` sa halip na mag-edit sa loob ng container:

```yaml
# docker-compose.override.yml
services:
  sidjua:
    volumes:
      - ./my-config:/app/config   # pinapalitan ang pinangalanang volume na sidjua-config
```

### Backup

```bash
sidjua backup create                    # mula sa loob ng container
# o
docker compose exec sidjua sidjua backup create
```

Ang mga backup ay mga archive na may pirma ng HMAC na nakaimbak sa `/app/data/backups/`.

---

## 12. Pag-upgrade

### Docker

```bash
git pull
docker compose build --no-cache
docker compose up -d
docker compose exec sidjua sidjua apply    # patakbuhin ang mga migration ng schema
```

Ang `sidjua apply` ay idempotent — palaging ligtas na patakbuhin muli pagkatapos ng upgrade.

### Global na Pag-install ng npm

```bash
npm update -g sidjua
sidjua apply    # patakbuhin ang mga migration ng schema
```

### Source Build

```bash
git pull
npm ci
npm run build
node dist/index.js apply    # patakbuhin ang mga migration ng schema
```

### Rollback

Lumilikha ang SIDJUA ng snapshot ng pamamahala bago ang bawat `sidjua apply`. Upang maibalik:

```bash
sidjua rollback list
sidjua rollback <version>
```

---

## 13. Mga Susunod na Hakbang

| Mapagkukunan | Command / Link |
|----------|---------------|
| Mabilis na Simula | [docs/QUICK-START.md](QUICK-START.md) |
| Sanggunian sa CLI | [docs/CLI-REFERENCE.md](CLI-REFERENCE.md) |
| Mga Halimbawa ng Pamamahala | [docs/GOVERNANCE-EXAMPLES.md](GOVERNANCE-EXAMPLES.md) |
| Gabay sa Libreng Provider ng LLM | [docs/FREE-LLM-PROVIDER-GUIDE.md](FREE-LLM-PROVIDER-GUIDE.md) |
| Pag-aayos ng Mga Problema | [docs/TROUBLESHOOTING.md](TROUBLESHOOTING.md) |

Mga unang command na dapat patakbuhin pagkatapos ng pag-install:

```bash
sidjua chat guide    # zero-config AI guide — walang kailangang API key
sidjua selftest      # pagsusuri ng kalusugan ng sistema (7 kategorya, marka 0-100)
sidjua apply         # mag-provision ng mga agent mula sa divisions.yaml
```
