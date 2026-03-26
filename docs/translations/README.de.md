[English](../../README.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [Français](README.fr.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [中文 (简体)](README.zh-CN.md) | [中文 (繁體)](README.zh-TW.md) | [العربية](README.ar.md) | [বাংলা](README.bn.md) | [Čeština](README.cs.md) | [Filipino](README.fil.md) | [हिन्दी](README.hi.md) | [Bahasa Indonesia](README.id.md) | [Italiano](README.it.md) | [Bahasa Melayu](README.ms.md) | [Nederlands](README.nl.md) | [Polski](README.pl.md) | [Português (BR)](README.pt-BR.md) | [Română](README.ro.md) | [Русский](README.ru.md) | [Svenska](README.sv.md) | [ภาษาไทย](README.th.md) | [Türkçe](README.tr.md) | [Українська](README.uk.md) | [Tiếng Việt](README.vi.md)

> *Diese Seite wurde automatisch aus dem [englischen Original](../../README.md) übersetzt. Fehler gefunden? [Melden Sie es](https://github.com/GoetzKohlberg/sidjua/issues).*

---

# SIDJUA — Die KI-Agent-Governance-Plattform

> Die einzige Agent-Plattform, bei der Governance durch Architektur durchgesetzt wird — nicht durch die Hoffnung, dass das Modell sich korrekt verhält.

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Docker](https://img.shields.io/badge/Docker-ghcr.io%2Fgoetzkohlberg%2Fsidjua-blue)](https://ghcr.io/goetzkohlberg/sidjua)
[![Version](https://img.shields.io/badge/version-1.0.0-green)](https://github.com/GoetzKohlberg/sidjua/releases)

---

## Installation

### Voraussetzungen

| Werkzeug | Erforderlich | Hinweise |
|---------|--------------|---------|
| **Node.js** | >= 22.0.0 | ES-Module, `fetch()`, `crypto.subtle`. [Herunterladen](https://nodejs.org) |
| **C/C++ Toolchain** | Nur für Quell-Builds | `better-sqlite3` und `argon2` kompilieren native Add-ons |
| **Docker** | >= 24 (optional) | Nur für Docker-Deployment |

Node.js 22 installieren: Ubuntu/Debian (`curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs`), macOS (`brew install node@22`), Windows (`winget install OpenJS.NodeJS.LTS`).

C/C++-Tools installieren: Ubuntu (`sudo apt-get install -y python3 make g++ build-essential`), macOS (`xcode-select --install`), Windows (`npm install --global windows-build-tools`).

### Option A — Docker (Empfohlen)

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
docker compose up -d
```

```bash
# Automatisch generierten API-Schlüssel anzeigen
docker compose exec sidjua cat /app/.system/api-key

# Governance einrichten
docker compose exec sidjua sidjua apply --verbose

# System-Gesundheitsprüfung
docker compose exec sidjua sidjua selftest
```

Unterstützt **linux/amd64** und **linux/arm64** (Raspberry Pi, Apple Silicon).

### Option B — Globale npm-Installation

```bash
npm install -g sidjua
sidjua init          # Interaktive 3-Schritt-Einrichtung
sidjua chat guide    # KI-Leitfaden ohne Konfiguration (kein API-Schlüssel erforderlich)
```

### Option C — Quell-Build

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
npm ci && npm run build
node dist/index.js --help
```

### Plattform-Hinweise

| Funktion | Linux | macOS | Windows (WSL2) | Windows (nativ) |
|---------|-------|-------|----------------|-----------------|
| CLI + REST API | ✅ Vollständig | ✅ Vollständig | ✅ Vollständig | ✅ Vollständig |
| Docker | ✅ Vollständig | ✅ Vollständig (Desktop) | ✅ Vollständig (Desktop) | ✅ Vollständig (Desktop) |
| Sandboxing (bubblewrap) | ✅ Vollständig | ❌ Fällt zurück auf `none` | ✅ Vollständig (in WSL2) | ❌ Fällt zurück auf `none` |
| Web Management Console | ✅ Full | ✅ Full | ✅ Full | ✅ Full |

Keine externe Datenbank erforderlich. SIDJUA verwendet SQLite. Qdrant ist optional (nur für semantische Suche).

Siehe [docs/INSTALLATION.md](docs/INSTALLATION.md) für die vollständige Anleitung mit Verzeichnisstruktur, Umgebungsvariablen, betriebssystemspezifischer Fehlerbehebung und Docker-Volume-Referenz.

---

## Warum SIDJUA?

Jedes KI-Agent-Framework verlässt sich heute auf dieselbe fehlerhafte Annahme: dass man
der KI vertrauen kann, ihre eigenen Regeln zu befolgen.

**Das Problem mit prompt-basierter Governance:**

Sie geben einem Agenten einen System-Prompt, der besagt: „Greife niemals auf Kunden-PII zu." Der
Agent liest die Anweisung. Der Agent liest auch die Nachricht des Benutzers, der ihn auffordert,
die Zahlungshistorie von Max Mustermann abzurufen. Der Agent entscheidet — selbstständig —, ob er
nachkommt. Das ist keine Governance. Das ist ein eindringlich formulierter Vorschlag.

**SIDJUA ist anders.**

Governance sitzt **außerhalb** des Agenten. Jede Aktion durchläuft eine 5-stufige
Vorab-Durchsetzungs-Pipeline **bevor** sie ausgeführt wird. Sie definieren Regeln in
YAML. Das System setzt sie durch. Der Agent darf nie entscheiden, ob er sie befolgt,
denn die Prüfung erfolgt bevor der Agent handelt.

Das ist Governance durch Architektur — nicht durch Prompting, nicht durch Fine-Tuning,
nicht durch Hoffen.

---

## So funktioniert es

SIDJUA umhüllt Ihre Agenten in einer externen Governance-Schicht. Der LLM-
Aufruf des Agenten findet erst statt, wenn die vorgeschlagene Aktion eine 5-stufige Durchsetzungs-
Pipeline passiert hat:

**Stufe 1 — Verboten:** Gesperrte Aktionen werden sofort abgelehnt. Kein LLM-
Aufruf, kein Protokolleintrag mit „erlaubt", keine zweite Chance. Wenn die Aktion auf
der Verbotsliste steht, endet es hier.

**Stufe 2 — Genehmigung:** Aktionen, die eine menschliche Freigabe erfordern, werden vor
der Ausführung zur Genehmigung zurückgehalten. Der Agent wartet. Der Mensch entscheidet.

**Stufe 3 — Budget:** Jede Aufgabe läuft gegen Echtzeit-Kostengrenzen. Pro-Aufgabe-
und Pro-Agent-Budgets werden durchgesetzt. Wenn das Limit erreicht ist, wird die Aufgabe
abgebrochen — nicht gekennzeichnet, nicht zur Prüfung protokolliert, *abgebrochen*.

**Stufe 4 — Klassifizierung:** Daten, die Abteilungsgrenzen überschreiten, werden
gegen Klassifizierungsregeln geprüft. Ein Tier-2-Agent kann nicht auf SECRET-Daten zugreifen. Ein
Agent in Abteilung A kann die Geheimnisse von Abteilung B nicht lesen.

**Stufe 5 — Richtlinie:** Benutzerdefinierte Organisationsregeln, strukturell durchgesetzt. API-
Aufrufhäufigkeitsgrenzen, Token-Obergrenzen für Ausgaben, Zeitfensterbeschränkungen.

Die gesamte Pipeline läuft, bevor eine Aktion ausgeführt wird. Es gibt keinen „protokollieren und
später prüfen"-Modus für governance-kritische Operationen.

### Einzelne Konfigurationsdatei

Ihre gesamte Agent-Organisation lebt in einer `divisions.yaml`:

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

`sidjua apply` liest diese Datei und richtet die vollständige Agent-Infrastruktur ein:
Agenten, Abteilungen, RBAC, Routing, Audit-Tabellen, Secrets-Pfade und Governance-
Regeln — in 10 reproduzierbaren Schritten.

### Agent-Architektur

Agenten sind in **Abteilungen** (funktionale Gruppen) und **Tiers**
(Vertrauensstufen) organisiert. Tier-1-Agenten haben volle Autonomie innerhalb ihrer Governance-
Hülle. Tier-2-Agenten benötigen Genehmigungen für sensible Operationen. Tier-3-
Agenten werden vollständig überwacht. Das Tier-System wird strukturell durchgesetzt — ein
Agent kann sich nicht selbst befördern.

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

## Architektur-Einschränkungen

SIDJUA setzt diese Einschränkungen auf Architekturebene durch — sie können von Agenten nicht
deaktiviert, umgangen oder außer Kraft gesetzt werden:

1. **Governance ist extern**: Die Governance-Schicht umhüllt den Agenten. Der Agent
   hat keinen Zugriff auf den Governance-Code, kann keine Regeln ändern und kann nicht erkennen,
   ob Governance vorhanden ist.

2. **Vorab, nicht nachher**: Jede Aktion wird VOR der Ausführung geprüft.
   Es gibt keinen „protokollieren und später prüfen"-Modus für governance-kritische Operationen.

3. **Strukturelle Durchsetzung**: Regeln werden durch Code-Pfade durchgesetzt, nicht durch
   Prompts oder Modellanweisungen. Ein Agent kann die Governance nicht „jailbreaken", weil
   Governance nicht als Anweisungen an das Modell implementiert ist.

4. **Audit-Unveränderlichkeit**: Das Write-Ahead Log (WAL) ist append-only mit
   Integritätsprüfung. Manipulierte Einträge werden erkannt und ausgeschlossen.

5. **Abteilungsisolierung**: Agenten in verschiedenen Abteilungen können nicht auf
   die Daten, Geheimnisse oder Kommunikationskanäle der anderen zugreifen.

---

## Vergleich

| Funktion | SIDJUA | CrewAI | AutoGen | LangGraph | OpenClaw |
|---------|--------|--------|---------|-----------|----------|
| Externe Governance | ✅ Architektur | ❌ | ❌ | ❌ | ❌ |
| Vorab-Durchsetzung | ✅ 5-stufige Pipeline | ❌ | ❌ | ❌ | ❌ |
| EU AI Act bereit | ✅ | ❌ | ❌ | ❌ | ❌ |
| Selbst gehostet | ✅ | ❌ Cloud | ❌ Cloud | ❌ Cloud | ✅ Plugin |
| Air-Gap-fähig | ✅ | ❌ | ❌ | ❌ | ❌ |
| Modell-agnostisch | ✅ Beliebiger LLM | Teilweise | Teilweise | Teilweise | ✅ |
| Bidirektionale E-Mail | ✅ | ❌ | ❌ | ❌ | ❌ |
| Discord-Gateway | ✅ | ❌ | ❌ | ❌ | ❌ |
| Hierarchische Agenten | ✅ Abteilungen + Tiers | Einfach | Einfach | Graph | ❌ |
| Budget-Durchsetzung | ✅ Pro-Agent-Limits | ❌ | ❌ | ❌ | ❌ |
| Sandbox-Isolierung | ✅ bubblewrap | ❌ | ❌ | ❌ | ❌ |
| Audit-Unveränderlichkeit | ✅ WAL + Integrität | ❌ | ❌ | ❌ | ❌ |
| Lizenz | AGPL-3.0 | MIT | MIT | MIT | Gemischt |
| Unabhängige Audits | ✅ 2 Extern | ❌ | ❌ | ❌ | ❌ |

---

## Funktionen

### Governance & Compliance

**Vorab-Pipeline (Stufe 0)** läuft vor jeder Agent-Aktion: Verboten-
Prüfung → Menschliche Genehmigung → Budget-Durchsetzung → Datenklassifizierung → Benutzerdefinierte
Richtlinie. Alle fünf Stufen sind strukturell — sie werden im Code ausgeführt, nicht im
Prompt des Agenten.

**Obligatorische Basis-Regeln** werden mit jeder Installation geliefert: 10 Governance-Regeln
(`SYS-SEC-001` bis `SYS-GOV-002`), die durch Benutzerkonfiguration nicht entfernt oder abgeschwächt werden können.
Benutzerdefinierte Regeln erweitern die Basis; sie können sie nicht überschreiben.

**EU AI Act Compliance** — Audit-Trail, Klassifizierungsrahmen und Genehmigungs-
Workflows entsprechen direkt den Anforderungen der Artikel 9, 12 und 17. Die Compliance-Frist
August 2026 ist in die Produkt-Roadmap eingebaut.

**Compliance-Berichterstattung** via `sidjua audit report/violations/agents/export`:
Compliance-Score, Pro-Agent-Vertrauenswerte, Verstoßhistorie, CSV/JSON-Export
für externe Prüfer oder SIEM-Integration.

**Write-Ahead Log (WAL)** mit Integritätsprüfung: jede Governance-
Entscheidung wird vor der Ausführung in ein append-only-Protokoll geschrieben. Manipulierte Einträge
werden beim Lesen erkannt. `sidjua memory recover` re-validiert und repariert.

### Kommunikation

Agenten reagieren nicht nur auf API-Aufrufe — sie nehmen an echten Kommunikations-
kanälen teil.

**Bidirektionale E-Mail** (`sidjua email status/test/threads`): Agenten empfangen
E-Mails via IMAP-Polling und antworten via SMTP. Thread-Zuordnung über In-Reply-To-
Header hält Gespräche kohärent. Absender-Whitelisting, Körpergrößenbeschränkungen
und HTML-Stripping schützen die Agent-Pipeline vor bösartigen Eingaben.

**Discord-Gateway-Bot**: vollständige Slash-Command-Schnittstelle via `sidjua module install
discord`. Agenten antworten auf Discord-Nachrichten, pflegen Gesprächs-Threads
und senden proaktive Benachrichtigungen.

**Telegram-Integration**: Agent-Warnungen und Benachrichtigungen via Telegram-Bot.
Das Multi-Kanal-Adapter-Muster unterstützt Telegram, Discord, ntfy und E-Mail
parallel.

### Betrieb

**Ein einziger Docker-Befehl** für die Produktion:

```bash
docker run -p 4200:4200 ghcr.io/goetzkohlberg/sidjua:latest
```

Der API-Schlüssel wird beim ersten Start automatisch generiert und in den Container-Logs ausgegeben.
Keine Umgebungsvariablen erforderlich. Keine Konfiguration erforderlich. Kein Datenbank-
Server erforderlich — SIDJUA verwendet SQLite, eine Datenbankdatei pro Agent.

**CLI-Verwaltung** — vollständiger Lebenszyklus aus einem einzigen Binary:

```bash
sidjua init                      # Interaktive Workspace-Einrichtung (3 Schritte)
sidjua apply                     # Einrichten aus divisions.yaml
sidjua agent create/list/stop    # Agent-Lebenszyklus
sidjua run "task..." --wait      # Aufgabe mit Governance-Durchsetzung einreichen
sidjua audit report              # Compliance-Bericht
sidjua costs                     # Kostenaufschlüsselung nach Abteilung/Agent
sidjua backup create/restore     # HMAC-signiertes Backup-Management
sidjua update                    # Versions-Update mit automatischem Vorab-Backup
sidjua rollback                  # 1-Klick-Wiederherstellung zur vorherigen Version
sidjua email status/test         # E-Mail-Kanal-Verwaltung
sidjua secret set/get/rotate     # Verschlüsseltes Secrets-Management
sidjua memory import/search      # Semantische Wissenspipeline
sidjua selftest                  # System-Gesundheitsprüfung (7 Kategorien, 0-100 Punkte)
```

**Semantisches Gedächtnis** — Gespräche und Dokumente importieren (`sidjua memory import
~/exports/claude-chats.zip`), Suche mit Vektor + BM25 Hybrid-Ranking. Unterstützt
Cloudflare Workers AI-Einbettungen (kostenlos, ohne Konfiguration) und OpenAI-Großeinbettungen
(höhere Qualität für große Wissensbasen).

**Adaptives Chunking** — Die Speicherpipeline passt Chunk-Größen automatisch an, um innerhalb
des Token-Limits jedes Einbettungsmodells zu bleiben.

**Zero-Config-Leitfaden** — `sidjua chat guide` startet einen interaktiven KI-Assistenten
ohne API-Schlüssel, betrieben von Cloudflare Workers AI über den SIDJUA-Proxy.
Fragen Sie ihn, wie man Agenten einrichtet, Governance konfiguriert oder versteht, was im
Audit-Log passiert ist.

**Air-Gap-Deployment** — vollständig ohne Internetverbindung betreiben, mit lokalen
LLMs via Ollama oder einem OpenAI-kompatiblen Endpunkt. Standardmäßig keine Telemetrie.
Optionales Opt-in-Absturzreporting mit vollständiger PII-Schwärzung.

### Sicherheit

**Sandbox-Isolierung** — Agent-Skills laufen in OS-Level-Prozessisolierung via
bubblewrap (Linux-Benutzer-Namespaces). Kein zusätzlicher RAM-Overhead. Steckbares
`SandboxProvider`-Interface: `none` für die Entwicklung, `bubblewrap` für die Produktion.

**Secrets-Management** — verschlüsselter Secrets-Speicher mit RBAC (`sidjua secret
set/get/list/delete/rotate/namespaces`). Kein externer Vault erforderlich.

**Sicherheitsorientierter Build** — umfangreiche interne Testsuite plus unabhängige
Validierung durch 2 externe Code-Prüfer (DeepSeek V3 und xAI Grok). Sicherheits-
Headers, CSRF-Schutz, Rate-Limiting und Eingabebereinigung auf jeder API-
Oberfläche. SQL-Injection-Prävention mit parametrisierten Abfragen durchgehend.

**Backup-Integrität** — HMAC-signierte Backup-Archive mit Zip-Slip-Schutz,
Zip-Bomben-Prävention und Manifest-Prüfsummen-Verifizierung beim Wiederherstellen.

---

## Import aus anderen Frameworks

```bash
# Vorschau, was importiert wird — keine Änderungen vorgenommen
sidjua import openclaw --dry-run

# Konfiguration + Skill-Dateien importieren
sidjua import openclaw --skills
```

Ihre vorhandenen Agenten behalten ihre Identität, Modelle und Skills. SIDJUA fügt
Governance, Audit-Trails und Budget-Kontrollen automatisch hinzu.

---

## Konfigurationsreferenz

Eine minimale `divisions.yaml` zum Einstieg:

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

`sidjua apply` richtet die vollständige Infrastruktur aus dieser Datei ein. Führen Sie es
nach Änderungen erneut aus — es ist idempotent.

Siehe [docs/SIDJUA-APPLY-TECH-SPEC-V1.md](docs/SIDJUA-APPLY-TECH-SPEC-V1.md)
für die vollständige Spezifikation aller 10 Einrichtungsschritte.

---

## REST API

Die SIDJUA REST API läuft auf demselben Port wie das Dashboard:

```bash
sidjua server start --port 4200 --api-key $SIDJUA_API_KEY
```

Wichtige Endpunkte:

```
GET  /api/v1/health          # Öffentliche Gesundheitsprüfung (ohne Auth)
GET  /api/v1/info            # System-Metadaten (authentifiziert)
POST /api/v1/execute/run     # Aufgabe einreichen
GET  /api/v1/execute/:id/status  # Aufgabenstatus
GET  /api/v1/execute/:id/result  # Aufgabenergebnis
GET  /api/v1/events          # SSE-Ereignisstrom
GET  /api/v1/audit/report    # Compliance-Bericht
```

Alle Endpunkte außer `/health` erfordern Bearer-Authentifizierung. Schlüssel generieren:

```bash
sidjua api-key generate
```

---

## Docker Compose

```yaml
services:
  sidjua:
    image: ghcr.io/goetzkohlberg/sidjua:latest
    ports:
      - "4200:4200"
    volumes:
      - sidjua-data:/data
    restart: unless-stopped

volumes:
  sidjua-data:
```

Oder verwenden Sie die mitgelieferte `docker-compose.yml`, die benannte Volumes für Konfiguration,
Protokolle und Agent-Workspace sowie einen optionalen Qdrant-Dienst für semantische Suche hinzufügt:

```bash
docker compose up -d
docker compose exec sidjua sidjua init
docker compose exec sidjua sidjua apply
```

---

## Anbieter

SIDJUA verbindet sich mit jedem LLM-Anbieter ohne Bindung:

| Anbieter | Modelle | API-Schlüssel |
|----------|---------|--------------|
| Anthropic | Claude Sonnet 4.6, Haiku 4.5, Opus 4.6 | `ANTHROPIC_API_KEY` |
| Google | Gemini 2.0, Gemini 1.5 Pro | `GOOGLE_API_KEY` |
| Groq | Llama 3.x, Mixtral | `GROQ_API_KEY` (kostenloser Tarif) |
| Cloudflare Workers AI | Llama, Mistral, Phi | `CF_ACCOUNT_ID` + `CF_TOKEN` |
| Ollama | Beliebiges lokales Modell | Kein Schlüssel (lokal) |
| OpenAI-kompatibel | Beliebiger Endpunkt | Benutzerdefinierte URL + Schlüssel |

```bash
# Einen Anbieter-Schlüssel hinzufügen
sidjua key set groq gsk_...

# Verfügbare Anbieter und Modelle auflisten
sidjua provider list
```

---

## Roadmap

Vollständige Roadmap unter [sidjua.com/roadmap](https://sidjua.com/roadmap).

Kurzfristig:
- Multi-Agent-Orchestrierungsmuster (V1.1)
- Webhook-Eingangs-Trigger (V1.1)
- Agent-zu-Agent-Kommunikation (V1.2)
- Enterprise-SSO-Integration (V1.x)
- Cloud-gehosteter Governance-Validierungsdienst (V1.x)

---

## Community

- **Discord**: [sidjua.com/discord](https://sidjua.com/discord)
- **GitHub Issues**: [github.com/GoetzKohlberg/sidjua/issues](https://github.com/GoetzKohlberg/sidjua/issues)
- **E-Mail**: contact@sidjua.com
- **Dokumentation**: [sidjua.com/docs](https://sidjua.com/docs)

Wenn Sie einen Fehler finden, öffnen Sie ein Issue — wir handeln schnell.

---

## Übersetzungen

SIDJUA ist in 26 Sprachen verfügbar. Englisch und Deutsch werden vom Kernteam gepflegt. Alle anderen Übersetzungen sind KI-generiert und werden von der Community gepflegt.

**Dokumentation:** Diese README und der [Installationsleitfaden](docs/INSTALLATION.md) sind in allen 26 Sprachen verfügbar. Siehe den Sprachselektor oben auf dieser Seite.

| Region | Sprachen |
|--------|----------|
| Amerika | Englisch, Spanisch, Portugiesisch (Brasilien) |
| Europa | Deutsch, Französisch, Italienisch, Niederländisch, Polnisch, Tschechisch, Rumänisch, Russisch, Ukrainisch, Schwedisch, Türkisch |
| Naher Osten | Arabisch |
| Asien | Hindi, Bengalisch, Filipino, Indonesisch, Malaiisch, Thailändisch, Vietnamesisch, Japanisch, Koreanisch, Chinesisch (Vereinfacht), Chinesisch (Traditionell) |

Einen Übersetzungsfehler gefunden? Bitte öffnen Sie ein GitHub-Issue mit:
- Sprache und Locale-Code (z.B. `de`)
- Der falsche Text oder der Schlüssel aus der Locale-Datei (z.B. `gui.nav.dashboard`)
- Die korrekte Übersetzung

Möchten Sie eine Sprache pflegen? Siehe [CONTRIBUTING.md](CONTRIBUTING.md#translations) — wir verwenden ein Modell mit sprachspezifischen Betreuern.

---

## Lizenz

**AGPL-3.0** — Sie können SIDJUA kostenlos verwenden, modifizieren und vertreiben, solange Sie
Änderungen unter derselben Lizenz teilen. Der Quellcode ist für Nutzer eines gehosteten Deployments
immer verfügbar.

Enterprise-Lizenz verfügbar für Organisationen, die ein proprietäres
Deployment ohne AGPL-Verpflichtungen benötigen.
[contact@sidjua.com](mailto:contact@sidjua.com)
