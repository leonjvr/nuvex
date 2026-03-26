[English](../../README.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [Français](README.fr.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [中文 (简体)](README.zh-CN.md) | [中文 (繁體)](README.zh-TW.md) | [العربية](README.ar.md) | [বাংলা](README.bn.md) | [Čeština](README.cs.md) | [Filipino](README.fil.md) | [हिन्दी](README.hi.md) | [Bahasa Indonesia](README.id.md) | [Italiano](README.it.md) | [Bahasa Melayu](README.ms.md) | [Nederlands](README.nl.md) | [Polski](README.pl.md) | [Português (BR)](README.pt-BR.md) | [Română](README.ro.md) | [Русский](README.ru.md) | [Svenska](README.sv.md) | [ภาษาไทย](README.th.md) | [Türkçe](README.tr.md) | [Українська](README.uk.md) | [Tiếng Việt](README.vi.md)

---

> *Ta strona została automatycznie przetłumaczona z [angielskiego oryginału](../../README.md). Znalazłeś błąd? [Zgłoś go](https://github.com/GoetzKohlberg/sidjua/issues).*

# SIDJUA — Platforma Zarządzania Agentami AI

> Jedyna platforma agentów, gdzie zarządzanie jest egzekwowane przez architekturę, a nie przez nadzieję, że model będzie się zachowywał właściwie.

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Docker](https://img.shields.io/badge/Docker-ghcr.io%2Fgoetzkohlberg%2Fsidjua-blue)](https://ghcr.io/goetzkohlberg/sidjua)
[![Version](https://img.shields.io/badge/version-1.0.0-green)](https://github.com/GoetzKohlberg/sidjua/releases)

---

## Instalacja

### Wymagania wstępne

| Narzędzie | Wymagane | Uwagi |
|-----------|----------|-------|
| **Node.js** | >= 22.0.0 | Moduły ES, `fetch()`, `crypto.subtle`. [Pobierz](https://nodejs.org) |
| **Zestaw narzędzi C/C++** | Tylko kompilacje ze źródeł | `better-sqlite3` i `argon2` kompilują natywne dodatki |
| **Docker** | >= 24 (opcjonalnie) | Tylko do wdrożenia Docker |

Instalacja Node.js 22: Ubuntu/Debian (`curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs`), macOS (`brew install node@22`), Windows (`winget install OpenJS.NodeJS.LTS`).

Instalacja narzędzi C/C++: Ubuntu (`sudo apt-get install -y python3 make g++ build-essential`), macOS (`xcode-select --install`), Windows (`npm install --global windows-build-tools`).

### Opcja A — Docker (Zalecane)

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
docker compose up -d
```

```bash
# Wyświetl automatycznie wygenerowany klucz API
docker compose exec sidjua cat /app/.system/api-key

# Uruchom zarządzanie
docker compose exec sidjua sidjua apply --verbose

# Sprawdzenie stanu systemu
docker compose exec sidjua sidjua selftest
```

Obsługuje **linux/amd64** i **linux/arm64** (Raspberry Pi, Apple Silicon).

### Opcja B — Globalna instalacja npm

```bash
npm install -g sidjua
sidjua init          # Interaktywna konfiguracja w 3 krokach
sidjua chat guide    # Przewodnik AI bez konfiguracji (bez klucza API)
```

### Opcja C — Kompilacja ze źródeł

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
npm ci && npm run build
node dist/index.js --help
```

### Uwagi dotyczące platform

| Funkcja | Linux | macOS | Windows (WSL2) | Windows (natywny) |
|---------|-------|-------|----------------|-------------------|
| CLI + REST API | ✅ Pełne | ✅ Pełne | ✅ Pełne | ✅ Pełne |
| Docker | ✅ Pełne | ✅ Pełne (Desktop) | ✅ Pełne (Desktop) | ✅ Pełne (Desktop) |
| Piaskownica (bubblewrap) | ✅ Pełne | ❌ Powrót do `none` | ✅ Pełne (w WSL2) | ❌ Powrót do `none` |
| Web Management Console | ✅ Full | ✅ Full | ✅ Full | ✅ Full |

Żadna zewnętrzna baza danych nie jest wymagana. SIDJUA używa SQLite. Qdrant jest opcjonalny (tylko wyszukiwanie semantyczne).

Zobacz [docs/INSTALLATION.md](docs/INSTALLATION.md), aby uzyskać pełny przewodnik z układem katalogów, zmiennymi środowiskowymi, rozwiązywaniem problemów dla poszczególnych systemów operacyjnych i odwołaniem do woluminów Docker.

---

## Dlaczego SIDJUA?

Każdy framework agentów AI opiera się dziś na tym samym błędnym założeniu: że możesz
zaufać AI, że będzie przestrzegać własnych zasad.

**Problem z zarządzaniem opartym na promptach:**

Dajesz agentowi prompt systemowy mówiący „nigdy nie uzyskuj dostępu do PII klientów". Agent
czyta instrukcję. Agent czyta też wiadomość użytkownika z prośbą o pobranie historii płatności
Jana Kowalskiego. Agent decyduje — samodzielnie — czy zastosować się do polecenia. To nie jest
zarządzanie. To mocno sformułowana sugestia.

**SIDJUA jest inne.**

Zarządzanie znajduje się **poza** agentem. Każda akcja przechodzi przez 5-etapowy
potok egzekwowania przed akcją **zanim** zostanie wykonana. Definiujesz reguły w
YAML. System je egzekwuje. Agent nigdy nie decyduje, czy je przestrzegać,
ponieważ sprawdzenie odbywa się przed działaniem agenta.

To zarządzanie przez architekturę — nie przez promptowanie, nie przez dostrajanie,
nie przez nadzieję.

---

## Jak to działa

SIDJUA otacza agentów zewnętrzną warstwą zarządzania. Wywołanie LLM agenta
nigdy nie następuje, dopóki proponowana akcja nie przejdzie przez 5-etapowy potok egzekwowania:

**Etap 1 — Zakazane:** Zablokowane akcje są natychmiast odrzucane. Bez wywołania LLM,
bez wpisu w dzienniku oznaczonego jako „dozwolone", bez drugiej szansy. Jeśli akcja jest na
liście zakazanych, zatrzymuje się tutaj.

**Etap 2 — Zatwierdzenie:** Akcje wymagające zatwierdzenia przez człowieka są wstrzymywane do
zatwierdzenia przed wykonaniem. Agent czeka. Człowiek decyduje.

**Etap 3 — Budżet:** Każde zadanie jest realizowane w ramach limitów kosztów w czasie rzeczywistym. Budżety
dla zadań i agentów są egzekwowane. Gdy limit zostanie osiągnięty, zadanie jest
anulowane — nie oznaczane, nie rejestrowane do przeglądu, *anulowane*.

**Etap 4 — Klasyfikacja:** Dane przekraczające granice działów są sprawdzane
pod kątem reguł klasyfikacji. Agent Tier-2 nie może uzyskać dostępu do danych SECRET. Agent
w Dziale A nie może czytać tajemnic Działu B.

**Etap 5 — Polityka:** Niestandardowe reguły organizacyjne, egzekwowane strukturalnie. Limity
częstotliwości wywołań API, ograniczenia tokenów wyjściowych, ograniczenia okna czasowego.

Cały potok uruchamia się przed wykonaniem jakiejkolwiek akcji. Nie ma trybu „rejestruj i
przeglądaj później" dla operacji krytycznych z punktu widzenia zarządzania.

### Pojedynczy plik konfiguracyjny

Cała organizacja agentów znajduje się w jednym pliku `divisions.yaml`:

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

`sidjua apply` odczytuje ten plik i tworzy kompletną infrastrukturę agentów:
agentów, działy, RBAC, routing, tabele audytu, ścieżki do sekretów i reguły
zarządzania — w 10 powtarzalnych krokach.

### Architektura agentów

Agenci są zorganizowani w **działy** (grupy funkcjonalne) i **poziomy**
(poziomy zaufania). Agenci Tier 1 mają pełną autonomię w ramach swojej koperty zarządzania.
Agenci Tier 2 wymagają zatwierdzenia dla wrażliwych operacji. Agenci Tier 3
są w pełni nadzorowani. System poziomów jest egzekwowany strukturalnie — agent
nie może się sam awansować.

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

## Ograniczenia architektoniczne

SIDJUA egzekwuje te ograniczenia na poziomie architektury — nie mogą być
wyłączone, obejścia ani nadpisane przez agentów:

1. **Zarządzanie jest zewnętrzne**: Warstwa zarządzania otacza agenta. Agent
   nie ma dostępu do kodu zarządzania, nie może modyfikować reguł i nie może wykryć,
   czy zarządzanie jest obecne.

2. **Przed akcją, nie po akcji**: Każda akcja jest sprawdzana PRZED wykonaniem.
   Nie ma trybu „rejestruj i przeglądaj później" dla operacji krytycznych z punktu widzenia zarządzania.

3. **Strukturalne egzekwowanie**: Reguły są egzekwowane przez ścieżki kodu, nie przez
   prompty ani instrukcje modelu. Agent nie może „uciec z więzienia" zarządzania,
   ponieważ zarządzanie nie jest implementowane jako instrukcje dla modelu.

4. **Niezmienność audytu**: Write-Ahead Log (WAL) jest tylko do dopisywania z
   weryfikacją integralności. Zmodyfikowane wpisy są wykrywane i wykluczane.

5. **Izolacja działów**: Agenci w różnych działach nie mogą uzyskiwać dostępu do nawzajem swoich
   danych, sekretów ani kanałów komunikacji.

---

## Porównanie

| Funkcja | SIDJUA | CrewAI | AutoGen | LangGraph | OpenClaw |
|---------|--------|--------|---------|-----------|----------|
| Zewnętrzne zarządzanie | ✅ Architektura | ❌ | ❌ | ❌ | ❌ |
| Egzekwowanie przed akcją | ✅ Potok 5-etapowy | ❌ | ❌ | ❌ | ❌ |
| Zgodność z EU AI Act | ✅ | ❌ | ❌ | ❌ | ❌ |
| Samodzielny hosting | ✅ | ❌ Chmura | ❌ Chmura | ❌ Chmura | ✅ Wtyczka |
| Możliwość działania offline | ✅ | ❌ | ❌ | ❌ | ❌ |
| Niezależność od modelu | ✅ Dowolny LLM | Częściowe | Częściowe | Częściowe | ✅ |
| Dwukierunkowy e-mail | ✅ | ❌ | ❌ | ❌ | ❌ |
| Bramka Discord | ✅ | ❌ | ❌ | ❌ | ❌ |
| Hierarchiczni agenci | ✅ Działy + Poziomy | Podstawowe | Podstawowe | Graf | ❌ |
| Egzekwowanie budżetu | ✅ Limity na agenta | ❌ | ❌ | ❌ | ❌ |
| Izolacja piaskownicą | ✅ bubblewrap | ❌ | ❌ | ❌ | ❌ |
| Niezmienność audytu | ✅ WAL + integralność | ❌ | ❌ | ❌ | ❌ |
| Licencja | AGPL-3.0 | MIT | MIT | MIT | Mieszana |
| Niezależne audyty | ✅ 2 zewnętrzne | ❌ | ❌ | ❌ | ❌ |

---

## Funkcje

### Zarządzanie i zgodność

**Potok przed akcją (Etap 0)** uruchamia się przed każdą akcją agenta: sprawdzenie zakazanych
→ zatwierdzenie przez człowieka → egzekwowanie budżetu → klasyfikacja danych → niestandardowa
polityka. Wszystkie pięć etapów jest strukturalnych — wykonują się w kodzie, nie w
prompcie agenta.

**Obowiązkowe reguły bazowe** dostarczane z każdą instalacją: 10 reguł zarządzania
(`SYS-SEC-001` do `SYS-GOV-002`), których nie można usunąć ani osłabić przez
konfigurację użytkownika. Niestandardowe reguły rozszerzają bazę; nie mogą jej nadpisać.

**Zgodność z EU AI Act** — ścieżka audytu, framework klasyfikacji i przepływy pracy
zatwierdzania bezpośrednio odpowiadają wymaganiom Artykułów 9, 12 i 17. Termin
zgodności w sierpniu 2026 jest wbudowany w plan produktu.

**Raportowanie zgodności** przez `sidjua audit report/violations/agents/export`:
wynik zgodności, wyniki zaufania dla poszczególnych agentów, historia naruszeń, eksport CSV/JSON
dla zewnętrznych audytorów lub integracji SIEM.

**Write-Ahead Log (WAL)** z weryfikacją integralności: każda decyzja zarządzania
jest zapisywana do dziennika tylko do dopisywania przed wykonaniem. Zmodyfikowane wpisy są
wykrywane przy odczycie. `sidjua memory recover` ponownie waliduje i naprawia.

### Komunikacja

Agenci nie tylko odpowiadają na wywołania API — uczestniczą w rzeczywistych kanałach komunikacji.

**Dwukierunkowy e-mail** (`sidjua email status/test/threads`): agenci odbierają
e-maile przez odpytywanie IMAP i odpowiadają przez SMTP. Mapowanie wątków przez nagłówki
In-Reply-To utrzymuje spójność rozmów. Biała lista nadawców, limity rozmiaru treści
i usuwanie HTML chronią potok agentów przed złośliwymi danymi wejściowymi.

**Bramka Discord Bot**: pełny interfejs poleceń slash przez `sidjua module install
discord`. Agenci odpowiadają na wiadomości Discord, utrzymują wątki rozmów
i wysyłają proaktywne powiadomienia.

**Integracja Telegram**: alerty agentów i powiadomienia przez bota Telegram.
Wzorzec adaptera wielo-kanałowego obsługuje Telegram, Discord, ntfy i E-mail
równolegle.

### Operacje

**Jedno polecenie Docker** do produkcji:

```bash
docker run -p 4200:4200 ghcr.io/goetzkohlberg/sidjua:latest
```

Klucz API jest generowany automatycznie przy pierwszym uruchomieniu i drukowany w dziennikach kontenera.
Żadne zmienne środowiskowe nie są wymagane. Żadna konfiguracja nie jest wymagana. Żaden serwer
bazy danych nie jest wymagany — SIDJUA używa SQLite, jeden plik bazy danych na agenta.

**Zarządzanie przez CLI** — pełny cykl życia z pojedynczego pliku binarnego:

```bash
sidjua init                      # Interaktywna konfiguracja obszaru roboczego (3 kroki)
sidjua apply                     # Provisioning z divisions.yaml
sidjua agent create/list/stop    # Cykl życia agenta
sidjua run "task..." --wait      # Prześlij zadanie z egzekwowaniem zarządzania
sidjua audit report              # Raport zgodności
sidjua costs                     # Podział kosztów według działu/agenta
sidjua backup create/restore     # Zarządzanie kopiami zapasowymi podpisanymi HMAC
sidjua update                    # Aktualizacja wersji z automatyczną kopią zapasową
sidjua rollback                  # Przywróć do poprzedniej wersji jednym kliknięciem
sidjua email status/test         # Zarządzanie kanałem e-mail
sidjua secret set/get/rotate     # Zarządzanie zaszyfrowanymi sekretami
sidjua memory import/search      # Semantyczny potok wiedzy
sidjua selftest                  # Sprawdzenie stanu systemu (7 kategorii, wynik 0-100)
```

**Pamięć semantyczna** — importuj rozmowy i dokumenty (`sidjua memory import
~/exports/claude-chats.zip`), przeszukuj z rankingiem hybrydowym wektor + BM25. Obsługuje
osadzenia Cloudflare Workers AI (bezpłatne, bez konfiguracji) i duże osadzenia OpenAI
(wyższa jakość dla dużych baz wiedzy).

**Adaptacyjne porcjowanie** — potok pamięci automatycznie dostosowuje rozmiary porcji, aby zmieścić się
w limicie tokenów każdego modelu osadzania.

**Przewodnik bez konfiguracji** — `sidjua chat guide` uruchamia interaktywnego asystenta AI
bez żadnego klucza API, zasilany przez Cloudflare Workers AI przez proxy SIDJUA.
Zapytaj go, jak skonfigurować agentów, skonfigurować zarządzanie lub zrozumieć, co się wydarzyło
w dzienniku audytu.

**Wdrożenie offline** — działa w pełni odłączony od internetu, używając lokalnych
LLM przez Ollama lub dowolny punkt końcowy kompatybilny z OpenAI. Brak telemetrii domyślnie.
Opcjonalne raportowanie awarii z pełną redakcją PII.

### Bezpieczeństwo

**Izolacja piaskownicą** — umiejętności agentów działają wewnątrz izolacji procesu na poziomie systemu operacyjnego przez
bubblewrap (przestrzenie nazw użytkowników Linux). Zero dodatkowego obciążenia pamięci RAM. Wtykowalne
interfejs `SandboxProvider`: `none` do programowania, `bubblewrap` do produkcji.

**Zarządzanie sekretami** — zaszyfrowany magazyn sekretów z RBAC (`sidjua secret
set/get/list/delete/rotate/namespaces`). Żaden zewnętrzny skarbiec nie jest wymagany.

**Budowanie zorientowane na bezpieczeństwo** — rozległy wewnętrzny zestaw testów plus niezależna
walidacja przez 2 zewnętrznych audytorów kodu (DeepSeek V3 i xAI Grok). Nagłówki
bezpieczeństwa, ochrona CSRF, ograniczanie szybkości i sanityzacja danych wejściowych na każdej powierzchni API.
Zapobieganie wstrzykiwaniu SQL z parametryzowanymi zapytaniami wszędzie.

**Integralność kopii zapasowych** — archiwa kopii zapasowych podpisane HMAC z ochroną zip-slip,
zapobieganiem bombie zip i weryfikacją sumy kontrolnej manifestu przy przywracaniu.

---

## Import z innych frameworków

```bash
# Podgląd tego, co zostanie zaimportowane — bez zmian
sidjua import openclaw --dry-run

# Importuj config + pliki umiejętności
sidjua import openclaw --skills
```

Twoje istniejące agenty zachowują swoją tożsamość, modele i umiejętności. SIDJUA dodaje
zarządzanie, ścieżki audytu i kontrole budżetu automatycznie.

---

## Dokumentacja konfiguracji

Minimalny `divisions.yaml` na dobry start:

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

`sidjua apply` tworzy kompletną infrastrukturę z tego pliku. Uruchom ponownie
po zmianach — jest idempotentny.

Zobacz [docs/SIDJUA-APPLY-TECH-SPEC-V1.md](docs/SIDJUA-APPLY-TECH-SPEC-V1.md)
dla pełnej specyfikacji wszystkich 10 kroków provisioningu.

---

## REST API

SIDJUA REST API działa na tym samym porcie co panel:

```bash
sidjua server start --port 4200 --api-key $SIDJUA_API_KEY
```

Kluczowe punkty końcowe:

```
GET  /api/v1/health          # Publiczne sprawdzenie stanu (bez uwierzytelniania)
GET  /api/v1/info            # Metadane systemu (uwierzytelnione)
POST /api/v1/execute/run     # Prześlij zadanie
GET  /api/v1/execute/:id/status  # Status zadania
GET  /api/v1/execute/:id/result  # Wynik zadania
GET  /api/v1/events          # Strumień zdarzeń SSE
GET  /api/v1/audit/report    # Raport zgodności
```

Wszystkie punkty końcowe oprócz `/health` wymagają uwierzytelniania Bearer. Wygeneruj klucz:

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

Lub użyj dołączonego `docker-compose.yml`, który dodaje nazwane woluminy dla konfiguracji,
dzienników i obszaru roboczego agenta, plus opcjonalną usługę Qdrant do wyszukiwania semantycznego:

```bash
docker compose up -d
docker compose exec sidjua sidjua init
docker compose exec sidjua sidjua apply
```

---

## Dostawcy

SIDJUA łączy się z dowolnym dostawcą LLM bez uzależnienia od dostawcy:

| Dostawca | Modele | Klucz API |
|----------|--------|-----------|
| Anthropic | Claude Sonnet 4.6, Haiku 4.5, Opus 4.6 | `ANTHROPIC_API_KEY` |
| Google | Gemini 2.0, Gemini 1.5 Pro | `GOOGLE_API_KEY` |
| Groq | Llama 3.x, Mixtral | `GROQ_API_KEY` (bezpłatny poziom) |
| Cloudflare Workers AI | Llama, Mistral, Phi | `CF_ACCOUNT_ID` + `CF_TOKEN` |
| Ollama | Dowolny model lokalny | Brak klucza (lokalny) |
| Kompatybilny z OpenAI | Dowolny punkt końcowy | Niestandardowy URL + klucz |

```bash
# Dodaj klucz dostawcy
sidjua key set groq gsk_...

# Wyświetl dostępnych dostawców i modele
sidjua provider list
```

---

## Plan działania

Pełny plan działania na [sidjua.com/roadmap](https://sidjua.com/roadmap).

Krótkoterminowe:
- Wzorce orkiestracji wielu agentów (V1.1)
- Wyzwalacze przychodzące webhook (V1.1)
- Komunikacja agent-do-agenta (V1.2)
- Integracja Enterprise SSO (V1.x)
- Usługa walidacji zarządzania hostowana w chmurze (V1.x)

---

## Społeczność

- **Discord**: [sidjua.com/discord](https://sidjua.com/discord)
- **Problemy GitHub**: [github.com/GoetzKohlberg/sidjua/issues](https://github.com/GoetzKohlberg/sidjua/issues)
- **E-mail**: contact@sidjua.com
- **Dokumentacja**: [sidjua.com/docs](https://sidjua.com/docs)

Jeśli znajdziesz błąd, otwórz problem — działamy szybko.

---

## Tłumaczenia

SIDJUA jest dostępny w 26 językach. Angielski i niemiecki są utrzymywane przez główny zespół. Wszystkie inne tłumaczenia są generowane przez AI i utrzymywane przez społeczność.

**Dokumentacja:** Ten README i [Przewodnik instalacji](docs/INSTALLATION.md) są dostępne we wszystkich 26 językach. Zobacz selektor języka na górze tej strony.

| Region | Języki |
|--------|--------|
| Ameryki | Angielski, Hiszpański, Portugalski (Brazylia) |
| Europa | Niemiecki, Francuski, Włoski, Niderlandzki, Polski, Czeski, Rumuński, Rosyjski, Ukraiński, Szwedzki, Turecki |
| Bliski Wschód | Arabski |
| Azja | Hindi, Bengalski, Filipiński, Indonezyjski, Malajski, Tajski, Wietnamski, Japoński, Koreański, Chiński (uproszczony), Chiński (tradycyjny) |

Znalazłeś błąd tłumaczenia? Otwórz problem GitHub z:
- Językiem i kodem lokalizacji (np. `fil`)
- Niepoprawnym tekstem lub kluczem z pliku lokalizacji (np. `gui.nav.dashboard`)
- Poprawnym tłumaczeniem

Chcesz utrzymywać język? Zobacz [CONTRIBUTING.md](CONTRIBUTING.md#translations) — używamy modelu opiekuna dla każdego języka.

---

## Licencja

**AGPL-3.0** — możesz używać, modyfikować i dystrybuować SIDJUA swobodnie, o ile
udostępniasz modyfikacje na tej samej licencji. Kod źródłowy jest zawsze dostępny
dla użytkowników wdrożenia hostowanego.

Licencja Enterprise dostępna dla organizacji, które wymagają wdrożenia
własnościowego bez zobowiązań AGPL.
[contact@sidjua.com](mailto:contact@sidjua.com)
