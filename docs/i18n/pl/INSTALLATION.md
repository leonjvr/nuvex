> Ten dokument został przetłumaczony przez AI z [angielskiego oryginału](../INSTALLATION.md). Znalazłeś błąd? [Zgłoś go](https://github.com/GoetzKohlberg/sidjua/issues).

# Przewodnik instalacji SIDJUA

Wersja SIDJUA: 1.0.0 | Licencja: AGPL-3.0-only | Zaktualizowano: 2026-03-25

## Spis treści

1. [Macierz obsługi platform](#1-macierz-obsługi-platform)
2. [Wymagania wstępne](#2-wymagania-wstępne)
3. [Metody instalacji](#3-metody-instalacji)
4. [Układ katalogów](#4-układ-katalogów)
5. [Zmienne środowiskowe](#5-zmienne-środowiskowe)
6. [Konfiguracja dostawcy](#6-konfiguracja-dostawcy)
7. [Graficzny interfejs użytkownika (opcjonalny)](#7-graficzny-interfejs-użytkownika-opcjonalny)
8. [Sandboxing agentów](#8-sandboxing-agentów)
9. [Wyszukiwanie semantyczne (opcjonalne)](#9-wyszukiwanie-semantyczne-opcjonalne)
10. [Rozwiązywanie problemów](#10-rozwiązywanie-problemów)
11. [Dokumentacja wolumenów Docker](#11-dokumentacja-wolumenów-docker)
12. [Aktualizacja](#12-aktualizacja)
13. [Kolejne kroki](#13-kolejne-kroki)

---

## 1. Macierz obsługi platform

| Funkcja | Linux | macOS | Windows WSL2 | Windows (natywny) |
|---------|-------|-------|--------------|------------------|
| CLI + REST API | ✅ Pełna | ✅ Pełna | ✅ Pełna | ✅ Pełna |
| Docker | ✅ Pełna | ✅ Docker Desktop | ✅ Docker Desktop | ✅ Docker Desktop |
| Sandboxing (bubblewrap) | ✅ Pełna | ❌ Powrót do `none` | ✅ Pełna (wewnątrz WSL2) | ❌ Powrót do `none` |
| Web Management Console | ✅ Full | ✅ Full | ✅ Full | ✅ Full |
| Wyszukiwanie semantyczne (Qdrant) | ✅ | ✅ | ✅ | ✅ |

**Uwaga dotycząca bubblewrap:** Sandboxing przestrzeni nazw użytkownika w systemie Linux. macOS i natywny Windows automatycznie przełączają się do trybu sandbox `none` — konfiguracja nie jest wymagana.

---

## 2. Wymagania wstępne

### Node.js >= 22.0.0

**Dlaczego:** SIDJUA używa modułów ES, natywnego `fetch()` i `crypto.subtle` — wszystkie wymagają Node.js 22+.

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

**macOS (instalator .pkg):** Pobierz z [nodejs.org/en/download](https://nodejs.org/en/download).

**Windows (winget):**
```powershell
winget install OpenJS.NodeJS.LTS
```

**Windows (.msi):** Pobierz z [nodejs.org/en/download](https://nodejs.org/en/download).

**WSL2:** Użyj powyższych instrukcji dla Ubuntu/Debian wewnątrz terminala WSL2.

Weryfikacja:
```bash
node --version   # musi być >= 22.0.0
npm --version    # musi być >= 10.0.0
```

---

### Łańcuch narzędzi C/C++ (tylko do kompilacji ze źródeł)

**Dlaczego:** `better-sqlite3` i `argon2` kompilują natywne dodatki Node.js podczas `npm ci`. Użytkownicy Docker mogą pominąć ten krok.

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

**Windows:** Zainstaluj [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) z obciążeniem **Desktop development with C++**, następnie:
```powershell
npm install --global windows-build-tools
```

**Alpine Linux:**
```bash
apk add python3 make g++ build-base linux-headers
```

---

### Docker >= 24 (opcjonalny)

Wymagany tylko dla metody instalacji Docker. Wtyczka Docker Compose V2 (`docker compose`) musi być dostępna.

**Linux:** Postępuj zgodnie z instrukcjami na [docs.docker.com/engine/install](https://docs.docker.com/engine/install/).
Docker Compose V2 jest dołączony do Docker Engine >= 24.

**macOS / Windows:** Zainstaluj [Docker Desktop](https://www.docker.com/products/docker-desktop/) (zawiera Docker Compose V2).

Weryfikacja:
```bash
docker --version          # musi być >= 24.0.0
docker compose version    # musi pokazywać v2.x.x
```

---

### Git

Dowolna aktualna wersja. Zainstaluj za pomocą menedżera pakietów systemu operacyjnego lub z [git-scm.com](https://git-scm.com).

---

## 3. Metody instalacji

### Metoda A — Docker (zalecana)

Najszybsza droga do działającej instalacji SIDJUA. Wszystkie zależności są dołączone do obrazu.

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
docker compose up -d
```

Poczekaj, aż usługi staną się sprawne (do ~60 sekund przy pierwszej kompilacji):

```bash
docker compose ps
# NAME              STATUS
# sidjua            Up X seconds (healthy)
# sidjua-qdrant     Up X seconds (healthy)
```

Pobierz automatycznie wygenerowany klucz API:

```bash
docker compose exec sidjua cat /app/.system/api-key
```

Zainicjuj zarządzanie z pliku `divisions.yaml`:

```bash
docker compose exec sidjua sidjua apply --verbose
```

Uruchom kontrolę stanu systemu:

```bash
docker compose exec sidjua sidjua selftest
```

**Uwaga ARM64:** Obraz Docker jest zbudowany na `node:22-alpine`, który obsługuje `linux/amd64` i `linux/arm64`. Raspberry Pi (64-bit) i Maki z Apple Silicon (przez Docker Desktop) są obsługiwane od razu po wyjęciu z pudełka.

**Bubblewrap w Docker:** Aby włączyć sandboxing agentów wewnątrz kontenera, dodaj `--cap-add=SYS_ADMIN` do polecenia Docker run lub ustaw to w `docker-compose.yml`:
```yaml
cap_add:
  - SYS_ADMIN
```

---

### Metoda B — Globalna instalacja npm

```bash
npm install -g sidjua
```

Uruchom interaktywnego kreatora konfiguracji (3 kroki: lokalizacja obszaru roboczego, dostawca, pierwszy agent):
```bash
sidjua init
```

Dla nieinteraktywnych środowisk CI lub kontenerów:
```bash
sidjua init --yes
```

Uruchom przewodnik AI bez konfiguracji (klucz API nie jest wymagany):
```bash
sidjua chat guide
```

---

### Metoda C — Kompilacja ze źródeł

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
npm ci
npm run build
```

Proces kompilacji używa `tsup` do skompilowania `src/index.ts` do:
- `dist/index.js` (ESM)
- `dist/index.cjs` (CommonJS)

Kroki po kompilacji kopiują pliki locale i18n, domyślne role, działy i szablony bazy wiedzy do `dist/`.

Uruchomienie ze źródeł:
```bash
node dist/index.js --help
```

Uruchomienie zestawu testów:
```bash
npm test                    # wszystkie testy
npm run test:coverage       # z raportem pokrycia
npx tsc --noEmit            # tylko sprawdzanie typów
```

---

## 4. Układ katalogów

### Ścieżki wdrożenia Docker

| Ścieżka | Wolumen Docker | Cel | Zarządzane przez |
|------|---------------|---------|------------|
| `/app/dist/` | Warstwa obrazu | Skompilowana aplikacja | SIDJUA |
| `/app/node_modules/` | Warstwa obrazu | Zależności Node.js | SIDJUA |
| `/app/system/` | Warstwa obrazu | Wbudowane domyślne ustawienia i szablony | SIDJUA |
| `/app/defaults/` | Warstwa obrazu | Domyślne pliki konfiguracyjne | SIDJUA |
| `/app/docs/` | Warstwa obrazu | Dołączona dokumentacja | SIDJUA |
| `/app/data/` | `sidjua-data` | Bazy danych SQLite, kopie zapasowe, kolekcje wiedzy | Użytkownik |
| `/app/config/` | `sidjua-config` | `divisions.yaml` i niestandardowa konfiguracja | Użytkownik |
| `/app/logs/` | `sidjua-logs` | Strukturalne pliki dziennika | Użytkownik |
| `/app/.system/` | `sidjua-system` | Klucz API, stan aktualizacji, blokada procesu | Zarządzane przez SIDJUA |
| `/app/agents/` | `sidjua-workspace` | Definicje agentów, umiejętności, szablony | Użytkownik |
| `/app/governance/` | `sidjua-governance` | Ścieżka audytu, migawki zarządzania | Użytkownik |

---

### Ścieżki instalacji ręcznej / npm

Po `sidjua init` obszar roboczy jest zorganizowany w następujący sposób:

```
~/sidjua-workspace/           # lub SIDJUA_CONFIG_DIR
├── divisions.yaml            # Twoja konfiguracja zarządzania
├── .sidjua/                  # Stan wewnętrzny (WAL, bufor telemetrii)
│   └── telemetry.db
├── data/
│   ├── sidjua.db             # Główna baza danych (agenci, zadania, audyt, koszty)
│   ├── knowledge/            # Bazy wiedzy poszczególnych agentów
│   │   └── <agent-id>.db
│   └── backups/              # Archiwa kopii zapasowych podpisane HMAC
├── agents/                   # Katalogi umiejętności agentów
├── governance/               # Ścieżka audytu (tylko do dopisywania)
├── logs/                     # Dzienniki aplikacji
└── system/                   # Stan środowiska wykonawczego
```

---

### Bazy danych SQLite

| Baza danych | Ścieżka | Zawartość |
|----------|------|----------|
| Główna | `data/sidjua.db` | Agenci, zadania, koszty, migawki zarządzania, klucze API, dziennik audytu |
| Telemetria | `.sidjua/telemetry.db` | Opcjonalne raporty błędów z możliwością rezygnacji (PII zredagowane) |
| Wiedza | `data/knowledge/<agent-id>.db` | Osadzenia wektorowe poszczególnych agentów i indeks BM25 |

Bazy danych SQLite to pliki jednorazowe, wieloplatformowe i przenośne. Twórz kopie zapasowe za pomocą `sidjua backup create`.

---

## 5. Zmienne środowiskowe

Skopiuj `.env.example` do `.env` i dostosuj. Wszystkie zmienne są opcjonalne, jeśli nie zaznaczono inaczej.

### Serwer

| Zmienna | Domyślna | Opis |
|----------|---------|-------------|
| `SIDJUA_PORT` | `3000` | Port nasłuchiwania REST API |
| `SIDJUA_HOST` | `127.0.0.1` | Adres powiązania REST API. Użyj `0.0.0.0` dla dostępu zdalnego |
| `NODE_ENV` | `production` | Tryb środowiska wykonawczego (`production` lub `development`) |
| `SIDJUA_API_KEY` | Automatycznie generowany | Token bearer REST API. Automatycznie tworzony przy pierwszym uruchomieniu, jeśli go nie ma |
| `SIDJUA_MAX_BODY_SIZE` | `2097152` (2 MiB) | Maksymalny rozmiar treści przychodzącego żądania w bajtach |

### Nadpisania katalogów

| Zmienna | Domyślna | Opis |
|----------|---------|-------------|
| `SIDJUA_DATA_DIR` | `<workspace>/data` | Nadpisz lokalizację katalogu danych |
| `SIDJUA_CONFIG_DIR` | `<workspace>` | Nadpisz lokalizację katalogu konfiguracyjnego |
| `SIDJUA_LOG_DIR` | `<workspace>/logs` | Nadpisz lokalizację katalogu dzienników |

### Wyszukiwanie semantyczne

| Zmienna | Domyślna | Opis |
|----------|---------|-------------|
| `SIDJUA_QDRANT_URL` | `http://localhost:6333` | Punkt końcowy wektorowej bazy danych Qdrant. Domyślna Docker: `http://qdrant:6333` |
| `OPENAI_API_KEY` | — | Wymagany dla osadzeń OpenAI `text-embedding-3-large` |
| `SIDJUA_CF_ACCOUNT_ID` | — | Identyfikator konta Cloudflare dla bezpłatnych osadzeń |
| `SIDJUA_CF_TOKEN` | — | Token API Cloudflare dla bezpłatnych osadzeń |

### Dostawcy LLM

| Zmienna | Dostawca |
|----------|----------|
| `ANTHROPIC_API_KEY` | Anthropic (Claude) |
| `OPENAI_API_KEY` | OpenAI (GPT-4, osadzenia) |
| `GOOGLE_AI_API_KEY` | Google AI (Gemini) |
| `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` | Cloudflare Workers AI (bezpłatny poziom) |
| `GROQ_API_KEY` | Groq (szybkie wnioskowanie, dostępny bezpłatny poziom) |
| `DEEPSEEK_API_KEY` | DeepSeek |

---

## 6. Konfiguracja dostawcy

### Opcja bez konfiguracji

`sidjua chat guide` działa bez żadnego klucza API. Łączy się z Cloudflare Workers AI przez proxy SIDJUA. Ograniczona szybkością, ale odpowiednia do oceny i wdrożenia.

### Dodawanie pierwszego dostawcy

**Groq (bezpłatny poziom, bez karty kredytowej):**
```bash
sidjua key set groq <your-groq-api-key>
sidjua provider list
```
Uzyskaj bezpłatny klucz na [console.groq.com](https://console.groq.com).

**Anthropic (zalecany do produkcji):**
```bash
export ANTHROPIC_API_KEY=sk-ant-...
sidjua key set anthropic $ANTHROPIC_API_KEY
```

**Ollama (wdrożenie odizolowane / lokalne):**
```bash
sidjua provider add-custom \
  --id ollama \
  --name "Ollama (local)" \
  --base-url http://localhost:11434/v1 \
  --model llama3.2
```

Zweryfikuj wszystkich skonfigurowanych dostawców:
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

## 8. Sandboxing agentów

SIDJUA używa podłączalnego interfejsu `SandboxProvider`. Sandbox opakowuje wykonanie umiejętności agenta w izolację procesu na poziomie systemu operacyjnego.

### Obsługa sandboxa według platformy

| Platforma | Dostawca sandboxa | Uwagi |
|----------|-----------------|-------|
| Linux (natywny) | `bubblewrap` | Pełna izolacja przestrzeni nazw użytkownika |
| Docker (kontener Linux) | `bubblewrap` | Wymaga `--cap-add=SYS_ADMIN` |
| macOS | `none` (automatyczne przełączenie awaryjne) | macOS nie obsługuje przestrzeni nazw użytkownika Linux |
| Windows WSL2 | `bubblewrap` | Zainstaluj jak w systemie Linux wewnątrz WSL2 |
| Windows (natywny) | `none` (automatyczne przełączenie awaryjne) | |

### Instalacja bubblewrap (Linux)

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

### Konfiguracja

W `divisions.yaml`:
```yaml
governance:
  sandbox: bubblewrap    # lub: none
```

Zweryfikuj dostępność sandboxa:
```bash
sidjua sandbox check
```

---

## 9. Wyszukiwanie semantyczne (opcjonalne)

Wyszukiwanie semantyczne obsługuje `sidjua memory search` i pobieranie wiedzy agentów. Wymaga wektorowej bazy danych Qdrant i dostawcy osadzeń.

### Profil Docker Compose

Dołączony `docker-compose.yml` ma profil `semantic-search`:
```bash
docker compose --profile semantic-search up -d
```
Uruchamia to kontener Qdrant obok SIDJUA.

### Samodzielny Qdrant

```bash
docker run -d \
  --name sidjua-qdrant \
  -p 6333:6333 \
  -v qdrant-storage:/qdrant/storage \
  qdrant/qdrant:v1.13.2
```

Ustaw punkt końcowy:
```bash
export SIDJUA_QDRANT_URL=http://localhost:6333
```

### Bez Qdrant

Jeśli Qdrant nie jest dostępny, `sidjua memory import` i `sidjua memory search` są wyłączone. Wszystkie inne funkcje SIDJUA (CLI, REST API, wykonywanie agentów, zarządzanie, audyt) działają normalnie. System przełącza się na wyszukiwanie słów kluczowych BM25 dla wszelkich zapytań o wiedzę.

---

## 10. Rozwiązywanie problemów

### Wszystkie platformy

**`npm ci` kończy się niepowodzeniem z błędami `node-pre-gyp` lub `node-gyp`:**
```
gyp ERR! build error
```
Zainstaluj łańcuch narzędzi C/C++ (patrz sekcja Wymagania wstępne). W Ubuntu: `sudo apt-get install -y python3 make g++ build-essential`.

**`Cannot find divisions.yaml`:**
Sprawdź `SIDJUA_CONFIG_DIR`. Plik musi znajdować się pod adresem `$SIDJUA_CONFIG_DIR/divisions.yaml`. Uruchom `sidjua init`, aby utworzyć strukturę obszaru roboczego.

**REST API zwraca 401 Unauthorized:**
Zweryfikuj nagłówek `Authorization: Bearer <key>`. Pobierz automatycznie wygenerowany klucz za pomocą:
```bash
cat ~/.sidjua/.system/api-key          # instalacja ręczna
docker compose exec sidjua cat /app/.system/api-key  # Docker
```

**Port 3000 jest już używany:**
```bash
SIDJUA_PORT=3001 sidjua server start
# lub ustaw w .env: SIDJUA_PORT=3001
```

---

### Ubuntu / Debian

**`better-sqlite3` nie kompiluje się z powodu nieznalezionego `futex.h`:**
```bash
sudo apt-get install -y linux-headers-$(uname -r)
```

---

### Fedora / RHEL

**SELinux blokuje montowanie wolumenów Docker:**
```yaml
# Dodaj etykietę :Z dla kontekstu SELinux
volumes:
  - ./my-config:/app/config:Z
```
Lub ustaw kontekst SELinux ręcznie:
```bash
chcon -Rt svirt_sandbox_file_t ./my-config
```

---

### Arch Linux

**Wersja Node.js jest zbyt stara:**
Użyj `nvm`, aby zainstalować Node.js 22:
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

**Docker Desktop kończy się brakiem pamięci:**
Otwórz Docker Desktop → Settings → Resources → Memory. Zwiększ do co najmniej 4 GB.

**Apple Silicon — niezgodność architektury:**
Sprawdź, czy instalacja Node.js jest natywnym ARM64 (nie Rosetta):
```bash
node -e "console.log(process.arch)"
# oczekiwano: arm64
```
Jeśli wypisuje `x64`, zainstaluj ponownie Node.js za pomocą instalatora ARM64 z nodejs.org.

---

### Windows (natywny)

**Nie znaleziono `MSBuild` lub `cl.exe`:**
Zainstaluj [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) i wybierz obciążenie **Desktop development with C++**. Następnie uruchom:
```powershell
npm install --global windows-build-tools
```

**Błędy długich ścieżek (`ENAMETOOLONG`):**
Włącz obsługę długich ścieżek w rejestrze systemu Windows:
```powershell
# Uruchom jako Administrator
Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" `
  -Name LongPathsEnabled -Value 1
```

**Polecenie `sidjua` nie znaleziono po `npm install -g`:**
Dodaj globalny katalog bin npm do zmiennej PATH:
```powershell
npm config get prefix  # pokazuje np. C:\Users\you\AppData\Roaming\npm
# Dodaj tę ścieżkę do Zmiennych środowiskowych systemu → Path
```

---

### Windows WSL2

**Docker nie uruchamia się wewnątrz WSL2:**
Otwórz Docker Desktop → Settings → General → włącz **Use the WSL 2 based engine**.
Następnie zrestartuj Docker Desktop i terminal WSL2.

**Błędy uprawnień do plików pod `/mnt/c/`:**
Wolumeny Windows NTFS zamontowane w WSL2 mają ograniczone uprawnienia. Przenieś obszar roboczy na ścieżkę natywną dla Linuksa:
```bash
mkdir ~/sidjua-workspace
cd ~/sidjua-workspace
sidjua init
```

---

### Raspberry Pi / ARM64

**`npm ci` jest bardzo wolne (5–10 minut):**
To jest normalne. Kompilacja natywnych dodatków na ARM64 trwa dłużej. Rozważ zamiast tego użycie obrazu Docker:
```bash
docker pull sidjua/sidjua:latest-arm64
```

**Brak pamięci podczas kompilacji:**
Dodaj przestrzeń wymiany:
```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

---

## 11. Dokumentacja wolumenów Docker

### Nazwane wolumeny

| Nazwa wolumenu | Ścieżka kontenera | Cel |
|-------------|---------------|---------|
| `sidjua-data` | `/app/data` | Bazy danych SQLite, archiwa kopii zapasowych, kolekcje wiedzy |
| `sidjua-config` | `/app/config` | `divisions.yaml`, niestandardowa konfiguracja |
| `sidjua-logs` | `/app/logs` | Strukturalne dzienniki aplikacji |
| `sidjua-system` | `/app/.system` | Klucz API, stan aktualizacji, plik blokady procesu |
| `sidjua-workspace` | `/app/agents` | Katalogi umiejętności agentów, definicje, szablony |
| `sidjua-governance` | `/app/governance` | Niezmienna ścieżka audytu, migawki zarządzania |
| `qdrant-storage` | `/qdrant/storage` | Indeks wektorowy Qdrant (tylko profil wyszukiwania semantycznego) |

### Używanie katalogu hosta

Aby zamontować własny plik `divisions.yaml` zamiast edytować go wewnątrz kontenera:

```yaml
# docker-compose.override.yml
services:
  sidjua:
    volumes:
      - ./my-config:/app/config   # zastępuje nazwany wolumen sidjua-config
```

### Kopia zapasowa

```bash
sidjua backup create                    # z wnętrza kontenera
# lub
docker compose exec sidjua sidjua backup create
```

Kopie zapasowe to archiwa podpisane HMAC przechowywane w `/app/data/backups/`.

---

## 12. Aktualizacja

### Docker

```bash
git pull
docker compose build --no-cache
docker compose up -d
docker compose exec sidjua sidjua apply    # uruchom migracje schematu
```

`sidjua apply` jest idempotentne — zawsze bezpieczne do ponownego uruchomienia po aktualizacji.

### Globalna instalacja npm

```bash
npm update -g sidjua
sidjua apply    # uruchom migracje schematu
```

### Kompilacja ze źródeł

```bash
git pull
npm ci
npm run build
node dist/index.js apply    # uruchom migracje schematu
```

### Wycofanie zmian

SIDJUA tworzy migawkę zarządzania przed każdym `sidjua apply`. Aby przywrócić:

```bash
sidjua rollback list
sidjua rollback <version>
```

---

## 13. Kolejne kroki

| Zasób | Polecenie / Link |
|----------|---------------|
| Szybki start | [docs/QUICK-START.md](QUICK-START.md) |
| Dokumentacja CLI | [docs/CLI-REFERENCE.md](CLI-REFERENCE.md) |
| Przykłady zarządzania | [docs/GOVERNANCE-EXAMPLES.md](GOVERNANCE-EXAMPLES.md) |
| Przewodnik po bezpłatnych dostawcach LLM | [docs/FREE-LLM-PROVIDER-GUIDE.md](FREE-LLM-PROVIDER-GUIDE.md) |
| Rozwiązywanie problemów | [docs/TROUBLESHOOTING.md](TROUBLESHOOTING.md) |

Pierwsze polecenia do uruchomienia po instalacji:

```bash
sidjua chat guide    # przewodnik AI bez konfiguracji — klucz API nie jest wymagany
sidjua selftest      # kontrola stanu systemu (7 kategorii, wynik 0-100)
sidjua apply         # provisioning agentów z divisions.yaml
```
