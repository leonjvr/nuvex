[English](../../README.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [Français](README.fr.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [中文 (简体)](README.zh-CN.md) | [中文 (繁體)](README.zh-TW.md) | [العربية](README.ar.md) | [বাংলা](README.bn.md) | [Čeština](README.cs.md) | [Filipino](README.fil.md) | [हिन्दी](README.hi.md) | [Bahasa Indonesia](README.id.md) | [Italiano](README.it.md) | [Bahasa Melayu](README.ms.md) | [Nederlands](README.nl.md) | [Polski](README.pl.md) | [Português (BR)](README.pt-BR.md) | [Română](README.ro.md) | [Русский](README.ru.md) | [Svenska](README.sv.md) | [ภาษาไทย](README.th.md) | [Türkçe](README.tr.md) | [Українська](README.uk.md) | [Tiếng Việt](README.vi.md)

> *Deze pagina is automatisch vertaald vanuit het [Engelse origineel](../../README.md). Een fout gevonden? [Meld het](https://github.com/GoetzKohlberg/sidjua/issues).*

---

# SIDJUA — Het AI-Agent Governance Platform

> Het enige agentplatform waar governance wordt afgedwongen door de architectuur, niet door de hoop dat het model zich correct gedraagt.

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Docker](https://img.shields.io/badge/Docker-ghcr.io%2Fgoetzkohlberg%2Fsidjua-blue)](https://ghcr.io/goetzkohlberg/sidjua)
[![Version](https://img.shields.io/badge/version-1.0.0-green)](https://github.com/GoetzKohlberg/sidjua/releases)

---

## Installatie

### Vereisten

| Hulpmiddel | Vereist | Opmerkingen |
|-----------|---------|------------|
| **Node.js** | >= 22.0.0 | ES-modules, `fetch()`, `crypto.subtle`. [Downloaden](https://nodejs.org) |
| **C/C++ Toolchain** | Alleen voor bronbuilds | `better-sqlite3` en `argon2` compileren native add-ons |
| **Docker** | >= 24 (optioneel) | Alleen voor Docker-implementatie |

Node.js 22 installeren: Ubuntu/Debian (`curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs`), macOS (`brew install node@22`), Windows (`winget install OpenJS.NodeJS.LTS`).

C/C++-tools installeren: Ubuntu (`sudo apt-get install -y python3 make g++ build-essential`), macOS (`xcode-select --install`), Windows (`npm install --global windows-build-tools`).

### Optie A — Docker (Aanbevolen)

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
docker compose up -d
```

```bash
# Automatisch gegenereerde API-sleutel bekijken
docker compose exec sidjua cat /app/.system/api-key

# Governance instellen
docker compose exec sidjua sidjua apply --verbose

# Systeemgezondheidscontrole
docker compose exec sidjua sidjua selftest
```

Ondersteunt **linux/amd64** en **linux/arm64** (Raspberry Pi, Apple Silicon).

### Optie B — Globale npm-installatie

```bash
npm install -g sidjua
sidjua init          # Interactieve installatie in 3 stappen
sidjua chat guide    # AI-gids zonder configuratie (geen API-sleutel nodig)
```

### Optie C — Bronbuild

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
npm ci && npm run build
node dist/index.js --help
```

### Platformopmerkingen

| Functie | Linux | macOS | Windows (WSL2) | Windows (native) |
|--------|-------|-------|----------------|------------------|
| CLI + REST API | ✅ Volledig | ✅ Volledig | ✅ Volledig | ✅ Volledig |
| Docker | ✅ Volledig | ✅ Volledig (Desktop) | ✅ Volledig (Desktop) | ✅ Volledig (Desktop) |
| Sandboxing (bubblewrap) | ✅ Volledig | ❌ Valt terug op `none` | ✅ Volledig (binnen WSL2) | ❌ Valt terug op `none` |
| Web Management Console | ✅ Full | ✅ Full | ✅ Full | ✅ Full |

Geen externe database vereist. SIDJUA gebruikt SQLite. Qdrant is optioneel (alleen voor semantisch zoeken).

Zie [docs/INSTALLATION.md](docs/INSTALLATION.md) voor de volledige handleiding met directorystructuur, omgevingsvariabelen, probleemoplossing per besturingssysteem en Docker-volumereferentie.

---

## Waarom SIDJUA?

Elk AI-agentframework van vandaag vertrouwt op dezelfde gebrekkige aanname: dat je
de AI kunt vertrouwen om zijn eigen regels te volgen.

**Het probleem met op prompt gebaseerde governance:**

Je geeft een agent een systeemprompt die zegt "nooit toegang tot klant-PII." De
agent leest de instructie. De agent leest ook het bericht van de gebruiker dat hem vraagt
de betalingsgeschiedenis van Jan Janssen op te halen. De agent beslist — op eigen initiatief — of
hij zich hieraan houdt. Dat is geen governance. Dat is een nadrukkelijk geformuleerde suggestie.

**SIDJUA is anders.**

Governance bevindt zich **buiten** de agent. Elke actie doorloopt een handhavingspijplijn
van 5 stappen **voordat** deze wordt uitgevoerd. U definieert regels in
YAML. Het systeem handhaaft ze. De agent kan nooit beslissen of hij ze volgt, want
de controle vindt plaats voordat de agent handelt.

Dit is governance door architectuur — niet door prompting, niet door fine-tuning,
niet door hopen.

---

## Hoe het werkt

SIDJUA omhult uw agenten in een externe governancelaag. De LLM-aanroep van
de agent vindt nooit plaats totdat de voorgestelde actie een handhavingspijplijn van
5 stadia heeft doorlopen:

**Stadium 1 — Verboden:** Geblokkeerde acties worden onmiddellijk geweigerd. Geen LLM-aanroep,
geen logboekvermelding gemarkeerd als "toegestaan", geen tweede kansen. Als de actie op
de verbodenlijst staat, stopt het hier.

**Stadium 2 — Goedkeuring:** Acties die menselijke toestemming vereisen worden vastgehouden voor
goedkeuring vóór uitvoering. De agent wacht. De mens beslist.

**Stadium 3 — Budget:** Elke taak wordt uitgevoerd tegen realtime kostenlimieten. Budgetten
per taak en per agent worden gehandhaafd. Wanneer het limiet is bereikt, wordt de taak
geannuleerd — niet gemarkeerd, niet geregistreerd voor beoordeling, *geannuleerd*.

**Stadium 4 — Classificatie:** Gegevens die divisiegrenzen overschrijden worden gecontroleerd
aan de hand van classificatieregels. Een Tier-2-agent heeft geen toegang tot SECRET-gegevens. Een
agent in Divisie A kan de geheimen van Divisie B niet lezen.

**Stadium 5 — Beleid:** Aangepaste organisatieregels, structureel gehandhaafd. Limieten voor
API-aanroepfrequentie, limieten voor uitvoertokens, tijdvensterbeperkingen.

De hele pijplijn wordt uitgevoerd voordat een actie wordt uitgevoerd. Er is geen modus "registreren en
later beoordelen" voor governance-kritieke bewerkingen.

### Enkel configuratiebestand

Uw volledige agentorganisatie leeft in één `divisions.yaml`:

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

`sidjua apply` leest dit bestand en voorziet de complete agentinfrastructuur:
agenten, divisies, RBAC, routering, audittabellen, geheimenpaden en governance-
regels — in 10 reproduceerbare stappen.

### Agentarchitectuur

Agenten zijn georganiseerd in **divisies** (functionele groepen) en **tiers**
(vertrouwensniveaus). Tier-1-agenten hebben volledige autonomie binnen hun governance-
enveloppe. Tier-2-agenten vereisen goedkeuring voor gevoelige bewerkingen. Tier-3-
agenten worden volledig gesuperviseerd. Het tiersysteem wordt structureel gehandhaafd —
een agent kan zichzelf niet promoveren.

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

## Architectuurbeperkingen

SIDJUA hanteert deze beperkingen op architectuurniveau — ze kunnen niet worden
uitgeschakeld, omzeild of overschreven door agenten:

1. **Governance is extern**: De governancelaag omhult de agent. De agent
   heeft geen toegang tot governancecode, kan geen regels wijzigen en kan niet detecteren
   of governance aanwezig is.

2. **Pre-actie, niet post-actie**: Elke actie wordt gecontroleerd VÓÓR uitvoering.
   Er is geen modus "registreren en later beoordelen" voor governance-kritieke bewerkingen.

3. **Structurele handhaving**: Regels worden gehandhaafd door codepaden, niet door
   prompts of modelinstructies. Een agent kan de governance niet "jailbreaken" omdat
   governance niet als instructies aan het model is geïmplementeerd.

4. **Auditimmutabiliteit**: Het Write-Ahead Log (WAL) is alleen-toevoegen met
   integriteitverificatie. Gemanipuleerde vermeldingen worden gedetecteerd en uitgesloten.

5. **Divisie-isolatie**: Agenten in verschillende divisies hebben geen toegang tot
   elkaars gegevens, geheimen of communicatiekanalen.

---

## Vergelijking

| Functie | SIDJUA | CrewAI | AutoGen | LangGraph | OpenClaw |
|--------|--------|--------|---------|-----------|----------|
| Externe governance | ✅ Architectuur | ❌ | ❌ | ❌ | ❌ |
| Pre-actiehandhaving | ✅ 5-stappenpijplijn | ❌ | ❌ | ❌ | ❌ |
| Klaar voor EU AI Act | ✅ | ❌ | ❌ | ❌ | ❌ |
| Zelfgehost | ✅ | ❌ Cloud | ❌ Cloud | ❌ Cloud | ✅ Plugin |
| Air-gap-geschikt | ✅ | ❌ | ❌ | ❌ | ❌ |
| Modelonafhankelijk | ✅ Elke LLM | Gedeeltelijk | Gedeeltelijk | Gedeeltelijk | ✅ |
| Bidirectionele e-mail | ✅ | ❌ | ❌ | ❌ | ❌ |
| Discord-gateway | ✅ | ❌ | ❌ | ❌ | ❌ |
| Hiërarchische agenten | ✅ Divisies + Tiers | Basis | Basis | Graaf | ❌ |
| Budgethandhaving | ✅ Per-agent-limieten | ❌ | ❌ | ❌ | ❌ |
| Sandbox-isolatie | ✅ bubblewrap | ❌ | ❌ | ❌ | ❌ |
| Auditimmutabiliteit | ✅ WAL + integriteit | ❌ | ❌ | ❌ | ❌ |
| Licentie | AGPL-3.0 | MIT | MIT | MIT | Gemengd |
| Onafhankelijke audits | ✅ 2 Extern | ❌ | ❌ | ❌ | ❌ |

---

## Functies

### Governance en Naleving

**Pre-actiepijplijn (Stadium 0)** wordt uitgevoerd vóór elke agentactie: Verbodencontrole
→ Menselijke goedkeuring → Budgethandhaving → Gegevensclassificatie → Aangepast beleid. Alle
vijf stadia zijn structureel — ze worden uitgevoerd in code, niet in de prompt van de agent.

**Verplichte basisregels** worden bij elke installatie meegeleverd: 10 governanceregels
(`SYS-SEC-001` tot `SYS-GOV-002`) die niet kunnen worden verwijderd of verzwakt door
gebruikersconfiguratie. Aangepaste regels breiden de basis uit; ze kunnen deze niet overschrijven.

**EU AI Act-naleving** — audittrail, classificatiekader en goedkeuringsworkflows
komen direct overeen met de vereisten van artikelen 9, 12 en 17. De nalevingsdeadline
van augustus 2026 is ingebouwd in de productroadmap.

**Nalevingsrapportage** via `sidjua audit report/violations/agents/export`:
nalevingsscore, vertrouwensscores per agent, schendingshistorie, CSV/JSON-export
voor externe auditors of SIEM-integratie.

**Write-Ahead Log (WAL)** met integriteitverificatie: elke governancebeslissing wordt
geschreven naar een alleen-toevoegen-log vóór uitvoering. Gemanipuleerde vermeldingen worden gedetecteerd
bij het lezen. `sidjua memory recover` hervalideert en repareert.

### Communicatie

Agenten reageren niet alleen op API-aanroepen — ze nemen deel aan echte communicatiekanalen.

**Bidirectionele e-mail** (`sidjua email status/test/threads`): agenten ontvangen
e-mail via IMAP-polling en antwoorden via SMTP. Thread-mapping via In-Reply-To-headers
houdt gesprekken coherent. Verzenderswhitelisting, tekstgroottelimieten en HTML-stripping
beschermen de agentpijplijn tegen kwaadaardige invoer.

**Discord-gateway-bot**: volledige slash-opdrachtinterface via `sidjua module install
discord`. Agenten reageren op Discord-berichten, onderhouden gespreksthreads
en sturen proactieve meldingen.

**Telegram-integratie**: agentmeldingen en -notificaties via Telegram-bot.
Het multi-kanaladapterpatroon ondersteunt Telegram, Discord, ntfy en e-mail
parallel.

### Bewerkingen

**Eén Docker-opdracht** naar productie:

```bash
docker run -p 4200:4200 ghcr.io/goetzkohlberg/sidjua:latest
```

De API-sleutel wordt automatisch gegenereerd bij de eerste start en afgedrukt in de container-logs.
Geen omgevingsvariabelen vereist. Geen configuratie vereist. Geen databaseserver
vereist — SIDJUA gebruikt SQLite, één databasebestand per agent.

**CLI-beheer** — volledige levenscyclus vanuit één binair bestand:

```bash
sidjua init                      # Interactieve werkruimte-instelling (3 stappen)
sidjua apply                     # Voorzien vanuit divisions.yaml
sidjua agent create/list/stop    # Agentlevenscyclus
sidjua run "task..." --wait      # Taak indienen met governancehandhaving
sidjua audit report              # Nalevingsrapport
sidjua costs                     # Kostenuitsplitsing per divisie/agent
sidjua backup create/restore     # HMAC-ondertekend back-upbeheer
sidjua update                    # Versie-update met automatische voorafgaande back-up
sidjua rollback                  # 1-klik herstel naar vorige versie
sidjua email status/test         # E-mailkanaalsbeheer
sidjua secret set/get/rotate     # Versleuteld geheimenbeheer
sidjua memory import/search      # Semantische kennispijplijn
sidjua selftest                  # Systeemgezondheidscontrole (7 categorieën, score 0-100)
```

**Semantisch geheugen** — gesprekken en documenten importeren (`sidjua memory import
~/exports/claude-chats.zip`), zoeken met vector + BM25 hybride ranking. Ondersteunt
Cloudflare Workers AI-embeddings (gratis, zonder configuratie) en OpenAI grote embeddings
(hogere kwaliteit voor grote kennisbanken).

**Adaptieve chunking** — de geheugenpijplijn past automatisch de chunkgroottes aan om
binnen de tokenlimiet van elk inbeddingsmodel te blijven.

**Gids zonder configuratie** — `sidjua chat guide` start een interactieve AI-assistent
zonder API-sleutel, aangedreven door Cloudflare Workers AI via de SIDJUA-proxy.
Vraag hem hoe agenten in te stellen, governance te configureren of begrijpen wat er in
het auditlogboek is gebeurd.

**Air-gap-implementatie** — volledig losgekoppeld van internet draaien met lokale
LLMs via Ollama of elk OpenAI-compatibel eindpunt. Standaard geen telemetrie.
Optionele opt-in crashrapportage met volledige PII-redactie.

### Beveiliging

**Sandbox-isolatie** — agentvaardigheden worden uitgevoerd in OS-niveau procesolatie via
bubblewrap (Linux-gebruikersnaamruimten). Geen extra RAM-overhead. Pluggable
`SandboxProvider`-interface: `none` voor ontwikkeling, `bubblewrap` voor productie.

**Geheimenbeheer** — versleutelde geheimenopslag met RBAC (`sidjua secret
set/get/list/delete/rotate/namespaces`). Geen externe kluis vereist.

**Veiligheidsgericht bouw** — uitgebreide interne testsuite plus onafhankelijke
validatie door 2 externe code-auditors (DeepSeek V3 en xAI Grok). Beveiligingsheaders,
CSRF-bescherming, snelheidslimiet en invoerdesinfectie op elk API-oppervlak. SQL-injectiepreventie
met geparametriseerde query's overal.

**Back-upintegriteit** — HMAC-ondertekende back-uparchieven met zip-slip-bescherming,
zip-bompreventie en controlesom-verificatie van het manifest bij herstel.

---

## Importeren uit andere frameworks

```bash
# Voorbeeld van wat wordt geïmporteerd — geen wijzigingen aangebracht
sidjua import openclaw --dry-run

# Configuratie + vaardigheidsbestanden importeren
sidjua import openclaw --skills
```

Uw bestaande agenten behouden hun identiteit, modellen en vaardigheden. SIDJUA voegt
automatisch governance, audittrails en budgetcontroles toe.

---

## Configuratiereferentie

Een minimale `divisions.yaml` om mee te beginnen:

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

`sidjua apply` voorziet de volledige infrastructuur vanuit dit bestand. Voer het
opnieuw uit na wijzigingen — het is idempotent.

Zie [docs/SIDJUA-APPLY-TECH-SPEC-V1.md](docs/SIDJUA-APPLY-TECH-SPEC-V1.md)
voor de volledige specificatie van alle 10 inrichtingsstappen.

---

## REST API

De SIDJUA REST API draait op dezelfde poort als het dashboard:

```bash
sidjua server start --port 4200 --api-key $SIDJUA_API_KEY
```

Belangrijke eindpunten:

```
GET  /api/v1/health          # Openbare gezondheidscontrole (geen auth)
GET  /api/v1/info            # Systeemmetadata (geauthenticeerd)
POST /api/v1/execute/run     # Taak indienen
GET  /api/v1/execute/:id/status  # Taakstatus
GET  /api/v1/execute/:id/result  # Taakresultaat
GET  /api/v1/events          # SSE-gebeurtenisstroom
GET  /api/v1/audit/report    # Nalevingsrapport
```

Alle eindpunten behalve `/health` vereisen Bearer-authenticatie. Genereer een sleutel:

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

Of gebruik de meegeleverde `docker-compose.yml` die benoemde volumes toevoegt voor configuratie,
logs en agentenwerkruimte, plus een optionele Qdrant-service voor semantisch zoeken:

```bash
docker compose up -d
docker compose exec sidjua sidjua init
docker compose exec sidjua sidjua apply
```

---

## Aanbieders

SIDJUA verbindt met elke LLM-aanbieder zonder vendor lock-in:

| Aanbieder | Modellen | API-sleutel |
|----------|---------|------------|
| Anthropic | Claude Sonnet 4.6, Haiku 4.5, Opus 4.6 | `ANTHROPIC_API_KEY` |
| Google | Gemini 2.0, Gemini 1.5 Pro | `GOOGLE_API_KEY` |
| Groq | Llama 3.x, Mixtral | `GROQ_API_KEY` (gratis laag) |
| Cloudflare Workers AI | Llama, Mistral, Phi | `CF_ACCOUNT_ID` + `CF_TOKEN` |
| Ollama | Elk lokaal model | Geen sleutel (lokaal) |
| OpenAI-compatibel | Elk eindpunt | Aangepaste URL + sleutel |

```bash
# Een aanbiedersleutel toevoegen
sidjua key set groq gsk_...

# Beschikbare aanbieders en modellen weergeven
sidjua provider list
```

---

## Roadmap

Volledige roadmap op [sidjua.com/roadmap](https://sidjua.com/roadmap).

Op korte termijn:
- Multi-agent orchestratiepatronen (V1.1)
- Webhook inkomende triggers (V1.1)
- Agent-naar-agent communicatie (V1.2)
- Enterprise SSO-integratie (V1.x)
- In de cloud gehoste governance-validatieservice (V1.x)

---

## Gemeenschap

- **Discord**: [sidjua.com/discord](https://sidjua.com/discord)
- **GitHub Issues**: [github.com/GoetzKohlberg/sidjua/issues](https://github.com/GoetzKohlberg/sidjua/issues)
- **E-mail**: contact@sidjua.com
- **Documentatie**: [sidjua.com/docs](https://sidjua.com/docs)

Als u een bug vindt, open dan een issue — we handelen snel.

---

## Vertalingen

SIDJUA is beschikbaar in 26 talen. Engels en Duits worden onderhouden door het kernteam. Alle andere vertalingen zijn AI-gegenereerd en worden onderhouden door de gemeenschap.

**Documentatie:** Deze README en de [Installatiehandleiding](docs/INSTALLATION.md) zijn beschikbaar in alle 26 talen. Zie de taalselector bovenaan deze pagina.

| Regio | Talen |
|-------|-------|
| Amerika's | Engels, Spaans, Portugees (Brazilië) |
| Europa | Duits, Frans, Italiaans, Nederlands, Pools, Tsjechisch, Roemeens, Russisch, Oekraïens, Zweeds, Turks |
| Midden-Oosten | Arabisch |
| Azië | Hindi, Bengaals, Filipijns, Indonesisch, Maleis, Thai, Vietnamees, Japans, Koreaans, Chinees (Vereenvoudigd), Chinees (Traditioneel) |

Een vertaalfout gevonden? Open dan een GitHub Issue met:
- Taal en locale-code (bijv. `nl`)
- De onjuiste tekst of de sleutel uit het locale-bestand (bijv. `gui.nav.dashboard`)
- De correcte vertaling

Wilt u een taal onderhouden? Zie [CONTRIBUTING.md](CONTRIBUTING.md#translations) — we gebruiken een model met een onderhouder per taal.

---

## Licentie

**AGPL-3.0** — u kunt SIDJUA vrij gebruiken, wijzigen en verspreiden zolang u
wijzigingen deelt onder dezelfde licentie. Broncode is altijd beschikbaar
voor gebruikers van een gehoste implementatie.

Enterprise-licentie beschikbaar voor organisaties die een bedrijfsimplementatie
vereisen zonder AGPL-verplichtingen.
[contact@sidjua.com](mailto:contact@sidjua.com)
