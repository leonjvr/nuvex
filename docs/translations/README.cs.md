[English](../../README.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [Français](README.fr.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [中文 (简体)](README.zh-CN.md) | [中文 (繁體)](README.zh-TW.md) | [العربية](README.ar.md) | [বাংলা](README.bn.md) | [Čeština](README.cs.md) | [Filipino](README.fil.md) | [हिन्दी](README.hi.md) | [Bahasa Indonesia](README.id.md) | [Italiano](README.it.md) | [Bahasa Melayu](README.ms.md) | [Nederlands](README.nl.md) | [Polski](README.pl.md) | [Português (BR)](README.pt-BR.md) | [Română](README.ro.md) | [Русский](README.ru.md) | [Svenska](README.sv.md) | [ภาษาไทย](README.th.md) | [Türkçe](README.tr.md) | [Українська](README.uk.md) | [Tiếng Việt](README.vi.md)

> *Tato stránka byla automaticky přeložena z [anglického originálu](../../README.md). Našli jste chybu? [Nahlaste ji](https://github.com/GoetzKohlberg/sidjua/issues).*

---

# SIDJUA — Platforma pro správu AI agentů

> Jediná platforma pro agenty, kde je správa vynucena architekturou, nikoli nadějí, že se model bude chovat správně.

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Docker](https://img.shields.io/badge/Docker-ghcr.io%2Fgoetzkohlberg%2Fsidjua-blue)](https://ghcr.io/goetzkohlberg/sidjua)
[![Version](https://img.shields.io/badge/version-1.0.0-green)](https://github.com/GoetzKohlberg/sidjua/releases)

---

## Instalace

### Předpoklady

| Nástroj | Požadováno | Poznámky |
|---------|-----------|---------|
| **Node.js** | >= 22.0.0 | ES moduly, `fetch()`, `crypto.subtle`. [Stáhnout](https://nodejs.org) |
| **C/C++ Toolchain** | Pouze pro sestavení ze zdrojů | `better-sqlite3` a `argon2` kompilují nativní doplňky |
| **Docker** | >= 24 (volitelné) | Pouze pro nasazení přes Docker |

Instalace Node.js 22: Ubuntu/Debian (`curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs`), macOS (`brew install node@22`), Windows (`winget install OpenJS.NodeJS.LTS`).

Instalace nástrojů C/C++: Ubuntu (`sudo apt-get install -y python3 make g++ build-essential`), macOS (`xcode-select --install`), Windows (`npm install --global windows-build-tools`).

### Možnost A — Docker (doporučeno)

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
docker compose up -d
```

```bash
# Zobrazení automaticky vygenerovaného API klíče
docker compose exec sidjua cat /app/.system/api-key

# Inicializace správy
docker compose exec sidjua sidjua apply --verbose

# Kontrola stavu systému
docker compose exec sidjua sidjua selftest
```

Podporuje **linux/amd64** a **linux/arm64** (Raspberry Pi, Apple Silicon).

### Možnost B — Globální instalace přes npm

```bash
npm install -g sidjua
sidjua init          # Interaktivní 3krokové nastavení
sidjua chat guide    # Průvodce AI bez konfigurace (bez API klíče)
```

### Možnost C — Sestavení ze zdrojů

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
npm ci && npm run build
node dist/index.js --help
```

### Poznámky k platformám

| Funkce | Linux | macOS | Windows (WSL2) | Windows (nativní) |
|--------|-------|-------|----------------|-------------------|
| CLI + REST API | ✅ Plné | ✅ Plné | ✅ Plné | ✅ Plné |
| Docker | ✅ Plné | ✅ Plné (Desktop) | ✅ Plné (Desktop) | ✅ Plné (Desktop) |
| Sandboxing (bubblewrap) | ✅ Plné | ❌ Přepne na `none` | ✅ Plné (uvnitř WSL2) | ❌ Přepne na `none` |
| Web Management Console | ✅ Full | ✅ Full | ✅ Full | ✅ Full |

Není vyžadována žádná externí databáze. SIDJUA používá SQLite. Qdrant je volitelný (pouze pro sémantické vyhledávání).

Kompletní průvodce naleznete v [docs/INSTALLATION.md](docs/INSTALLATION.md), včetně struktury adresářů, proměnných prostředí, řešení problémů pro jednotlivé OS a reference Docker volumes.

---

## Proč SIDJUA?

Každý framework pro AI agenty dnes spoléhá na stejný chybný předpoklad: že můžete
důvěřovat AI, že bude dodržovat vlastní pravidla.

**Problém se správou založenou na promptech:**

Agentovi zadáte systémový prompt, který říká „nikdy nepřistupuj k zákazníkově PII."
Agent si pokyn přečte. Agent také přečte zprávu uživatele, který ho žádá, aby stáhl
platební historii Johna Smithe. Agent se — sám od sebe — rozhodne, zda se přizpůsobí.
To není správa. To je důrazné doporučení.

**SIDJUA je jiný.**

Správa sedí **vně** agenta. Každá akce prochází 5krokovou pipeline vynucování
**před** provedením. Pravidla definujete v YAML. Systém je vynucuje. Agent nikdy
nedostane možnost rozhodnout, zda je bude dodržovat, protože kontrola probíhá
před tím, než agent jedná.

Toto je správa architekturou — ne promptováním, ne fine-tuningem, ne nadějí.

---

## Jak to funguje

SIDJUA obaluje vaše agenty do externí vrstvy správy. Volání LLM agenta nikdy nenastane,
dokud navrhovaná akce neprojde 5stupňovou pipeline vynucování:

**Stupeň 1 — Zakázáno:** Blokované akce jsou okamžitě odmítnuty. Žádné volání LLM,
žádný záznam v logu označený „povoleno", žádná druhá šance. Pokud je akce na
seznamu zakázaných, zastaví se zde.

**Stupeň 2 — Schválení:** Akce vyžadující souhlas člověka jsou před provedením
zadrženy ke schválení. Agent čeká. Člověk rozhoduje.

**Stupeň 3 — Rozpočet:** Každý úkol běží oproti limitům nákladů v reálném čase.
Jsou vynuceny rozpočty na úkol a na agenta. Po dosažení limitu je úkol zrušen —
ne označen, ne zaznamenán ke kontrole, *zrušen*.

**Stupeň 4 — Klasifikace:** Data překračující hranice oddělení jsou kontrolována
oproti pravidlům klasifikace. Agent Tier-2 nemůže přistupovat k datům SECRET.
Agent v Oddělení A nemůže číst tajemství Oddělení B.

**Stupeň 5 — Zásady:** Vlastní organizační pravidla, strukturálně vynucená. Limity
frekvence volání API, limity výstupních tokenů, omezení časových oken.

Celá pipeline běží před provedením jakékoli akce. Pro operace kritické pro správu
neexistuje režim „zaznamenat a zkontrolovat později".

### Jeden konfigurační soubor

Celá vaše organizace agentů žije v jednom souboru `divisions.yaml`:

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

`sidjua apply` přečte tento soubor a zajistí kompletní infrastrukturu agentů:
agenty, oddělení, RBAC, směrování, auditní tabulky, cesty k tajemstvím a pravidla správy
— v 10 reprodukovatelných krocích.

### Architektura agentů

Agenti jsou organizováni do **oddělení** (funkčních skupin) a **úrovní**
(úrovní důvěry). Agenti Tier 1 mají plnou autonomii v rámci svého obálky správy.
Agenti Tier 2 vyžadují schválení pro citlivé operace. Agenti Tier 3 jsou plně
pod dohledem. Systém úrovní je vynucován strukturálně — agent se nemůže sám povýšit.

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

## Architektonická omezení

SIDJUA vynucuje tato omezení na úrovni architektury — nemohou být agenty deaktivována,
obejita ani přepsána:

1. **Správa je externí**: Vrstva správy obaluje agenta. Agent nemá přístup
   ke kódu správy, nemůže měnit pravidla a nemůže zjistit, zda správa existuje.

2. **Před akcí, ne po akci**: Každá akce je kontrolována PŘED provedením.
   Pro operace kritické pro správu neexistuje režim „zaznamenat a zkontrolovat později".

3. **Strukturální vynucování**: Pravidla jsou vynucována cestami kódu, ne
   prompty ani instrukcemi modelu. Agent nemůže „jailbreaknout" ze správy,
   protože správa není implementována jako instrukce pro model.

4. **Neměnnost auditu**: Protokol Write-Ahead Log (WAL) je pouze pro přidávání
   s ověřením integrity. Pozměněné záznamy jsou detekovány a vyloučeny.

5. **Izolace oddělení**: Agenti v různých odděleních nemohou přistupovat k datům,
   tajemstvím ani komunikačním kanálům navzájem.

---

## Srovnání

| Funkce | SIDJUA | CrewAI | AutoGen | LangGraph | OpenClaw |
|--------|--------|--------|---------|-----------|----------|
| Externí správa | ✅ Architektura | ❌ | ❌ | ❌ | ❌ |
| Vynucování před akcí | ✅ 5stupňová pipeline | ❌ | ❌ | ❌ | ❌ |
| Připravenost pro EU AI Act | ✅ | ❌ | ❌ | ❌ | ❌ |
| Vlastní hosting | ✅ | ❌ Cloud | ❌ Cloud | ❌ Cloud | ✅ Plugin |
| Schopnost vzduchové mezery | ✅ | ❌ | ❌ | ❌ | ❌ |
| Nezávislost na modelu | ✅ Jakýkoli LLM | Částečné | Částečné | Částečné | ✅ |
| Obousměrný e-mail | ✅ | ❌ | ❌ | ❌ | ❌ |
| Discord Gateway | ✅ | ❌ | ❌ | ❌ | ❌ |
| Hierarchičtí agenti | ✅ Oddělení + úrovně | Základní | Základní | Graf | ❌ |
| Vynucování rozpočtu | ✅ Limity na agenta | ❌ | ❌ | ❌ | ❌ |
| Izolace sandboxu | ✅ bubblewrap | ❌ | ❌ | ❌ | ❌ |
| Neměnnost auditu | ✅ WAL + integrita | ❌ | ❌ | ❌ | ❌ |
| Licence | AGPL-3.0 | MIT | MIT | MIT | Smíšená |
| Nezávislé audity | ✅ 2 externí | ❌ | ❌ | ❌ | ❌ |

---

## Funkce

### Správa a shoda

**Pipeline před akcí (Stupeň 0)** běží před každou akcí agenta: Kontrola zakázaných
→ Lidské schválení → Vynucování rozpočtu → Klasifikace dat → Vlastní zásady.
Všech pět stupňů je strukturálních — vykonávají se v kódu, ne v promptu agenta.

**Povinná základní pravidla** jsou součástí každé instalace: 10 pravidel správy
(`SYS-SEC-001` až `SYS-GOV-002`), která nemohou být odstraněna ani oslabena
uživatelskou konfigurací. Vlastní pravidla základní rozšiřují; nemohou ji přepsat.

**Shoda s EU AI Act** — auditní stopa, klasifikační rámec a pracovní postupy
schvalování se přímo mapují na požadavky článků 9, 12 a 17. Termín shody
v srpnu 2026 je zabudován do produktového plánu.

**Hlášení o shodě** prostřednictvím `sidjua audit report/violations/agents/export`:
skóre shody, skóre důvěry na agenta, historie porušení, export CSV/JSON
pro externí auditory nebo integraci SIEM.

**Protokol Write-Ahead Log (WAL)** s ověřením integrity: každé rozhodnutí správy
je zapsáno do logu jen pro přidávání před provedením. Pozměněné záznamy jsou
detekovány při čtení. `sidjua memory recover` znovu ověřuje a opravuje.

### Komunikace

Agenti nereagují jen na volání API — účastní se skutečných komunikačních kanálů.

**Obousměrný e-mail** (`sidjua email status/test/threads`): agenti přijímají
e-mail pomocí IMAP pollingu a odpovídají prostřednictvím SMTP. Mapování vláken
pomocí hlaviček In-Reply-To udržuje konverzace koherentní. Whitelisting odesílatelů,
limity velikosti těla zprávy a odstraňování HTML chrání pipeline agenta před
škodlivým vstupem.

**Discord Gateway Bot**: úplné rozhraní příkazů lomítkem prostřednictvím `sidjua module install
discord`. Agenti reagují na zprávy Discord, udržují vlákna konverzací
a odesílají proaktivní oznámení.

**Integrace Telegram**: upozornění a oznámení agenta prostřednictvím bota Telegram.
Vzor adaptéru pro více kanálů podporuje Telegram, Discord, ntfy a e-mail
paralelně.

### Provoz

**Jediný příkaz Docker** do produkce:

```bash
docker run -p 4200:4200 ghcr.io/goetzkohlberg/sidjua:latest
```

API klíč je automaticky vygenerován při prvním spuštění a vytištěn do logů kontejneru.
Nejsou vyžadovány žádné proměnné prostředí. Není vyžadována žádná konfigurace. Není
vyžadován žádný databázový server — SIDJUA používá SQLite, jeden databázový soubor na agenta.

**Správa CLI** — kompletní životní cyklus z jediného binárního souboru:

```bash
sidjua init                      # Interaktivní nastavení pracovního prostoru (3 kroky)
sidjua apply                     # Zřízení z divisions.yaml
sidjua agent create/list/stop    # Životní cyklus agenta
sidjua run "task..." --wait      # Odeslání úkolu s vynucením správy
sidjua audit report              # Zpráva o shodě
sidjua costs                     # Rozpis nákladů podle oddělení/agenta
sidjua backup create/restore     # Správa záloh podepsaných HMAC
sidjua update                    # Aktualizace verze s automatickou zálohou předem
sidjua rollback                  # Obnovení předchozí verze jedním kliknutím
sidjua email status/test         # Správa e-mailového kanálu
sidjua secret set/get/rotate     # Správa šifrovaných tajemství
sidjua memory import/search      # Pipeline sémantických znalostí
sidjua selftest                  # Kontrola stavu systému (7 kategorií, skóre 0-100)
```

**Sémantická paměť** — importujte konverzace a dokumenty (`sidjua memory import
~/exports/claude-chats.zip`), vyhledávejte s hybridním hodnocením vektoru + BM25.
Podporuje embeddingy Cloudflare Workers AI (zdarma, bez konfigurace) a velké
embeddingy OpenAI (vyšší kvalita pro velké znalostní báze).

**Adaptivní dělení** — pipeline paměti automaticky upravuje velikosti bloků,
aby zůstala v limitu tokenů každého modelu pro embedding.

**Průvodce bez konfigurace** — `sidjua chat guide` spustí interaktivního AI asistenta
bez jakéhokoli API klíče, poháněného Cloudflare Workers AI přes proxy SIDJUA.
Zeptejte se ho, jak nastavit agenty, nakonfigurovat správu nebo pochopit, co
se stalo v auditním logu.

**Nasazení se vzduchovou mezerou** — spusťte zcela odpojeně od internetu pomocí
lokálních LLM přes Ollama nebo jakýkoli endpoint kompatibilní s OpenAI.
Žádná telemetrie ve výchozím nastavení. Volitelné hlášení o pádu s úplnou
redakcí PII.

### Zabezpečení

**Izolace sandboxu** — dovednosti agenta běží uvnitř izolace procesu na úrovni OS
prostřednictvím bubblewrap (Linux user namespaces). Žádná dodatečná režie RAM.
Plugovatelné rozhraní `SandboxProvider`: `none` pro vývoj, `bubblewrap` pro produkci.

**Správa tajemství** — šifrované úložiště tajemství s RBAC (`sidjua secret
set/get/list/delete/rotate/namespaces`). Není vyžadován žádný externí trezor.

**Bezpečnostní build na prvním místě** — rozsáhlá interní testovací sada plus
nezávislé ověření 2 externími auditory kódu (DeepSeek V3 a xAI Grok). Bezpečnostní
hlavičky, ochrana CSRF, omezování sazeb a sanitace vstupů na každém povrchu API.
Prevence SQL injection s parametrizovanými dotazy v celém systému.

**Integrita záloh** — záložní archivy podepsané HMAC s ochranou zip-slip,
prevencí zip bomb a ověřením kontrolního součtu manifestu při obnovení.

---

## Import z jiných frameworků

```bash
# Náhled toho, co se importuje — žádné změny se neprovedou
sidjua import openclaw --dry-run

# Import konfiguračních souborů + dovedností
sidjua import openclaw --skills
```

Vaši stávající agenti si zachovají svou identitu, modely a dovednosti. SIDJUA
automaticky přidá správu, auditní stopy a kontroly rozpočtu.

---

## Reference ke konfiguraci

Minimální soubor `divisions.yaml` pro začátek:

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

`sidjua apply` zajistí kompletní infrastrukturu z tohoto souboru. Spusťte
znovu po změnách — je idempotentní.

Kompletní specifikaci všech 10 kroků zřizování naleznete v
[docs/SIDJUA-APPLY-TECH-SPEC-V1.md](docs/SIDJUA-APPLY-TECH-SPEC-V1.md).

---

## REST API

SIDJUA REST API běží na stejném portu jako dashboard:

```bash
sidjua server start --port 4200 --api-key $SIDJUA_API_KEY
```

Klíčové endpointy:

```
GET  /api/v1/health          # Veřejná kontrola stavu (bez ověření)
GET  /api/v1/info            # Metadata systému (ověřeno)
POST /api/v1/execute/run     # Odeslání úkolu
GET  /api/v1/execute/:id/status  # Stav úkolu
GET  /api/v1/execute/:id/result  # Výsledek úkolu
GET  /api/v1/events          # Proud událostí SSE
GET  /api/v1/audit/report    # Zpráva o shodě
```

Všechny endpointy kromě `/health` vyžadují ověření Bearer. Vygenerujte klíč:

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

Nebo použijte přiložený soubor `docker-compose.yml`, který přidává pojmenované
svazky pro konfiguraci, logy a pracovní prostor agenta, plus volitelnou službu
Qdrant pro sémantické vyhledávání:

```bash
docker compose up -d
docker compose exec sidjua sidjua init
docker compose exec sidjua sidjua apply
```

---

## Poskytovatelé

SIDJUA se připojuje k jakémukoli poskytovateli LLM bez uzamčení:

| Poskytovatel | Modely | API klíč |
|-------------|--------|----------|
| Anthropic | Claude Sonnet 4.6, Haiku 4.5, Opus 4.6 | `ANTHROPIC_API_KEY` |
| Google | Gemini 2.0, Gemini 1.5 Pro | `GOOGLE_API_KEY` |
| Groq | Llama 3.x, Mixtral | `GROQ_API_KEY` (bezplatná vrstva) |
| Cloudflare Workers AI | Llama, Mistral, Phi | `CF_ACCOUNT_ID` + `CF_TOKEN` |
| Ollama | Jakýkoli lokální model | Bez klíče (lokální) |
| Kompatibilní s OpenAI | Jakýkoli endpoint | Vlastní URL + klíč |

```bash
# Přidání klíče poskytovatele
sidjua key set groq gsk_...

# Výpis dostupných poskytovatelů a modelů
sidjua provider list
```

---

## Plán rozvoje

Kompletní plán rozvoje na [sidjua.com/roadmap](https://sidjua.com/roadmap).

Krátkodobě:
- Vzory orchestrace více agentů (V1.1)
- Příchozí spouštěče Webhook (V1.1)
- Komunikace agent-agent (V1.2)
- Integrace podnikového SSO (V1.x)
- Cloudová hostovaná služba ověřování správy (V1.x)

---

## Komunita

- **Discord**: [sidjua.com/discord](https://sidjua.com/discord)
- **GitHub Issues**: [github.com/GoetzKohlberg/sidjua/issues](https://github.com/GoetzKohlberg/sidjua/issues)
- **E-mail**: contact@sidjua.com
- **Dokumentace**: [sidjua.com/docs](https://sidjua.com/docs)

Pokud najdete chybu, otevřete issue — reagujeme rychle.

---

## Překlady

SIDJUA je dostupný v 26 jazycích. Angličtinu a němčinu spravuje základní tým. Všechny ostatní překlady jsou generovány AI a spravovány komunitou.

**Dokumentace:** Toto README a [Průvodce instalací](docs/INSTALLATION.md) jsou dostupné ve všech 26 jazycích. Viz výběr jazyka v horní části této stránky.

| Oblast | Jazyky |
|--------|--------|
| Amerika | Angličtina, španělština, portugalština (Brazílie) |
| Evropa | Němčina, francouzština, italština, nizozemština, polština, čeština, rumunština, ruština, ukrajinština, švédština, turečtina |
| Střední východ | Arabština |
| Asie | Hindština, bengálština, filipínština, indonéština, malajština, thajština, vietnamština, japonština, korejština, čínština (zjednodušená), čínština (tradiční) |

Našli jste chybu v překladu? Otevřete GitHub Issue s:
- Jazyk a kód lokalizace (např. `cs`)
- Nesprávný text nebo klíč ze souboru lokalizace (např. `gui.nav.dashboard`)
- Správný překlad

Chcete spravovat jazyk? Viz [CONTRIBUTING.md](CONTRIBUTING.md#translations) — používáme model správce pro každý jazyk.

---

## Licence

**AGPL-3.0** — SIDJUA můžete volně používat, upravovat a distribuovat, pokud
sdílíte úpravy pod stejnou licencí. Zdrojový kód je vždy dostupný uživatelům
hostovaného nasazení.

Podniková licence je dostupná pro organizace, které vyžadují proprietární
nasazení bez závazků AGPL.
[contact@sidjua.com](mailto:contact@sidjua.com)
