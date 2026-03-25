> Acest document a fost tradus de AI din [originalul în engleză](../INSTALLATION.md). Ați găsit o eroare? [Raportați-o](https://github.com/GoetzKohlberg/sidjua/issues).

# Ghid de instalare SIDJUA

Versiunea SIDJUA: 1.0.0 | Licență: AGPL-3.0-only | Actualizat: 2026-03-25

## Cuprins

1. [Matricea de suport pentru platforme](#1-matricea-de-suport-pentru-platforme)
2. [Condiții prealabile](#2-condiții-prealabile)
3. [Metode de instalare](#3-metode-de-instalare)
4. [Structura directoarelor](#4-structura-directoarelor)
5. [Variabile de mediu](#5-variabile-de-mediu)
6. [Configurarea furnizorului](#6-configurarea-furnizorului)
7. [Interfața grafică desktop (Opțional)](#7-interfața-grafică-desktop-opțional)
8. [Sandboxing pentru agenți](#8-sandboxing-pentru-agenți)
9. [Căutare semantică (Opțional)](#9-căutare-semantică-opțional)
10. [Depanare](#10-depanare)
11. [Referință volume Docker](#11-referință-volume-docker)
12. [Actualizare](#12-actualizare)
13. [Pași următori](#13-pași-următori)

---

## 1. Matricea de suport pentru platforme

| Funcționalitate | Linux | macOS | Windows WSL2 | Windows (nativ) |
|-----------------|-------|-------|--------------|-----------------|
| CLI + REST API | ✅ Complet | ✅ Complet | ✅ Complet | ✅ Complet |
| Docker | ✅ Complet | ✅ Docker Desktop | ✅ Docker Desktop | ✅ Docker Desktop |
| Sandboxing (bubblewrap) | ✅ Complet | ❌ Revenire la `none` | ✅ Complet (în WSL2) | ❌ Revenire la `none` |
| Web Management Console | ✅ Full | ✅ Full | ✅ Full | ✅ Full |
| Căutare semantică (Qdrant) | ✅ | ✅ | ✅ | ✅ |

**Notă despre bubblewrap:** Sandboxing cu spații de nume de utilizator Linux. macOS și Windows nativ revin automat la modul sandbox `none` — nu este necesară nicio configurare.

---

## 2. Condiții prealabile

### Node.js >= 22.0.0

**De ce:** SIDJUA folosește module ES, `fetch()` nativ și `crypto.subtle` — toate necesită Node.js 22+.

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

**macOS (programul de instalare .pkg):** Descărcați de la [nodejs.org/en/download](https://nodejs.org/en/download).

**Windows (winget):**
```powershell
winget install OpenJS.NodeJS.LTS
```

**Windows (.msi):** Descărcați de la [nodejs.org/en/download](https://nodejs.org/en/download).

**WSL2:** Utilizați instrucțiunile Ubuntu/Debian de mai sus în terminalul WSL2.

Verificare:
```bash
node --version   # trebuie să fie >= 22.0.0
npm --version    # trebuie să fie >= 10.0.0
```

---

### Lanț de instrumente C/C++ (numai pentru compilare din sursă)

**De ce:** `better-sqlite3` și `argon2` compilează extensii native Node.js în timpul `npm ci`. Utilizatorii Docker pot sări peste acest pas.

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

**Windows:** Instalați [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) cu sarcina de lucru **Dezvoltare desktop cu C++**, apoi:
```powershell
npm install --global windows-build-tools
```

**Alpine Linux:**
```bash
apk add python3 make g++ build-base linux-headers
```

---

### Docker >= 24 (opțional)

Necesar doar pentru metoda de instalare Docker. Plugin-ul Docker Compose V2 (`docker compose`) trebuie să fie disponibil.

**Linux:** Urmați instrucțiunile de la [docs.docker.com/engine/install](https://docs.docker.com/engine/install/).
Docker Compose V2 este inclus cu Docker Engine >= 24.

**macOS / Windows:** Instalați [Docker Desktop](https://www.docker.com/products/docker-desktop/) (include Docker Compose V2).

Verificare:
```bash
docker --version          # trebuie să fie >= 24.0.0
docker compose version    # trebuie să afișeze v2.x.x
```

---

### Git

Orice versiune recentă. Instalați prin managerul de pachete al sistemului de operare sau de la [git-scm.com](https://git-scm.com).

---

## 3. Metode de instalare

### Metoda A — Docker (Recomandat)

Cea mai rapidă cale spre o instalare funcțională SIDJUA. Toate dependențele sunt incluse în imagine.

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
docker compose up -d
```

Așteptați ca serviciile să devină sănătoase (până la ~60 de secunde la prima compilare):

```bash
docker compose ps
# NAME              STATUS
# sidjua            Up X seconds (healthy)
# sidjua-qdrant     Up X seconds (healthy)
```

Obțineți cheia API generată automat:

```bash
docker compose exec sidjua cat /app/.system/api-key
```

Inițializați guvernanța din fișierul `divisions.yaml`:

```bash
docker compose exec sidjua sidjua apply --verbose
```

Executați verificarea stării sistemului:

```bash
docker compose exec sidjua sidjua selftest
```

**Notă ARM64:** Imaginea Docker este compilată pe `node:22-alpine` care suportă `linux/amd64` și `linux/arm64`. Raspberry Pi (64-bit) și Mac-urile Apple Silicon (prin Docker Desktop) sunt suportate implicit.

**Bubblewrap în Docker:** Pentru a activa sandboxing-ul agenților în interiorul containerului, adăugați `--cap-add=SYS_ADMIN` la comanda Docker run sau setați-l în `docker-compose.yml`:
```yaml
cap_add:
  - SYS_ADMIN
```

---

### Metoda B — Instalare globală npm

```bash
npm install -g sidjua
```

Executați asistentul de configurare interactiv (3 pași: locație spațiu de lucru, furnizor, primul agent):
```bash
sidjua init
```

Pentru medii CI sau containere neinteractive:
```bash
sidjua init --yes
```

Porniți ghidul AI fără configurare (nu este necesară o cheie API):
```bash
sidjua chat guide
```

---

### Metoda C — Compilare din sursă

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
npm ci
npm run build
```

Procesul de compilare folosește `tsup` pentru a compila `src/index.ts` în:
- `dist/index.js` (ESM)
- `dist/index.cjs` (CommonJS)

Pașii post-compilare copiază fișierele de localizare i18n, rolurile implicite, diviziile și șabloanele bazei de cunoștințe în `dist/`.

Rulați din sursă:
```bash
node dist/index.js --help
```

Rulați suita de teste:
```bash
npm test                    # toate testele
npm run test:coverage       # cu raport de acoperire
npx tsc --noEmit            # numai verificarea tipurilor
```

---

## 4. Structura directoarelor

### Căi de implementare Docker

| Cale | Volum Docker | Scop | Gestionat de |
|------|--------------|------|--------------|
| `/app/dist/` | Strat imagine | Aplicație compilată | SIDJUA |
| `/app/node_modules/` | Strat imagine | Dependențe Node.js | SIDJUA |
| `/app/system/` | Strat imagine | Valori implicite și șabloane încorporate | SIDJUA |
| `/app/defaults/` | Strat imagine | Fișiere de configurare implicite | SIDJUA |
| `/app/docs/` | Strat imagine | Documentație inclusă | SIDJUA |
| `/app/data/` | `sidjua-data` | Baze de date SQLite, copii de siguranță, colecții de cunoștințe | Utilizator |
| `/app/config/` | `sidjua-config` | `divisions.yaml` și configurație personalizată | Utilizator |
| `/app/logs/` | `sidjua-logs` | Fișiere de jurnal structurate | Utilizator |
| `/app/.system/` | `sidjua-system` | Cheie API, stare actualizare, blocare proces | Gestionat de SIDJUA |
| `/app/agents/` | `sidjua-workspace` | Definiții agenți, competențe, șabloane | Utilizator |
| `/app/governance/` | `sidjua-governance` | Urmă de audit, instantanee de guvernanță | Utilizator |

---

### Căi de instalare manuală / npm

După `sidjua init`, spațiul de lucru este organizat astfel:

```
~/sidjua-workspace/           # sau SIDJUA_CONFIG_DIR
├── divisions.yaml            # Configurația dvs. de guvernanță
├── .sidjua/                  # Stare internă (WAL, buffer telemetrie)
│   └── telemetry.db
├── data/
│   ├── sidjua.db             # Baza de date principală (agenți, sarcini, audit, costuri)
│   ├── knowledge/            # Baze de date de cunoștințe per agent
│   │   └── <agent-id>.db
│   └── backups/              # Arhive de backup semnate HMAC
├── agents/                   # Directoare de competențe ale agenților
├── governance/               # Urmă de audit (doar adăugare)
├── logs/                     # Jurnale de aplicație
└── system/                   # Stare de execuție
```

---

### Baze de date SQLite

| Bază de date | Cale | Conținut |
|--------------|------|----------|
| Principală | `data/sidjua.db` | Agenți, sarcini, costuri, instantanee de guvernanță, chei API, jurnal de audit |
| Telemetrie | `.sidjua/telemetry.db` | Rapoarte de erori opționale cu participare voluntară (cu redactarea PII) |
| Cunoștințe | `data/knowledge/<agent-id>.db` | Încorporări vectoriale per agent și index BM25 |

Bazele de date SQLite sunt fișiere unice, multiplatformă și portabile. Faceți copii de siguranță cu `sidjua backup create`.

---

## 5. Variabile de mediu

Copiați `.env.example` în `.env` și personalizați. Toate variabilele sunt opționale dacă nu se specifică altfel.

### Server

| Variabilă | Implicit | Descriere |
|-----------|----------|-----------|
| `SIDJUA_PORT` | `3000` | Portul de ascultare REST API |
| `SIDJUA_HOST` | `127.0.0.1` | Adresa de legare REST API. Utilizați `0.0.0.0` pentru acces la distanță |
| `NODE_ENV` | `production` | Modul de execuție (`production` sau `development`) |
| `SIDJUA_API_KEY` | Generat automat | Token purtător REST API. Creat automat la primul start dacă lipsește |
| `SIDJUA_MAX_BODY_SIZE` | `2097152` (2 MiB) | Dimensiunea maximă a corpului cererii de intrare în octeți |

### Substituiri de directoare

| Variabilă | Implicit | Descriere |
|-----------|----------|-----------|
| `SIDJUA_DATA_DIR` | `<workspace>/data` | Substituiți locația directorului de date |
| `SIDJUA_CONFIG_DIR` | `<workspace>` | Substituiți locația directorului de configurare |
| `SIDJUA_LOG_DIR` | `<workspace>/logs` | Substituiți locația directorului de jurnale |

### Căutare semantică

| Variabilă | Implicit | Descriere |
|-----------|----------|-----------|
| `SIDJUA_QDRANT_URL` | `http://localhost:6333` | Endpoint bază de date vectorială Qdrant. Implicit Docker: `http://qdrant:6333` |
| `OPENAI_API_KEY` | — | Necesar pentru încorporări OpenAI `text-embedding-3-large` |
| `SIDJUA_CF_ACCOUNT_ID` | — | ID cont Cloudflare pentru încorporări gratuite |
| `SIDJUA_CF_TOKEN` | — | Token API Cloudflare pentru încorporări gratuite |

### Furnizori LLM

| Variabilă | Furnizor |
|-----------|----------|
| `ANTHROPIC_API_KEY` | Anthropic (Claude) |
| `OPENAI_API_KEY` | OpenAI (GPT-4, încorporări) |
| `GOOGLE_AI_API_KEY` | Google AI (Gemini) |
| `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` | Cloudflare Workers AI (nivelul gratuit) |
| `GROQ_API_KEY` | Groq (inferență rapidă, nivel gratuit disponibil) |
| `DEEPSEEK_API_KEY` | DeepSeek |

---

## 6. Configurarea furnizorului

### Opțiunea fără configurare

`sidjua chat guide` funcționează fără nicio cheie API. Se conectează la Cloudflare Workers AI prin proxy-ul SIDJUA. Limitat ca rată, dar potrivit pentru evaluare și integrare.

### Adăugarea primului furnizor

**Groq (nivel gratuit, nu este necesară cardul de credit):**
```bash
sidjua key set groq <your-groq-api-key>
sidjua provider list
```
Obțineți o cheie gratuită la [console.groq.com](https://console.groq.com).

**Anthropic (recomandat pentru producție):**
```bash
export ANTHROPIC_API_KEY=sk-ant-...
sidjua key set anthropic $ANTHROPIC_API_KEY
```

**Ollama (implementare locală / fără conexiune la internet):**
```bash
sidjua provider add-custom \
  --id ollama \
  --name "Ollama (local)" \
  --base-url http://localhost:11434/v1 \
  --model llama3.2
```

Validați toți furnizorii configurați:
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

## 8. Sandboxing pentru agenți

SIDJUA folosește o interfață `SandboxProvider` extensibilă. Sandbox-ul încapsulează execuția competențelor agenților în izolare de proces la nivel de sistem de operare.

### Suport sandbox pe platformă

| Platformă | Furnizor sandbox | Note |
|-----------|-----------------|------|
| Linux (nativ) | `bubblewrap` | Izolare completă a spațiului de nume de utilizator |
| Docker (container Linux) | `bubblewrap` | Necesită `--cap-add=SYS_ADMIN` |
| macOS | `none` (revenire automată) | macOS nu suportă spații de nume de utilizator Linux |
| Windows WSL2 | `bubblewrap` | Instalați ca pe Linux în WSL2 |
| Windows (nativ) | `none` (revenire automată) | |

### Instalarea bubblewrap (Linux)

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

### Configurare

În `divisions.yaml`:
```yaml
governance:
  sandbox: bubblewrap    # sau: none
```

Verificați disponibilitatea sandbox-ului:
```bash
sidjua sandbox check
```

---

## 9. Căutare semantică (Opțional)

Căutarea semantică alimentează `sidjua memory search` și recuperarea cunoștințelor agenților. Necesită o bază de date vectorială Qdrant și un furnizor de încorporare.

### Profilul Docker Compose

Fișierul `docker-compose.yml` inclus are un profil `semantic-search`:
```bash
docker compose --profile semantic-search up -d
```
Aceasta pornește un container Qdrant alături de SIDJUA.

### Qdrant independent

```bash
docker run -d \
  --name sidjua-qdrant \
  -p 6333:6333 \
  -v qdrant-storage:/qdrant/storage \
  qdrant/qdrant:v1.13.2
```

Setați endpoint-ul:
```bash
export SIDJUA_QDRANT_URL=http://localhost:6333
```

### Fără Qdrant

Dacă Qdrant nu este disponibil, `sidjua memory import` și `sidjua memory search` sunt dezactivate. Toate celelalte funcționalități SIDJUA (CLI, REST API, execuție agenți, guvernanță, audit) funcționează normal. Sistemul revine la căutarea prin cuvinte cheie BM25 pentru orice interogări de cunoștințe.

---

## 10. Depanare

### Toate platformele

**`npm ci` eșuează cu erori `node-pre-gyp` sau `node-gyp`:**
```
gyp ERR! build error
```
Instalați lanțul de instrumente C/C++ (consultați secțiunea Condiții prealabile). Pe Ubuntu: `sudo apt-get install -y python3 make g++ build-essential`.

**`Cannot find divisions.yaml`:**
Verificați `SIDJUA_CONFIG_DIR`. Fișierul trebuie să fie la `$SIDJUA_CONFIG_DIR/divisions.yaml`. Rulați `sidjua init` pentru a crea structura spațiului de lucru.

**REST API returnează 401 Neautorizat:**
Verificați antetul `Authorization: Bearer <key>`. Obțineți cheia generată automat cu:
```bash
cat ~/.sidjua/.system/api-key          # instalare manuală
docker compose exec sidjua cat /app/.system/api-key  # Docker
```

**Portul 3000 este deja utilizat:**
```bash
SIDJUA_PORT=3001 sidjua server start
# sau setați în .env: SIDJUA_PORT=3001
```

---

### Ubuntu / Debian

**`better-sqlite3` eșuează la compilare cu eroarea `futex.h` nu a fost găsit:**
```bash
sudo apt-get install -y linux-headers-$(uname -r)
```

---

### Fedora / RHEL

**SELinux blochează montările de volume Docker:**
```yaml
# Adăugați eticheta :Z pentru contextul SELinux
volumes:
  - ./my-config:/app/config:Z
```
Sau setați manual contextul SELinux:
```bash
chcon -Rt svirt_sandbox_file_t ./my-config
```

---

### Arch Linux

**Versiunea Node.js este prea veche:**
Utilizați `nvm` pentru a instala Node.js 22:
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

**Docker Desktop rămâne fără memorie:**
Deschideți Docker Desktop → Setări → Resurse → Memorie. Măriți la cel puțin 4 GB.

**Apple Silicon — nepotrivire arhitectură:**
Verificați că instalarea Node.js este ARM64 nativ (nu Rosetta):
```bash
node -e "console.log(process.arch)"
# așteptat: arm64
```
Dacă afișează `x64`, reinstalați Node.js folosind programul de instalare ARM64 de pe nodejs.org.

---

### Windows (nativ)

**`MSBuild` sau `cl.exe` nu a fost găsit:**
Instalați [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) și selectați sarcina de lucru **Dezvoltare desktop cu C++**. Apoi rulați:
```powershell
npm install --global windows-build-tools
```

**Erori de cale lungă (`ENAMETOOLONG`):**
Activați suportul pentru căi lungi în registrul Windows:
```powershell
# Rulați ca Administrator
Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" `
  -Name LongPathsEnabled -Value 1
```

**Comanda `sidjua` nu a fost găsită după `npm install -g`:**
Adăugați directorul bin global npm la PATH:
```powershell
npm config get prefix  # afișează de ex. C:\Users\you\AppData\Roaming\npm
# Adăugați acea cale la Variabilele de mediu sistem → Path
```

---

### Windows WSL2

**Docker nu pornește în WSL2:**
Deschideți Docker Desktop → Setări → General → activați **Use the WSL 2 based engine**.
Apoi reporniți Docker Desktop și terminalul WSL2.

**Erori de permisiuni pe fișierele sub `/mnt/c/`:**
Volumele Windows NTFS montate în WSL2 au permisiuni restricționate. Mutați spațiul de lucru pe o cale Linux nativă:
```bash
mkdir ~/sidjua-workspace
cd ~/sidjua-workspace
sidjua init
```

---

### Raspberry Pi / ARM64

**`npm ci` este foarte lent (5-10 minute):**
Acesta este comportamentul normal. Compilarea extensiei native pe ARM64 durează mai mult. Luați în considerare utilizarea imaginii Docker în schimb:
```bash
docker pull sidjua/sidjua:latest-arm64
```

**Memorie insuficientă în timpul compilării:**
Adăugați spațiu de swap:
```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

---

## 11. Referință volume Docker

### Volume denumite

| Nume volum | Cale container | Scop |
|------------|---------------|------|
| `sidjua-data` | `/app/data` | Baze de date SQLite, arhive de backup, colecții de cunoștințe |
| `sidjua-config` | `/app/config` | `divisions.yaml`, configurație personalizată |
| `sidjua-logs` | `/app/logs` | Jurnale de aplicație structurate |
| `sidjua-system` | `/app/.system` | Cheie API, stare actualizare, fișier de blocare proces |
| `sidjua-workspace` | `/app/agents` | Directoare de competențe ale agenților, definiții, șabloane |
| `sidjua-governance` | `/app/governance` | Urmă de audit imuabilă, instantanee de guvernanță |
| `qdrant-storage` | `/qdrant/storage` | Index vectorial Qdrant (numai profilul de căutare semantică) |

### Utilizarea unui director gazdă

Pentru a monta propriul fișier `divisions.yaml` în loc să îl editați în interiorul containerului:

```yaml
# docker-compose.override.yml
services:
  sidjua:
    volumes:
      - ./my-config:/app/config   # înlocuiește volumul denumit sidjua-config
```

### Copie de siguranță

```bash
sidjua backup create                    # din interiorul containerului
# sau
docker compose exec sidjua sidjua backup create
```

Copiile de siguranță sunt arhive semnate HMAC stocate în `/app/data/backups/`.

---

## 12. Actualizare

### Docker

```bash
git pull
docker compose build --no-cache
docker compose up -d
docker compose exec sidjua sidjua apply    # rulați migrările schemei
```

`sidjua apply` este idempotent — întotdeauna sigur de rulat din nou după o actualizare.

### Instalare globală npm

```bash
npm update -g sidjua
sidjua apply    # rulați migrările schemei
```

### Compilare din sursă

```bash
git pull
npm ci
npm run build
node dist/index.js apply    # rulați migrările schemei
```

### Revenire la versiunea anterioară

SIDJUA creează un instantaneu de guvernanță înainte de fiecare `sidjua apply`. Pentru a reveni:

```bash
sidjua rollback list
sidjua rollback <version>
```

---

## 13. Pași următori

| Resursă | Comandă / Link |
|---------|----------------|
| Start rapid | [docs/QUICK-START.md](QUICK-START.md) |
| Referință CLI | [docs/CLI-REFERENCE.md](CLI-REFERENCE.md) |
| Exemple de guvernanță | [docs/GOVERNANCE-EXAMPLES.md](GOVERNANCE-EXAMPLES.md) |
| Ghid furnizor LLM gratuit | [docs/FREE-LLM-PROVIDER-GUIDE.md](FREE-LLM-PROVIDER-GUIDE.md) |
| Depanare | [docs/TROUBLESHOOTING.md](TROUBLESHOOTING.md) |

Primele comenzi de rulat după instalare:

```bash
sidjua chat guide    # ghid AI fără configurare — nu este necesară o cheie API
sidjua selftest      # verificare stare sistem (7 categorii, scor 0-100)
sidjua apply         # provizionați agenți din divisions.yaml
```
