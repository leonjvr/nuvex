> Tento dokument byl přeložen AI z [anglického originálu](../INSTALLATION.md). Našli jste chybu? [Nahlaste ji](https://github.com/GoetzKohlberg/sidjua/issues).

# Průvodce instalací SIDJUA

SIDJUA verze: 1.0.0 | Licence: AGPL-3.0-only | Aktualizováno: 2026-03-25

## Obsah

1. [Matice podpory platforem](#1-matice-podpory-platforem)
2. [Předpoklady](#2-předpoklady)
3. [Metody instalace](#3-metody-instalace)
4. [Struktura adresářů](#4-struktura-adresářů)
5. [Proměnné prostředí](#5-proměnné-prostředí)
6. [Konfigurace poskytovatele](#6-konfigurace-poskytovatele)
7. [Desktopové GUI (volitelné)](#7-desktopové-gui-volitelné)
8. [Sandboxing agentů](#8-sandboxing-agentů)
9. [Sémantické vyhledávání (volitelné)](#9-sémantické-vyhledávání-volitelné)
10. [Řešení problémů](#10-řešení-problémů)
11. [Reference Docker svazků](#11-reference-docker-svazků)
12. [Upgrade](#12-upgrade)
13. [Další kroky](#13-další-kroky)

---

## 1. Matice podpory platforem

| Funkce | Linux | macOS | Windows WSL2 | Windows (nativní) |
|---------|-------|-------|--------------|------------------|
| CLI + REST API | ✅ Plná | ✅ Plná | ✅ Plná | ✅ Plná |
| Docker | ✅ Plná | ✅ Docker Desktop | ✅ Docker Desktop | ✅ Docker Desktop |
| Sandboxing (bubblewrap) | ✅ Plná | ❌ Záložní režim `none` | ✅ Plná (uvnitř WSL2) | ❌ Záložní režim `none` |
| Web Management Console | ✅ Full | ✅ Full | ✅ Full | ✅ Full |
| Sémantické vyhledávání (Qdrant) | ✅ | ✅ | ✅ | ✅ |

**Poznámka k bubblewrap:** Sandboxing pomocí uživatelských jmenných prostorů Linuxu. macOS a nativní Windows automaticky přecházejí do sandboxového režimu `none` — žádná konfigurace není potřeba.

---

## 2. Předpoklady

### Node.js >= 22.0.0

**Proč:** SIDJUA používá ES moduly, nativní `fetch()` a `crypto.subtle` — vše vyžaduje Node.js 22+.

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

**macOS (instalátor .pkg):** Stáhněte z [nodejs.org/en/download](https://nodejs.org/en/download).

**Windows (winget):**
```powershell
winget install OpenJS.NodeJS.LTS
```

**Windows (.msi):** Stáhněte z [nodejs.org/en/download](https://nodejs.org/en/download).

**WSL2:** Použijte výše uvedené instrukce pro Ubuntu/Debian uvnitř terminálu WSL2.

Ověření:
```bash
node --version   # musí být >= 22.0.0
npm --version    # musí být >= 10.0.0
```

---

### Sada nástrojů C/C++ (pouze pro sestavení ze zdrojového kódu)

**Proč:** `better-sqlite3` a `argon2` kompilují nativní doplňky Node.js během `npm ci`. Uživatelé Docker tento krok přeskočí.

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

**Windows:** Nainstalujte [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) s úlohou **Desktop development with C++**, poté:
```powershell
npm install --global windows-build-tools
```

**Alpine Linux:**
```bash
apk add python3 make g++ build-base linux-headers
```

---

### Docker >= 24 (volitelné)

Vyžadováno pouze pro metodu instalace pomocí Docker. Musí být dostupný zásuvný modul Docker Compose V2 (`docker compose`).

**Linux:** Postupujte podle pokynů na [docs.docker.com/engine/install](https://docs.docker.com/engine/install/).
Docker Compose V2 je součástí Docker Engine >= 24.

**macOS / Windows:** Nainstalujte [Docker Desktop](https://www.docker.com/products/docker-desktop/) (zahrnuje Docker Compose V2).

Ověření:
```bash
docker --version          # musí být >= 24.0.0
docker compose version    # musí zobrazit v2.x.x
```

---

### Git

Libovolná aktuální verze. Nainstalujte přes správce balíčků vašeho OS nebo z [git-scm.com](https://git-scm.com).

---

## 3. Metody instalace

### Metoda A — Docker (doporučeno)

Nejrychlejší cesta k funkční instalaci SIDJUA. Všechny závislosti jsou součástí image.

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
docker compose up -d
```

Počkejte, až budou služby v pořádku (při prvním sestavení až ~60 sekund):

```bash
docker compose ps
# NAME              STATUS
# sidjua            Up X seconds (healthy)
# sidjua-qdrant     Up X seconds (healthy)
```

Získejte automaticky vygenerovaný API klíč:

```bash
docker compose exec sidjua cat /app/.system/api-key
```

Zavedení správy z vašeho `divisions.yaml`:

```bash
docker compose exec sidjua sidjua apply --verbose
```

Spusťte kontrolu stavu systému:

```bash
docker compose exec sidjua sidjua selftest
```

**Poznámka k ARM64:** Docker image je postaven na `node:22-alpine`, který podporuje `linux/amd64` a `linux/arm64`. Raspberry Pi (64-bit) a Macy s Apple Silicon (přes Docker Desktop) jsou podporovány hned po instalaci.

**bubblewrap v Docker:** Pro povolení sandboxingu agentů uvnitř kontejneru přidejte `--cap-add=SYS_ADMIN` k příkazu Docker run nebo nastavte v `docker-compose.yml`:
```yaml
cap_add:
  - SYS_ADMIN
```

---

### Metoda B — Globální instalace npm

```bash
npm install -g sidjua
```

Spusťte interaktivního průvodce nastavením (3 kroky: umístění pracovního prostoru, poskytovatel, první agent):
```bash
sidjua init
```

Pro neinteraktivní prostředí CI nebo kontejnerů:
```bash
sidjua init --yes
```

Spusťte průvodce AI s nulovou konfigurací (bez API klíče):
```bash
sidjua chat guide
```

---

### Metoda C — Sestavení ze zdrojového kódu

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
npm ci
npm run build
```

Proces sestavení používá `tsup` ke kompilaci `src/index.ts` do:
- `dist/index.js` (ESM)
- `dist/index.cjs` (CommonJS)

Kroky po sestavení kopírují soubory locale i18n, výchozí role, divize a šablony znalostní báze do `dist/`.

Spuštění ze zdrojového kódu:
```bash
node dist/index.js --help
```

Spuštění testovací sady:
```bash
npm test                    # všechny testy
npm run test:coverage       # se zprávou o pokrytí
npx tsc --noEmit            # pouze kontrola typů
```

---

## 4. Struktura adresářů

### Cesty pro nasazení Docker

| Cesta | Docker svazek | Účel | Spravováno |
|------|---------------|---------|------------|
| `/app/dist/` | Vrstva image | Zkompilovaná aplikace | SIDJUA |
| `/app/node_modules/` | Vrstva image | Závislosti Node.js | SIDJUA |
| `/app/system/` | Vrstva image | Vestavěná výchozí nastavení a šablony | SIDJUA |
| `/app/defaults/` | Vrstva image | Výchozí konfigurační soubory | SIDJUA |
| `/app/docs/` | Vrstva image | Přiložená dokumentace | SIDJUA |
| `/app/data/` | `sidjua-data` | Databáze SQLite, zálohy, znalostní kolekce | Uživatel |
| `/app/config/` | `sidjua-config` | `divisions.yaml` a vlastní konfigurace | Uživatel |
| `/app/logs/` | `sidjua-logs` | Strukturované soubory protokolů | Uživatel |
| `/app/.system/` | `sidjua-system` | API klíč, stav aktualizace, zámek procesu | Spravováno SIDJUA |
| `/app/agents/` | `sidjua-workspace` | Definice agentů, dovednosti, šablony | Uživatel |
| `/app/governance/` | `sidjua-governance` | Auditní stopa, snímky správy | Uživatel |

---

### Cesty pro ruční instalaci / npm

Po `sidjua init` je váš pracovní prostor organizován takto:

```
~/sidjua-workspace/           # nebo SIDJUA_CONFIG_DIR
├── divisions.yaml            # Vaše konfigurace správy
├── .sidjua/                  # Interní stav (WAL, vyrovnávací paměť telemetrie)
│   └── telemetry.db
├── data/
│   ├── sidjua.db             # Hlavní databáze (agenti, úkoly, audit, náklady)
│   ├── knowledge/            # Znalostní databáze pro jednotlivé agenty
│   │   └── <agent-id>.db
│   └── backups/              # Záložní archivy podepsané HMAC
├── agents/                   # Adresáře dovedností agentů
├── governance/               # Auditní stopa (pouze pro přidávání)
├── logs/                     # Protokoly aplikace
└── system/                   # Stav za běhu
```

---

### Databáze SQLite

| Databáze | Cesta | Obsah |
|----------|------|----------|
| Hlavní | `data/sidjua.db` | Agenti, úkoly, náklady, snímky správy, API klíče, auditní protokol |
| Telemetrie | `.sidjua/telemetry.db` | Volitelné hlášení chyb po přihlášení (PII anonymizováno) |
| Znalosti | `data/knowledge/<agent-id>.db` | Vektorová vnoření pro jednotlivé agenty a index BM25 |

Databáze SQLite jsou jednouborové, multiplatformní a přenositelné. Zálohujte je pomocí `sidjua backup create`.

---

## 5. Proměnné prostředí

Zkopírujte `.env.example` do `.env` a přizpůsobte. Všechny proměnné jsou volitelné, pokud není uvedeno jinak.

### Server

| Proměnná | Výchozí | Popis |
|----------|---------|-------------|
| `SIDJUA_PORT` | `3000` | Naslouchací port REST API |
| `SIDJUA_HOST` | `127.0.0.1` | Adresa pro navázání REST API. Pro vzdálený přístup použijte `0.0.0.0` |
| `NODE_ENV` | `production` | Režim za běhu (`production` nebo `development`) |
| `SIDJUA_API_KEY` | Automaticky generován | Nosný token REST API. Automaticky vytvořen při prvním spuštění, pokud chybí |
| `SIDJUA_MAX_BODY_SIZE` | `2097152` (2 MiB) | Maximální velikost těla příchozího požadavku v bajtech |

### Přepsání adresářů

| Proměnná | Výchozí | Popis |
|----------|---------|-------------|
| `SIDJUA_DATA_DIR` | `<workspace>/data` | Přepsat umístění datového adresáře |
| `SIDJUA_CONFIG_DIR` | `<workspace>` | Přepsat umístění konfiguračního adresáře |
| `SIDJUA_LOG_DIR` | `<workspace>/logs` | Přepsat umístění adresáře protokolů |

### Sémantické vyhledávání

| Proměnná | Výchozí | Popis |
|----------|---------|-------------|
| `SIDJUA_QDRANT_URL` | `http://localhost:6333` | Koncový bod vektorové databáze Qdrant. Výchozí Docker: `http://qdrant:6333` |
| `OPENAI_API_KEY` | — | Vyžadováno pro vnoření OpenAI `text-embedding-3-large` |
| `SIDJUA_CF_ACCOUNT_ID` | — | ID účtu Cloudflare pro bezplatná vnoření |
| `SIDJUA_CF_TOKEN` | — | Token API Cloudflare pro bezplatná vnoření |

### Poskytovatelé LLM

| Proměnná | Poskytovatel |
|----------|----------|
| `ANTHROPIC_API_KEY` | Anthropic (Claude) |
| `OPENAI_API_KEY` | OpenAI (GPT-4, vnoření) |
| `GOOGLE_AI_API_KEY` | Google AI (Gemini) |
| `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` | Cloudflare Workers AI (bezplatná úroveň) |
| `GROQ_API_KEY` | Groq (rychlé odvozování, k dispozici bezplatná úroveň) |
| `DEEPSEEK_API_KEY` | DeepSeek |

---

## 6. Konfigurace poskytovatele

### Možnost bez konfigurace

`sidjua chat guide` funguje bez jakéhokoli API klíče. Připojuje se ke Cloudflare Workers AI prostřednictvím proxy SIDJUA. S omezením rychlosti, ale vhodné pro hodnocení a onboarding.

### Přidání prvního poskytovatele

**Groq (bezplatná úroveň, bez kreditní karty):**
```bash
sidjua key set groq <your-groq-api-key>
sidjua provider list
```
Získejte bezplatný klíč na [console.groq.com](https://console.groq.com).

**Anthropic (doporučeno pro produkci):**
```bash
export ANTHROPIC_API_KEY=sk-ant-...
sidjua key set anthropic $ANTHROPIC_API_KEY
```

**Ollama (nasazení bez připojení / lokální):**
```bash
sidjua provider add-custom \
  --id ollama \
  --name "Ollama (local)" \
  --base-url http://localhost:11434/v1 \
  --model llama3.2
```

Ověřte všechny nakonfigurované poskytovatele:
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

## 8. Sandboxing agentů

SIDJUA používá zásuvné rozhraní `SandboxProvider`. Sandbox obaluje provádění dovedností agenta v izolaci procesu na úrovni OS.

### Podpora sandboxu podle platformy

| Platforma | Poskytovatel sandboxu | Poznámky |
|----------|-----------------|-------|
| Linux (nativní) | `bubblewrap` | Plná izolace uživatelských jmenných prostorů |
| Docker (kontejner Linux) | `bubblewrap` | Vyžaduje `--cap-add=SYS_ADMIN` |
| macOS | `none` (automatický záložní režim) | macOS nepodporuje uživatelské jmenné prostory Linuxu |
| Windows WSL2 | `bubblewrap` | Nainstalujte jako na Linuxu uvnitř WSL2 |
| Windows (nativní) | `none` (automatický záložní režim) | |

### Instalace bubblewrap (Linux)

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

### Konfigurace

V `divisions.yaml`:
```yaml
governance:
  sandbox: bubblewrap    # nebo: none
```

Ověřte dostupnost sandboxu:
```bash
sidjua sandbox check
```

---

## 9. Sémantické vyhledávání (volitelné)

Sémantické vyhledávání pohání `sidjua memory search` a načítání znalostí agentů. Vyžaduje vektorovou databázi Qdrant a poskytovatele vnoření.

### Profil Docker Compose

Přiložený `docker-compose.yml` má profil `semantic-search`:
```bash
docker compose --profile semantic-search up -d
```
Tím se spustí kontejner Qdrant vedle SIDJUA.

### Samostatný Qdrant

```bash
docker run -d \
  --name sidjua-qdrant \
  -p 6333:6333 \
  -v qdrant-storage:/qdrant/storage \
  qdrant/qdrant:v1.13.2
```

Nastavte koncový bod:
```bash
export SIDJUA_QDRANT_URL=http://localhost:6333
```

### Bez Qdrant

Pokud Qdrant není dostupný, jsou `sidjua memory import` a `sidjua memory search` zakázány. Všechny ostatní funkce SIDJUA (CLI, REST API, provádění agentů, správa, audit) fungují normálně. Systém přechází na klíčové vyhledávání BM25 pro veškeré dotazy na znalosti.

---

## 10. Řešení problémů

### Všechny platformy

**`npm ci` selže s chybami `node-pre-gyp` nebo `node-gyp`:**
```
gyp ERR! build error
```
Nainstalujte sadu nástrojů C/C++ (viz sekce Předpoklady). Na Ubuntu: `sudo apt-get install -y python3 make g++ build-essential`.

**`Cannot find divisions.yaml`:**
Zkontrolujte `SIDJUA_CONFIG_DIR`. Soubor musí být na `$SIDJUA_CONFIG_DIR/divisions.yaml`. Spusťte `sidjua init` pro vytvoření struktury pracovního prostoru.

**REST API vrací 401 Unauthorized:**
Ověřte hlavičku `Authorization: Bearer <key>`. Získejte automaticky vygenerovaný klíč pomocí:
```bash
cat ~/.sidjua/.system/api-key          # ruční instalace
docker compose exec sidjua cat /app/.system/api-key  # Docker
```

**Port 3000 je již používán:**
```bash
SIDJUA_PORT=3001 sidjua server start
# nebo nastavte v .env: SIDJUA_PORT=3001
```

---

### Ubuntu / Debian

**`better-sqlite3` se nepodaří zkompilovat, protože chybí `futex.h`:**
```bash
sudo apt-get install -y linux-headers-$(uname -r)
```

---

### Fedora / RHEL

**SELinux blokuje připojení svazků Docker:**
```yaml
# Přidejte štítek :Z pro kontext SELinux
volumes:
  - ./my-config:/app/config:Z
```
Nebo nastavte kontext SELinux ručně:
```bash
chcon -Rt svirt_sandbox_file_t ./my-config
```

---

### Arch Linux

**Verze Node.js je příliš stará:**
K instalaci Node.js 22 použijte `nvm`:
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

**Docker Desktop dochází paměť:**
Otevřete Docker Desktop → Settings → Resources → Memory. Zvyšte alespoň na 4 GB.

**Apple Silicon — nesoulad architektury:**
Ověřte, že vaše instalace Node.js je nativní ARM64 (ne Rosetta):
```bash
node -e "console.log(process.arch)"
# očekáváno: arm64
```
Pokud se zobrazí `x64`, přeinstalujte Node.js pomocí instalátoru ARM64 z nodejs.org.

---

### Windows (nativní)

**`MSBuild` nebo `cl.exe` nenalezeno:**
Nainstalujte [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) a vyberte úlohu **Desktop development with C++**. Poté spusťte:
```powershell
npm install --global windows-build-tools
```

**Chyby dlouhých cest (`ENAMETOOLONG`):**
Povolte podporu dlouhých cest v registru Windows:
```powershell
# Spusťte jako správce
Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" `
  -Name LongPathsEnabled -Value 1
```

**Příkaz `sidjua` nenalezen po `npm install -g`:**
Přidejte globální binární adresář npm do PATH:
```powershell
npm config get prefix  # zobrazí např. C:\Users\you\AppData\Roaming\npm
# Přidejte tuto cestu do Systémové proměnné prostředí → Path
```

---

### Windows WSL2

**Docker se nepodaří spustit uvnitř WSL2:**
Otevřete Docker Desktop → Settings → General → povolte **Use the WSL 2 based engine**.
Poté restartujte Docker Desktop a terminál WSL2.

**Chyby oprávnění u souborů pod `/mnt/c/`:**
Svazky Windows NTFS připojené ve WSL2 mají omezená oprávnění. Přesuňte pracovní prostor na nativní cestu Linuxu:
```bash
mkdir ~/sidjua-workspace
cd ~/sidjua-workspace
sidjua init
```

---

### Raspberry Pi / ARM64

**`npm ci` je velmi pomalé (5–10 minut):**
To je normální. Kompilace nativních doplňků na ARM64 trvá déle. Zvažte místo toho použití Docker image:
```bash
docker pull sidjua/sidjua:latest-arm64
```

**Nedostatek paměti během sestavení:**
Přidejte odkládací prostor:
```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

---

## 11. Reference Docker svazků

### Pojmenované svazky

| Název svazku | Cesta v kontejneru | Účel |
|-------------|---------------|---------|
| `sidjua-data` | `/app/data` | Databáze SQLite, záložní archivy, znalostní kolekce |
| `sidjua-config` | `/app/config` | `divisions.yaml`, vlastní konfigurace |
| `sidjua-logs` | `/app/logs` | Strukturované protokoly aplikace |
| `sidjua-system` | `/app/.system` | API klíč, stav aktualizace, soubor zámku procesu |
| `sidjua-workspace` | `/app/agents` | Adresáře dovedností agentů, definice, šablony |
| `sidjua-governance` | `/app/governance` | Neměnná auditní stopa, snímky správy |
| `qdrant-storage` | `/qdrant/storage` | Vektorový index Qdrant (pouze profil sémantického vyhledávání) |

### Použití hostitelského adresáře

Chcete-li připojit vlastní `divisions.yaml` místo úprav uvnitř kontejneru:

```yaml
# docker-compose.override.yml
services:
  sidjua:
    volumes:
      - ./my-config:/app/config   # nahrazuje pojmenovaný svazek sidjua-config
```

### Záloha

```bash
sidjua backup create                    # z uvnitř kontejneru
# nebo
docker compose exec sidjua sidjua backup create
```

Zálohy jsou archivy podepsané HMAC uložené v `/app/data/backups/`.

---

## 12. Upgrade

### Docker

```bash
git pull
docker compose build --no-cache
docker compose up -d
docker compose exec sidjua sidjua apply    # spustit migrace schématu
```

`sidjua apply` je idempotentní — je vždy bezpečné jej znovu spustit po upgradu.

### Globální instalace npm

```bash
npm update -g sidjua
sidjua apply    # spustit migrace schématu
```

### Sestavení ze zdrojového kódu

```bash
git pull
npm ci
npm run build
node dist/index.js apply    # spustit migrace schématu
```

### Vrácení zpět

SIDJUA vytvoří snímek správy před každým `sidjua apply`. Pro vrácení:

```bash
sidjua rollback list
sidjua rollback <version>
```

---

## 13. Další kroky

| Zdroj | Příkaz / Odkaz |
|----------|---------------|
| Rychlý start | [docs/QUICK-START.md](QUICK-START.md) |
| Reference CLI | [docs/CLI-REFERENCE.md](CLI-REFERENCE.md) |
| Příklady správy | [docs/GOVERNANCE-EXAMPLES.md](GOVERNANCE-EXAMPLES.md) |
| Průvodce bezplatným poskytovatelem LLM | [docs/FREE-LLM-PROVIDER-GUIDE.md](FREE-LLM-PROVIDER-GUIDE.md) |
| Řešení problémů | [docs/TROUBLESHOOTING.md](TROUBLESHOOTING.md) |

První příkazy ke spuštění po instalaci:

```bash
sidjua chat guide    # průvodce AI bez konfigurace — žádný API klíč není potřeba
sidjua selftest      # kontrola stavu systému (7 kategorií, skóre 0–100)
sidjua apply         # zřízení agentů z divisions.yaml
```
