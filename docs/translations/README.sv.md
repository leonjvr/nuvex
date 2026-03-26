[English](../../README.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [Français](README.fr.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [中文 (简体)](README.zh-CN.md) | [中文 (繁體)](README.zh-TW.md) | [العربية](README.ar.md) | [বাংলা](README.bn.md) | [Čeština](README.cs.md) | [Filipino](README.fil.md) | [हिन्दी](README.hi.md) | [Bahasa Indonesia](README.id.md) | [Italiano](README.it.md) | [Bahasa Melayu](README.ms.md) | [Nederlands](README.nl.md) | [Polski](README.pl.md) | [Português (BR)](README.pt-BR.md) | [Română](README.ro.md) | [Русский](README.ru.md) | [Svenska](README.sv.md) | [ภาษาไทย](README.th.md) | [Türkçe](README.tr.md) | [Українська](README.uk.md) | [Tiếng Việt](README.vi.md)

---

> *Den här sidan har automatiskt översatts från [det engelska originalet](../../README.md). Hittade du ett fel? [Rapportera det](https://github.com/GoetzKohlberg/sidjua/issues).*

# SIDJUA — AI-agenternas styrningsplattform

> Den enda agentplattformen där styrning upprätthålls av arkitekturen, inte av förhoppningen att modellen beter sig rätt.

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Docker](https://img.shields.io/badge/Docker-ghcr.io%2Fgoetzkohlberg%2Fsidjua-blue)](https://ghcr.io/goetzkohlberg/sidjua)
[![Version](https://img.shields.io/badge/version-1.0.0-green)](https://github.com/GoetzKohlberg/sidjua/releases)

---

## Installation

### Förutsättningar

| Verktyg | Krävs | Anteckningar |
|---------|-------|--------------|
| **Node.js** | >= 22.0.0 | ES-moduler, `fetch()`, `crypto.subtle`. [Ladda ned](https://nodejs.org) |
| **C/C++-verktygskedja** | Endast källkodskompilering | `better-sqlite3` och `argon2` kompilerar inbyggda tillägg |
| **Docker** | >= 24 (valfritt) | Endast för Docker-driftsättning |

Installera Node.js 22: Ubuntu/Debian (`curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs`), macOS (`brew install node@22`), Windows (`winget install OpenJS.NodeJS.LTS`).

Installera C/C++-verktyg: Ubuntu (`sudo apt-get install -y python3 make g++ build-essential`), macOS (`xcode-select --install`), Windows (`npm install --global windows-build-tools`).

### Alternativ A — Docker (Rekommenderas)

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
docker compose up -d
```

```bash
# Visa automatiskt genererad API-nyckel
docker compose exec sidjua cat /app/.system/api-key

# Starta styrning
docker compose exec sidjua sidjua apply --verbose

# Systemhälsokontroll
docker compose exec sidjua sidjua selftest
```

Stöder **linux/amd64** och **linux/arm64** (Raspberry Pi, Apple Silicon).

### Alternativ B — Global npm-installation

```bash
npm install -g sidjua
sidjua init          # Interaktiv 3-stegs inställning
sidjua chat guide    # AI-guide utan konfiguration (ingen API-nyckel krävs)
```

### Alternativ C — Källkodskompilering

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
npm ci && npm run build
node dist/index.js --help
```

### Plattformsanteckningar

| Funktion | Linux | macOS | Windows (WSL2) | Windows (inbyggt) |
|---------|-------|-------|----------------|-------------------|
| CLI + REST API | ✅ Fullt | ✅ Fullt | ✅ Fullt | ✅ Fullt |
| Docker | ✅ Fullt | ✅ Fullt (Desktop) | ✅ Fullt (Desktop) | ✅ Fullt (Desktop) |
| Sandboxning (bubblewrap) | ✅ Fullt | ❌ Faller tillbaka till `none` | ✅ Fullt (inuti WSL2) | ❌ Faller tillbaka till `none` |
| Web Management Console | ✅ Full | ✅ Full | ✅ Full | ✅ Full |

Ingen extern databas krävs. SIDJUA använder SQLite. Qdrant är valfritt (endast semantisk sökning).

Se [docs/INSTALLATION.md](docs/INSTALLATION.md) för den fullständiga guiden med katalogstruktur, miljövariabler, felsökning per operativsystem och Docker-volymreferens.

---

## Varför SIDJUA?

Varje AI-agentramverk idag förlitar sig på samma felaktiga antagande: att du
kan lita på att AI:n följer sina egna regler.

**Problemet med promptbaserad styrning:**

Du ger en agent en systemprompt som säger "kom aldrig åt kundernas PII". Agenten
läser instruktionen. Agenten läser också användarens meddelande som ber den hämta
Johan Johanssons betalningshistorik. Agenten bestämmer — på egen hand — om den ska
följa instruktionen. Det är inte styrning. Det är en kraftfullt formulerad suggestion.

**SIDJUA är annorlunda.**

Styrning sitter **utanför** agenten. Varje åtgärd passerar genom en 5-stegs
tillämpningspipeline **innan** den utförs. Du definierar regler i
YAML. Systemet tillämpar dem. Agenten får aldrig bestämma om den ska
följa dem, eftersom kontrollen sker innan agenten agerar.

Detta är styrning genom arkitektur — inte genom promptning, inte genom finjustering,
inte genom förhoppning.

---

## Hur det fungerar

SIDJUA lindar dina agenter i ett externt styrningslager. Agentens LLM-anrop
sker aldrig förrän den föreslagna åtgärden har passerat en 5-stegs tillämpningspipeline:

**Steg 1 — Förbjudet:** Blockerade åtgärder avvisas omedelbart. Inget LLM-anrop,
ingen loggpost markerad "tillåten", ingen andra chans. Om åtgärden finns på
förbudslistan stoppas den här.

**Steg 2 — Godkännande:** Åtgärder som kräver mänsklig signering hålls för
godkännande innan utförande. Agenten väntar. Människan bestämmer.

**Steg 3 — Budget:** Varje uppgift körs mot realtidskostnadsgränser. Budget per uppgift
och per agent tillämpas. När gränsen nås avbryts uppgiften —
inte flaggad, inte loggad för granskning, *avbruten*.

**Steg 4 — Klassificering:** Data som passerar divisonsgränser kontrolleras
mot klassificeringsregler. En Tier-2-agent kan inte komma åt SECRET-data. En
agent i Division A kan inte läsa Division B:s hemligheter.

**Steg 5 — Policy:** Anpassade organisationsregler, strukturellt tillämpade. Begränsningar
av API-anropsfrekvens, begränsningar av utdatatoken, tidsfönsterbegränsningar.

Hela pipelinen körs innan någon åtgärd utförs. Det finns inget "logga och
granska senare"-läge för styrningskritiska operationer.

### Enskild konfigurationsfil

Hela agentorganisationen finns i en enda `divisions.yaml`:

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

`sidjua apply` läser den här filen och etablerar den fullständiga agentinfrastrukturen:
agenter, divisioner, RBAC, routing, revisionstabeller, hemlighetssökvägar och styrningsregler
— i 10 reproducerbara steg.

### Agentarkitektur

Agenter organiseras i **divisioner** (funktionella grupper) och **nivåer**
(förtroendenivåer). Tier 1-agenter har full autonomi inom sin styrningsenvelop.
Tier 2-agenter kräver godkännande för känsliga operationer. Tier 3-agenter
är fullt övervakade. Nivåsystemet tillämpas strukturellt — en
agent kan inte befordra sig själv.

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

## Arkitekturella begränsningar

SIDJUA tillämpar dessa begränsningar på arkitekturnivå — de kan inte
inaktiveras, kringgås eller åsidosättas av agenter:

1. **Styrning är extern**: Styrningslagret lindar agenten. Agenten
   har ingen åtkomst till styrningskoden, kan inte modifiera regler och kan inte identifiera
   om styrning är närvarande.

2. **Före åtgärd, inte efter åtgärd**: Varje åtgärd kontrolleras INNAN utförande.
   Det finns inget "logga och granska senare"-läge för styrningskritiska operationer.

3. **Strukturell tillämpning**: Regler tillämpas av kodsökvägar, inte av
   prompter eller modellinstruktioner. En agent kan inte "jailbreaka" sig ur
   styrning eftersom styrning inte är implementerad som instruktioner till modellen.

4. **Revisionsoföränderlighet**: Write-Ahead Log (WAL) är enbart tilläggsbar med
   integritetskontroll. Manipulerade poster identifieras och utesluts.

5. **Divisionsisolering**: Agenter i olika divisioner kan inte komma åt varandras
   data, hemligheter eller kommunikationskanaler.

---

## Jämförelse

| Funktion | SIDJUA | CrewAI | AutoGen | LangGraph | OpenClaw |
|---------|--------|--------|---------|-----------|----------|
| Extern styrning | ✅ Arkitektur | ❌ | ❌ | ❌ | ❌ |
| Tillämpning före åtgärd | ✅ 5-stegs pipeline | ❌ | ❌ | ❌ | ❌ |
| EU AI Act-redo | ✅ | ❌ | ❌ | ❌ | ❌ |
| Självhostad | ✅ | ❌ Moln | ❌ Moln | ❌ Moln | ✅ Plugin |
| Luftgapskapabel | ✅ | ❌ | ❌ | ❌ | ❌ |
| Modellagnostisk | ✅ Valfri LLM | Delvis | Delvis | Delvis | ✅ |
| Dubbelriktad e-post | ✅ | ❌ | ❌ | ❌ | ❌ |
| Discord-gateway | ✅ | ❌ | ❌ | ❌ | ❌ |
| Hierarkiska agenter | ✅ Divisioner + Nivåer | Grundläggande | Grundläggande | Graf | ❌ |
| Budgettillämpning | ✅ Per-agent-gränser | ❌ | ❌ | ❌ | ❌ |
| Sandboxisolering | ✅ bubblewrap | ❌ | ❌ | ❌ | ❌ |
| Revisionsoföränderlighet | ✅ WAL + integritet | ❌ | ❌ | ❌ | ❌ |
| Licens | AGPL-3.0 | MIT | MIT | MIT | Blandad |
| Oberoende revisioner | ✅ 2 externa | ❌ | ❌ | ❌ | ❌ |

---

## Funktioner

### Styrning och efterlevnad

**Pipeline före åtgärd (Steg 0)** körs före varje agentåtgärd: Förbjuden
kontroll → Mänskligt godkännande → Budgettillämpning → Dataklassificering → Anpassad
policy. Alla fem stegen är strukturella — de utförs i kod, inte i
agentens prompt.

**Obligatoriska basregler** levereras med varje installation: 10 styrningsregler
(`SYS-SEC-001` till `SYS-GOV-002`) som inte kan tas bort eller försvagas av
användarkonfiguration. Anpassade regler utökar basen; de kan inte åsidosätta den.

**EU AI Act-efterlevnad** — revisionskedja, klassificeringsramverk och godkännandearbetsflöden
mappas direkt till artikel 9, 12 och 17-krav. Efterlevnadsdeadlinen i
augusti 2026 är inbyggd i produktens färdplan.

**Efterlevnadsrapportering** via `sidjua audit report/violations/agents/export`:
efterlevnadspoäng, förtroenderesultat per agent, överträdelsehistorik, CSV/JSON-export
för externa revisorer eller SIEM-integration.

**Write-Ahead Log (WAL)** med integritetskontroll: varje styrningsbeslut
skrivs till en enbart tilläggsbar logg innan utförande. Manipulerade poster
identifieras vid läsning. `sidjua memory recover` validerar och reparerar om.

### Kommunikation

Agenter svarar inte bara på API-anrop — de deltar i verkliga kommunikationskanaler.

**Dubbelriktad e-post** (`sidjua email status/test/threads`): agenter tar emot
e-post via IMAP-avsökning och svarar via SMTP. Trådmappning via In-Reply-To-huvuden
håller konversationer sammanhängande. Avsändarallowlisting, storleksgränser för e-postinnehåll
och HTML-rensning skyddar agentpipelinen från skadlig indata.

**Discord Gateway Bot**: fullständigt slash-kommandogränssnitt via `sidjua module install
discord`. Agenter svarar på Discord-meddelanden, underhåller konversationstrådar
och skickar proaktiva aviseringar.

**Telegram-integration**: agentaviseringar och notifikationer via Telegram-bot.
Multi-kanals adaptermönster stöder Telegram, Discord, ntfy och e-post
parallellt.

### Operationer

**Ett enda Docker-kommando** till produktion:

```bash
docker run -p 4200:4200 ghcr.io/goetzkohlberg/sidjua:latest
```

API-nyckeln genereras automatiskt vid första start och skrivs ut i containerloggarna.
Inga miljövariabler krävs. Ingen konfiguration krävs. Ingen databas-
server krävs — SIDJUA använder SQLite, en databasfil per agent.

**CLI-hantering** — fullständigt livscykelhantering från ett enda binärprogram:

```bash
sidjua init                      # Interaktiv arbetsyteinställning (3 steg)
sidjua apply                     # Etablering från divisions.yaml
sidjua agent create/list/stop    # Agentlivscykel
sidjua run "task..." --wait      # Skicka uppgift med styrningsverkställighet
sidjua audit report              # Efterlevnadsrapport
sidjua costs                     # Kostnadsuppdelning per division/agent
sidjua backup create/restore     # HMAC-signerad säkerhetskopieringshantering
sidjua update                    # Versionsuppdatering med automatisk säkerhetskopiering
sidjua rollback                  # 1-klicks återställning till föregående version
sidjua email status/test         # Hantering av e-postkanal
sidjua secret set/get/rotate     # Krypterad hemlighetshantering
sidjua memory import/search      # Semantisk kunskapspipeline
sidjua selftest                  # Systemhälsokontroll (7 kategorier, 0-100 poäng)
```

**Semantiskt minne** — importera konversationer och dokument (`sidjua memory import
~/exports/claude-chats.zip`), sök med hybridrankad vektor + BM25. Stöder
Cloudflare Workers AI-inbäddningar (gratis, utan konfiguration) och stora OpenAI-inbäddningar
(högre kvalitet för stora kunskapsbaser).

**Adaptiv fragmentering** — minnespipelinen justerar automatiskt fragmentstorlekar för att hålla sig
inom varje inbäddningsmodells tokengräns.

**Nollkonfigurationsguide** — `sidjua chat guide` startar en interaktiv AI-assistent
utan någon API-nyckel, driven av Cloudflare Workers AI via SIDJUA-proxy.
Fråga den hur man konfigurerar agenter, ställer in styrning eller förstår vad som hände
i revisionsloggen.

**Luftgapsdriftsättning** — kör helt utan internetanslutning med lokala
LLM:er via Ollama eller någon OpenAI-kompatibel endpoint. Ingen telemetri som standard.
Valfri felrapportering med fullständig PII-redigering.

### Säkerhet

**Sandboxisolering** — agentfärdigheter körs inuti OS-nivå processisolering via
bubblewrap (Linux-användarnamnrymder). Noll extra RAM-belastning. Anslutningsbart
`SandboxProvider`-gränssnitt: `none` för utveckling, `bubblewrap` för produktion.

**Hemlighetshantering** — krypterat hemlighetsarkiv med RBAC (`sidjua secret
set/get/list/delete/rotate/namespaces`). Inget externt valv krävs.

**Säkerhetsfokuserad uppbyggnad** — omfattande intern testsvit plus oberoende
validering av 2 externa kodrevisorer (DeepSeek V3 och xAI Grok). Säkerhets-
rubriker, CSRF-skydd, hastighetsbegränsning och indatasanering på varje API-yta.
SQL-injektionsförebyggande med parametriserade frågor genomgående.

**Säkerhetskopieringsintegritet** — HMAC-signerade säkerhetskopieringsarkiv med zip-slip-skydd,
zip-bomb-förebyggande och manifestkontrollsummaverifiering vid återställning.

---

## Import från andra ramverk

```bash
# Förhandsgranska vad som importeras — inga ändringar görs
sidjua import openclaw --dry-run

# Importera konfiguration + färdighetsfiler
sidjua import openclaw --skills
```

Dina befintliga agenter behåller sin identitet, modeller och färdigheter. SIDJUA lägger
automatiskt till styrning, revisionskedjor och budgetkontroller.

---

## Konfigurationsreferens

En minimal `divisions.yaml` för att komma igång:

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

`sidjua apply` etablerar den fullständiga infrastrukturen från den här filen. Kör igen
efter ändringar — den är idempotent.

Se [docs/SIDJUA-APPLY-TECH-SPEC-V1.md](docs/SIDJUA-APPLY-TECH-SPEC-V1.md)
för den fullständiga specifikationen av alla 10 etableringssteg.

---

## REST API

SIDJUA REST API körs på samma port som instrumentpanelen:

```bash
sidjua server start --port 4200 --api-key $SIDJUA_API_KEY
```

Nyckelendpoints:

```
GET  /api/v1/health          # Offentlig hälsokontroll (ingen autentisering)
GET  /api/v1/info            # Systemmetadata (autentiserad)
POST /api/v1/execute/run     # Skicka en uppgift
GET  /api/v1/execute/:id/status  # Uppgiftsstatus
GET  /api/v1/execute/:id/result  # Uppgiftsresultat
GET  /api/v1/events          # SSE-händelseström
GET  /api/v1/audit/report    # Efterlevnadsrapport
```

Alla endpoints utom `/health` kräver Bearer-autentisering. Generera en nyckel:

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

Eller använd den medföljande `docker-compose.yml` som lägger till namngivna volymer för konfiguration,
loggar och agentarbetsyta, plus en valfri Qdrant-tjänst för semantisk sökning:

```bash
docker compose up -d
docker compose exec sidjua sidjua init
docker compose exec sidjua sidjua apply
```

---

## Leverantörer

SIDJUA ansluter till valfri LLM-leverantör utan inlåsning:

| Leverantör | Modeller | API-nyckel |
|-----------|---------|------------|
| Anthropic | Claude Sonnet 4.6, Haiku 4.5, Opus 4.6 | `ANTHROPIC_API_KEY` |
| Google | Gemini 2.0, Gemini 1.5 Pro | `GOOGLE_API_KEY` |
| Groq | Llama 3.x, Mixtral | `GROQ_API_KEY` (gratisnivå) |
| Cloudflare Workers AI | Llama, Mistral, Phi | `CF_ACCOUNT_ID` + `CF_TOKEN` |
| Ollama | Valfri lokal modell | Ingen nyckel (lokal) |
| OpenAI-kompatibel | Valfri endpoint | Anpassad URL + nyckel |

```bash
# Lägg till en leverantörsnyckel
sidjua key set groq gsk_...

# Lista tillgängliga leverantörer och modeller
sidjua provider list
```

---

## Färdplan

Fullständig färdplan på [sidjua.com/roadmap](https://sidjua.com/roadmap).

På kort sikt:
- Multi-agent orkestreringsmönster (V1.1)
- Webhook-inkommande utlösare (V1.1)
- Agent-till-agent-kommunikation (V1.2)
- Enterprise SSO-integration (V1.x)
- Molnhostad styrningsvalideringstjänst (V1.x)

---

## Gemenskap

- **Discord**: [sidjua.com/discord](https://sidjua.com/discord)
- **GitHub Issues**: [github.com/GoetzKohlberg/sidjua/issues](https://github.com/GoetzKohlberg/sidjua/issues)
- **E-post**: contact@sidjua.com
- **Dokumentation**: [sidjua.com/docs](https://sidjua.com/docs)

Om du hittar ett fel, öppna ett ärende — vi rör oss snabbt.

---

## Översättningar

SIDJUA finns på 26 språk. Engelska och tyska underhålls av kärnteamet. Alla andra översättningar genereras av AI och underhålls av gemenskapen.

**Dokumentation:** Denna README och [Installationsguiden](docs/INSTALLATION.md) finns tillgängliga på alla 26 språk. Se språkväljaren längst upp på den här sidan.

| Region | Språk |
|--------|-------|
| Amerika | Engelska, Spanska, Portugisiska (Brasilien) |
| Europa | Tyska, Franska, Italienska, Nederländska, Polska, Tjeckiska, Rumänska, Ryska, Ukrainska, Svenska, Turkiska |
| Mellanöstern | Arabiska |
| Asien | Hindi, Bengali, Filippinska, Indonesiska, Malajiska, Thailändska, Vietnamesiska, Japanska, Koreanska, Kinesiska (förenklad), Kinesiska (traditionell) |

Hittade du ett översättningsfel? Öppna ett GitHub-ärende med:
- Språket och lokalkoden (t.ex. `fil`)
- Den felaktiga texten eller nyckeln från lokalfilen (t.ex. `gui.nav.dashboard`)
- Den korrekta översättningen

Vill du underhålla ett språk? Se [CONTRIBUTING.md](CONTRIBUTING.md#translations) — vi använder en per-språk underhållsmodell.

---

## Licens

**AGPL-3.0** — du kan fritt använda, modifiera och distribuera SIDJUA så länge
du delar ändringar under samma licens. Källkoden är alltid tillgänglig
för användare av en hostad driftsättning.

Företagslicens tillgänglig för organisationer som kräver proprietär
driftsättning utan AGPL-skyldigheter.
[contact@sidjua.com](mailto:contact@sidjua.com)
