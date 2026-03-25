> Dieses Dokument ist KI-übersetzt aus dem [englischen Original](../INSTALLATION.md). Fehler gefunden? [Melden Sie es](https://github.com/GoetzKohlberg/sidjua/issues).

# SIDJUA Installationsanleitung

SIDJUA Version: 1.0.0 | Lizenz: AGPL-3.0-only | Aktualisiert: 2026-03-25

## Inhaltsverzeichnis

1. [Plattform-Unterstützungsmatrix](#1-plattform-unterstützungsmatrix)
2. [Voraussetzungen](#2-voraussetzungen)
3. [Installationsmethoden](#3-installationsmethoden)
4. [Verzeichnisstruktur](#4-verzeichnisstruktur)
5. [Umgebungsvariablen](#5-umgebungsvariablen)
6. [Provider-Konfiguration](#6-provider-konfiguration)
7. [Desktop-GUI (Optional)](#7-desktop-gui-optional)
8. [Agent-Sandboxing](#8-agent-sandboxing)
9. [Semantische Suche (Optional)](#9-semantische-suche-optional)
10. [Fehlerbehebung](#10-fehlerbehebung)
11. [Docker-Volume-Referenz](#11-docker-volume-referenz)
12. [Aktualisierung](#12-aktualisierung)
13. [Nächste Schritte](#13-nächste-schritte)

---

## 1. Plattform-Unterstützungsmatrix

| Funktion | Linux | macOS | Windows WSL2 | Windows (nativ) |
|---------|-------|-------|--------------|------------------|
| CLI + REST API | ✅ Vollständig | ✅ Vollständig | ✅ Vollständig | ✅ Vollständig |
| Docker | ✅ Vollständig | ✅ Docker Desktop | ✅ Docker Desktop | ✅ Docker Desktop |
| Sandboxing (bubblewrap) | ✅ Vollständig | ❌ Fällt auf `none` zurück | ✅ Vollständig (innerhalb WSL2) | ❌ Fällt auf `none` zurück |
| Web Management Console | ✅ Full | ✅ Full | ✅ Full | ✅ Full |
| Semantische Suche (Qdrant) | ✅ | ✅ | ✅ | ✅ |

**Hinweis zu bubblewrap:** Linux-Benutzernamensraum-Sandboxing. macOS und Windows nativ fallen automatisch auf den Sandbox-Modus `none` zurück — keine Konfiguration erforderlich.

---

## 2. Voraussetzungen

### Node.js >= 22.0.0

**Warum:** SIDJUA verwendet ES-Module, natives `fetch()` und `crypto.subtle` — alles erfordert Node.js 22+.

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

**macOS (.pkg-Installationsprogramm):** Herunterladen von [nodejs.org/en/download](https://nodejs.org/en/download).

**Windows (winget):**
```powershell
winget install OpenJS.NodeJS.LTS
```

**Windows (.msi):** Herunterladen von [nodejs.org/en/download](https://nodejs.org/en/download).

**WSL2:** Verwenden Sie die Ubuntu/Debian-Anweisungen oben in Ihrem WSL2-Terminal.

Überprüfen:
```bash
node --version   # muss >= 22.0.0 sein
npm --version    # muss >= 10.0.0 sein
```

---

### C/C++-Toolchain (nur für Quell-Builds)

**Warum:** `better-sqlite3` und `argon2` kompilieren native Node.js-Addons während `npm ci`. Docker-Benutzer überspringen dies.

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

**Windows:** Installieren Sie [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) mit der Arbeitsauslastung **Desktopentwicklung mit C++**, dann:
```powershell
npm install --global windows-build-tools
```

**Alpine Linux:**
```bash
apk add python3 make g++ build-base linux-headers
```

---

### Docker >= 24 (optional)

Nur für die Docker-Installationsmethode erforderlich. Das Docker Compose V2-Plugin (`docker compose`) muss verfügbar sein.

**Linux:** Folgen Sie den Anweisungen unter [docs.docker.com/engine/install](https://docs.docker.com/engine/install/).
Docker Compose V2 ist in Docker Engine >= 24 enthalten.

**macOS / Windows:** Installieren Sie [Docker Desktop](https://www.docker.com/products/docker-desktop/) (enthält Docker Compose V2).

Überprüfen:
```bash
docker --version          # muss >= 24.0.0 sein
docker compose version    # muss v2.x.x anzeigen
```

---

### Git

Jede aktuelle Version. Installieren Sie über Ihren OS-Paketmanager oder [git-scm.com](https://git-scm.com).

---

## 3. Installationsmethoden

### Methode A — Docker (Empfohlen)

Der schnellste Weg zu einer funktionierenden SIDJUA-Installation. Alle Abhängigkeiten sind im Image gebündelt.

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
docker compose up -d
```

Warten Sie, bis die Dienste betriebsbereit sind (bis zu ~60 Sekunden beim ersten Build):

```bash
docker compose ps
# NAME              STATUS
# sidjua            Up X seconds (healthy)
# sidjua-qdrant     Up X seconds (healthy)
```

Den automatisch generierten API-Schlüssel abrufen:

```bash
docker compose exec sidjua cat /app/.system/api-key
```

Governance aus Ihrer `divisions.yaml` einrichten:

```bash
docker compose exec sidjua sidjua apply --verbose
```

Systemintegritätsprüfung ausführen:

```bash
docker compose exec sidjua sidjua selftest
```

**ARM64-Hinweis:** Das Docker-Image wird auf `node:22-alpine` erstellt, das `linux/amd64` und `linux/arm64` unterstützt. Raspberry Pi (64-Bit) und Apple Silicon Macs (über Docker Desktop) werden sofort unterstützt.

**Bubblewrap in Docker:** Um Agent-Sandboxing innerhalb des Containers zu aktivieren, fügen Sie `--cap-add=SYS_ADMIN` zu Ihrem Docker-Ausführungsbefehl hinzu oder legen Sie es in `docker-compose.yml` fest:
```yaml
cap_add:
  - SYS_ADMIN
```

---

### Methode B — npm Globale Installation

```bash
npm install -g sidjua
```

Den interaktiven Einrichtungsassistenten ausführen (3 Schritte: Arbeitsbereichsort, Provider, erster Agent):
```bash
sidjua init
```

Für nicht-interaktive CI- oder Container-Umgebungen:
```bash
sidjua init --yes
```

Den Zero-Config-KI-Leitfaden starten (kein API-Schlüssel erforderlich):
```bash
sidjua chat guide
```

---

### Methode C — Quell-Build

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
npm ci
npm run build
```

Der Build-Prozess verwendet `tsup`, um `src/index.ts` zu kompilieren in:
- `dist/index.js` (ESM)
- `dist/index.cjs` (CommonJS)

Nach dem Build werden i18n-Locale-Dateien, Standardrollen, Divisionen und Wissensdatenbank-Vorlagen in `dist/` kopiert.

Aus der Quelle ausführen:
```bash
node dist/index.js --help
```

Die Testsuite ausführen:
```bash
npm test                    # alle Tests
npm run test:coverage       # mit Abdeckungsbericht
npx tsc --noEmit            # nur Typprüfung
```

---

## 4. Verzeichnisstruktur

### Docker-Bereitstellungspfade

| Pfad | Docker-Volume | Zweck | Verwaltet von |
|------|---------------|---------|------------|
| `/app/dist/` | Image-Schicht | Kompilierte Anwendung | SIDJUA |
| `/app/node_modules/` | Image-Schicht | Node.js-Abhängigkeiten | SIDJUA |
| `/app/system/` | Image-Schicht | Integrierte Standardwerte und Vorlagen | SIDJUA |
| `/app/defaults/` | Image-Schicht | Standard-Konfigurationsdateien | SIDJUA |
| `/app/docs/` | Image-Schicht | Mitgelieferte Dokumentation | SIDJUA |
| `/app/data/` | `sidjua-data` | SQLite-Datenbanken, Backups, Wissenssammlungen | Benutzer |
| `/app/config/` | `sidjua-config` | `divisions.yaml` und benutzerdefinierte Konfiguration | Benutzer |
| `/app/logs/` | `sidjua-logs` | Strukturierte Protokolldateien | Benutzer |
| `/app/.system/` | `sidjua-system` | API-Schlüssel, Aktualisierungsstatus, Prozesssperre | SIDJUA verwaltet |
| `/app/agents/` | `sidjua-workspace` | Agent-Definitionen, Fähigkeiten, Vorlagen | Benutzer |
| `/app/governance/` | `sidjua-governance` | Prüfpfad, Governance-Snapshots | Benutzer |

---

### Manuelle / npm-Installationspfade

Nach `sidjua init` ist Ihr Arbeitsbereich wie folgt organisiert:

```
~/sidjua-workspace/           # oder SIDJUA_CONFIG_DIR
├── divisions.yaml            # Ihre Governance-Konfiguration
├── .sidjua/                  # Interner Zustand (WAL, Telemetriepuffer)
│   └── telemetry.db
├── data/
│   ├── sidjua.db             # Hauptdatenbank (Agents, Aufgaben, Prüfung, Kosten)
│   ├── knowledge/            # Agent-spezifische Wissensdatenbanken
│   │   └── <agent-id>.db
│   └── backups/              # HMAC-signierte Backup-Archive
├── agents/                   # Agent-Fähigkeitsverzeichnisse
├── governance/               # Prüfpfad (nur anhängen)
├── logs/                     # Anwendungsprotokolle
└── system/                   # Laufzeitzustand
```

---

### SQLite-Datenbanken

| Datenbank | Pfad | Inhalt |
|----------|------|----------|
| Haupt | `data/sidjua.db` | Agents, Aufgaben, Kosten, Governance-Snapshots, API-Schlüssel, Prüfprotokoll |
| Telemetrie | `.sidjua/telemetry.db` | Optionale Opt-in-Fehlerberichte (PII-bereinigt) |
| Wissen | `data/knowledge/<agent-id>.db` | Agent-spezifische Vektoreinbettungen und BM25-Index |

SQLite-Datenbanken sind Einzeldateien, plattformübergreifend und portabel. Erstellen Sie Backups mit `sidjua backup create`.

---

## 5. Umgebungsvariablen

Kopieren Sie `.env.example` nach `.env` und passen Sie es an. Alle Variablen sind optional, sofern nicht anders angegeben.

### Server

| Variable | Standard | Beschreibung |
|----------|---------|-------------|
| `SIDJUA_PORT` | `3000` | REST API-Überwachungsport |
| `SIDJUA_HOST` | `127.0.0.1` | REST API-Bind-Adresse. Verwenden Sie `0.0.0.0` für Fernzugriff |
| `NODE_ENV` | `production` | Laufzeitmodus (`production` oder `development`) |
| `SIDJUA_API_KEY` | Automatisch generiert | REST API-Bearer-Token. Wird beim ersten Start automatisch erstellt, wenn nicht vorhanden |
| `SIDJUA_MAX_BODY_SIZE` | `2097152` (2 MiB) | Maximale Größe des eingehenden Anforderungstexts in Bytes |

### Verzeichnis-Überschreibungen

| Variable | Standard | Beschreibung |
|----------|---------|-------------|
| `SIDJUA_DATA_DIR` | `<workspace>/data` | Speicherort des Datenverzeichnisses überschreiben |
| `SIDJUA_CONFIG_DIR` | `<workspace>` | Speicherort des Konfigurationsverzeichnisses überschreiben |
| `SIDJUA_LOG_DIR` | `<workspace>/logs` | Speicherort des Protokollverzeichnisses überschreiben |

### Semantische Suche

| Variable | Standard | Beschreibung |
|----------|---------|-------------|
| `SIDJUA_QDRANT_URL` | `http://localhost:6333` | Qdrant-Vektordatenbank-Endpunkt. Docker-Standard: `http://qdrant:6333` |
| `OPENAI_API_KEY` | — | Erforderlich für OpenAI `text-embedding-3-large`-Einbettungen |
| `SIDJUA_CF_ACCOUNT_ID` | — | Cloudflare-Konto-ID für kostenlose Einbettungen |
| `SIDJUA_CF_TOKEN` | — | Cloudflare API-Token für kostenlose Einbettungen |

### LLM-Provider

| Variable | Provider |
|----------|----------|
| `ANTHROPIC_API_KEY` | Anthropic (Claude) |
| `OPENAI_API_KEY` | OpenAI (GPT-4, Einbettungen) |
| `GOOGLE_AI_API_KEY` | Google AI (Gemini) |
| `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` | Cloudflare Workers AI (kostenlose Stufe) |
| `GROQ_API_KEY` | Groq (schnelle Inferenz, kostenlose Stufe verfügbar) |
| `DEEPSEEK_API_KEY` | DeepSeek |

---

## 6. Provider-Konfiguration

### Zero-Config-Option

`sidjua chat guide` funktioniert ohne API-Schlüssel. Es stellt eine Verbindung zu Cloudflare Workers AI über den SIDJUA-Proxy her. Ratenbegrenzt, aber geeignet für Evaluierung und Einarbeitung.

### Ersten Provider hinzufügen

**Groq (kostenlose Stufe, keine Kreditkarte erforderlich):**
```bash
sidjua key set groq <your-groq-api-key>
sidjua provider list
```
Holen Sie sich einen kostenlosen Schlüssel unter [console.groq.com](https://console.groq.com).

**Anthropic (empfohlen für Produktion):**
```bash
export ANTHROPIC_API_KEY=sk-ant-...
sidjua key set anthropic $ANTHROPIC_API_KEY
```

**Ollama (Air-Gap / lokale Bereitstellung):**
```bash
sidjua provider add-custom \
  --id ollama \
  --name "Ollama (local)" \
  --base-url http://localhost:11434/v1 \
  --model llama3.2
```

Alle konfigurierten Provider validieren:
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

## 8. Agent-Sandboxing

SIDJUA verwendet eine pluggable `SandboxProvider`-Schnittstelle. Die Sandbox umschließt die Ausführung von Agent-Fähigkeiten in OS-level-Prozessisolierung.

### Sandbox-Unterstützung nach Plattform

| Plattform | Sandbox-Provider | Hinweise |
|----------|-----------------|-------|
| Linux (nativ) | `bubblewrap` | Vollständige Benutzernamensraum-Isolierung |
| Docker (Linux-Container) | `bubblewrap` | Erfordert `--cap-add=SYS_ADMIN` |
| macOS | `none` (automatischer Fallback) | macOS unterstützt keine Linux-Benutzernamensräume |
| Windows WSL2 | `bubblewrap` | Wie auf Linux innerhalb WSL2 installieren |
| Windows (nativ) | `none` (automatischer Fallback) | |

### bubblewrap installieren (Linux)

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

In `divisions.yaml`:
```yaml
governance:
  sandbox: bubblewrap    # oder: none
```

Sandbox-Verfügbarkeit überprüfen:
```bash
sidjua sandbox check
```

---

## 9. Semantische Suche (Optional)

Semantische Suche unterstützt `sidjua memory search` und den Wissensabruf von Agents. Sie erfordert eine Qdrant-Vektordatenbank und einen Einbettungs-Provider.

### Docker Compose-Profil

Das enthaltene `docker-compose.yml` hat ein `semantic-search`-Profil:
```bash
docker compose --profile semantic-search up -d
```
Dadurch wird ein Qdrant-Container neben SIDJUA gestartet.

### Eigenständiges Qdrant

```bash
docker run -d \
  --name sidjua-qdrant \
  -p 6333:6333 \
  -v qdrant-storage:/qdrant/storage \
  qdrant/qdrant:v1.13.2
```

Den Endpunkt festlegen:
```bash
export SIDJUA_QDRANT_URL=http://localhost:6333
```

### Ohne Qdrant

Wenn Qdrant nicht verfügbar ist, sind `sidjua memory import` und `sidjua memory search` deaktiviert. Alle anderen SIDJUA-Funktionen (CLI, REST API, Agent-Ausführung, Governance, Prüfung) funktionieren normal. Das System fällt für alle Wissensabfragen auf BM25-Stichwortsuche zurück.

---

## 10. Fehlerbehebung

### Alle Plattformen

**`npm ci` schlägt mit `node-pre-gyp`- oder `node-gyp`-Fehlern fehl:**
```
gyp ERR! build error
```
Installieren Sie die C/C++-Toolchain (siehe Abschnitt Voraussetzungen). Unter Ubuntu: `sudo apt-get install -y python3 make g++ build-essential`.

**`Cannot find divisions.yaml`:**
Überprüfen Sie `SIDJUA_CONFIG_DIR`. Die Datei muss sich unter `$SIDJUA_CONFIG_DIR/divisions.yaml` befinden. Führen Sie `sidjua init` aus, um die Arbeitsbereichsstruktur zu erstellen.

**REST API gibt 401 Unauthorized zurück:**
Überprüfen Sie den `Authorization: Bearer <key>`-Header. Rufen Sie den automatisch generierten Schlüssel ab mit:
```bash
cat ~/.sidjua/.system/api-key          # manuelle Installation
docker compose exec sidjua cat /app/.system/api-key  # Docker
```

**Port 3000 bereits in Verwendung:**
```bash
SIDJUA_PORT=3001 sidjua server start
# oder in .env festlegen: SIDJUA_PORT=3001
```

---

### Ubuntu / Debian

**`better-sqlite3` lässt sich nicht kompilieren, `futex.h` nicht gefunden:**
```bash
sudo apt-get install -y linux-headers-$(uname -r)
```

---

### Fedora / RHEL

**SELinux blockiert Docker-Volume-Mounts:**
```yaml
# :Z-Label für SELinux-Kontext hinzufügen
volumes:
  - ./my-config:/app/config:Z
```
Oder den SELinux-Kontext manuell festlegen:
```bash
chcon -Rt svirt_sandbox_file_t ./my-config
```

---

### Arch Linux

**Node.js-Version zu alt:**
Verwenden Sie `nvm`, um Node.js 22 zu installieren:
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

**Docker Desktop geht der Speicher aus:**
Öffnen Sie Docker Desktop → Einstellungen → Ressourcen → Arbeitsspeicher. Erhöhen Sie auf mindestens 4 GB.

**Apple Silicon — Architekturkonflikte:**
Überprüfen Sie, ob Ihre Node.js-Installation nativ ARM64 ist (nicht Rosetta):
```bash
node -e "console.log(process.arch)"
# erwartet: arm64
```
Wenn `x64` ausgegeben wird, installieren Sie Node.js mit dem ARM64-Installationsprogramm von nodejs.org neu.

---

### Windows (nativ)

**`MSBuild` oder `cl.exe` nicht gefunden:**
Installieren Sie [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) und wählen Sie die Arbeitsauslastung **Desktopentwicklung mit C++**. Führen Sie dann aus:
```powershell
npm install --global windows-build-tools
```

**Lange Pfadfehler (`ENAMETOOLONG`):**
Aktivieren Sie die Unterstützung langer Pfade in der Windows-Registrierung:
```powershell
# Als Administrator ausführen
Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" `
  -Name LongPathsEnabled -Value 1
```

**`sidjua`-Befehl nach `npm install -g` nicht gefunden:**
Fügen Sie das globale npm-bin-Verzeichnis zu Ihrem PATH hinzu:
```powershell
npm config get prefix  # zeigt z.B. C:\Users\you\AppData\Roaming\npm
# Diesen Pfad zu Systemumgebungsvariablen → Pfad hinzufügen
```

---

### Windows WSL2

**Docker startet nicht innerhalb von WSL2:**
Öffnen Sie Docker Desktop → Einstellungen → Allgemein → aktivieren Sie **WSL 2-basierte Engine verwenden**.
Starten Sie dann Docker Desktop und Ihr WSL2-Terminal neu.

**Berechtigungsfehler bei Dateien unter `/mnt/c/`:**
Unter WSL2 eingebundene Windows NTFS-Volumes haben eingeschränkte Berechtigungen. Verschieben Sie Ihren Arbeitsbereich in einen Linux-nativen Pfad:
```bash
mkdir ~/sidjua-workspace
cd ~/sidjua-workspace
sidjua init
```

---

### Raspberry Pi / ARM64

**`npm ci` ist sehr langsam (5-10 Minuten):**
Das ist normal. Die Kompilierung nativer Addons auf ARM64 dauert länger. Erwägen Sie stattdessen die Verwendung des Docker-Images:
```bash
docker pull sidjua/sidjua:latest-arm64
```

**Speicherknappheit während des Builds:**
Swap-Speicher hinzufügen:
```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

---

## 11. Docker-Volume-Referenz

### Benannte Volumes

| Volume-Name | Container-Pfad | Zweck |
|-------------|---------------|---------|
| `sidjua-data` | `/app/data` | SQLite-Datenbanken, Backup-Archive, Wissenssammlungen |
| `sidjua-config` | `/app/config` | `divisions.yaml`, benutzerdefinierte Konfiguration |
| `sidjua-logs` | `/app/logs` | Strukturierte Anwendungsprotokolle |
| `sidjua-system` | `/app/.system` | API-Schlüssel, Aktualisierungsstatus, Prozesssperrdatei |
| `sidjua-workspace` | `/app/agents` | Agent-Fähigkeitsverzeichnisse, Definitionen, Vorlagen |
| `sidjua-governance` | `/app/governance` | Unveränderlicher Prüfpfad, Governance-Snapshots |
| `qdrant-storage` | `/qdrant/storage` | Qdrant-Vektorindex (nur semantisches Suchprofil) |

### Hostverzeichnis verwenden

So binden Sie Ihre eigene `divisions.yaml` ein, anstatt sie innerhalb des Containers zu bearbeiten:

```yaml
# docker-compose.override.yml
services:
  sidjua:
    volumes:
      - ./my-config:/app/config   # ersetzt das benannte sidjua-config-Volume
```

### Backup

```bash
sidjua backup create                    # von innerhalb des Containers
# oder
docker compose exec sidjua sidjua backup create
```

Backups sind HMAC-signierte Archive, die in `/app/data/backups/` gespeichert werden.

---

## 12. Aktualisierung

### Docker

```bash
git pull
docker compose build --no-cache
docker compose up -d
docker compose exec sidjua sidjua apply    # Schema-Migrationen ausführen
```

`sidjua apply` ist idempotent — immer sicher, nach einem Upgrade erneut auszuführen.

### npm Globale Installation

```bash
npm update -g sidjua
sidjua apply    # Schema-Migrationen ausführen
```

### Quell-Build

```bash
git pull
npm ci
npm run build
node dist/index.js apply    # Schema-Migrationen ausführen
```

### Rollback

SIDJUA erstellt vor jedem `sidjua apply` einen Governance-Snapshot. So können Sie zurücksetzen:

```bash
sidjua rollback list
sidjua rollback <version>
```

---

## 13. Nächste Schritte

| Ressource | Befehl / Link |
|----------|---------------|
| Schnellstart | [docs/QUICK-START.md](QUICK-START.md) |
| CLI-Referenz | [docs/CLI-REFERENCE.md](CLI-REFERENCE.md) |
| Governance-Beispiele | [docs/GOVERNANCE-EXAMPLES.md](GOVERNANCE-EXAMPLES.md) |
| Leitfaden für kostenlose LLM-Provider | [docs/FREE-LLM-PROVIDER-GUIDE.md](FREE-LLM-PROVIDER-GUIDE.md) |
| Fehlerbehebung | [docs/TROUBLESHOOTING.md](TROUBLESHOOTING.md) |

Erste Befehle nach der Installation:

```bash
sidjua chat guide    # Zero-Config-KI-Leitfaden — kein API-Schlüssel erforderlich
sidjua selftest      # Systemintegritätsprüfung (7 Kategorien, 0-100 Punkte)
sidjua apply         # Agents aus divisions.yaml bereitstellen
```
