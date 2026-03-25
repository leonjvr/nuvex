[English](../../README.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [Français](README.fr.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [中文 (简体)](README.zh-CN.md) | [中文 (繁體)](README.zh-TW.md) | [العربية](README.ar.md) | [বাংলা](README.bn.md) | [Čeština](README.cs.md) | [Filipino](README.fil.md) | [हिन्दी](README.hi.md) | [Bahasa Indonesia](README.id.md) | [Italiano](README.it.md) | [Bahasa Melayu](README.ms.md) | [Nederlands](README.nl.md) | [Polski](README.pl.md) | [Português (BR)](README.pt-BR.md) | [Română](README.ro.md) | [Русский](README.ru.md) | [Svenska](README.sv.md) | [ภาษาไทย](README.th.md) | [Türkçe](README.tr.md) | [Українська](README.uk.md) | [Tiếng Việt](README.vi.md)

---

> *Această pagină a fost tradusă automat din [originalul în engleză](../../README.md). Ați găsit o eroare? [Raportați-o](https://github.com/GoetzKohlberg/sidjua/issues).*

# SIDJUA — Platforma de Guvernanță pentru Agenți AI

> Singura platformă de agenți unde guvernanța este aplicată prin arhitectură, nu prin speranța că modelul se va comporta corect.

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Docker](https://img.shields.io/badge/Docker-sidjua%2Fsidjua-blue)](https://hub.docker.com/r/sidjua/sidjua)
[![Version](https://img.shields.io/badge/version-1.0.0-green)](https://github.com/sidjua-dev/sidjua/releases)

---

## Instalare

### Cerințe preliminare

| Instrument | Necesar | Note |
|------------|---------|------|
| **Node.js** | >= 22.0.0 | Module ES, `fetch()`, `crypto.subtle`. [Descărcați](https://nodejs.org) |
| **Lanț de instrumente C/C++** | Numai pentru compilări din sursă | `better-sqlite3` și `argon2` compilează module native |
| **Docker** | >= 24 (opțional) | Numai pentru implementarea Docker |

Instalare Node.js 22: Ubuntu/Debian (`curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs`), macOS (`brew install node@22`), Windows (`winget install OpenJS.NodeJS.LTS`).

Instalare instrumente C/C++: Ubuntu (`sudo apt-get install -y python3 make g++ build-essential`), macOS (`xcode-select --install`), Windows (`npm install --global windows-build-tools`).

### Opțiunea A — Docker (Recomandat)

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
docker compose up -d
```

```bash
# Vizualizați cheia API generată automat
docker compose exec sidjua cat /app/.system/api-key

# Inițializați guvernanța
docker compose exec sidjua sidjua apply --verbose

# Verificare stare sistem
docker compose exec sidjua sidjua selftest
```

Suportă **linux/amd64** și **linux/arm64** (Raspberry Pi, Apple Silicon).

### Opțiunea B — Instalare globală npm

```bash
npm install -g sidjua
sidjua init          # Configurare interactivă în 3 pași
sidjua chat guide    # Ghid AI fără configurare (fără cheie API)
```

### Opțiunea C — Compilare din sursă

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
npm ci && npm run build
node dist/index.js --help
```

### Note privind platforma

| Funcție | Linux | macOS | Windows (WSL2) | Windows (nativ) |
|---------|-------|-------|----------------|-----------------|
| CLI + REST API | ✅ Complet | ✅ Complet | ✅ Complet | ✅ Complet |
| Docker | ✅ Complet | ✅ Complet (Desktop) | ✅ Complet (Desktop) | ✅ Complet (Desktop) |
| Sandbox (bubblewrap) | ✅ Complet | ❌ Revine la `none` | ✅ Complet (în WSL2) | ❌ Revine la `none` |
| Web Management Console | ✅ Full | ✅ Full | ✅ Full | ✅ Full |

Nu este necesară nicio bază de date externă. SIDJUA utilizează SQLite. Qdrant este opțional (numai pentru căutare semantică).

Consultați [docs/INSTALLATION.md](docs/INSTALLATION.md) pentru ghidul complet cu structura directoarelor, variabile de mediu, depanare per sistem de operare și referință volume Docker.

---

## De ce SIDJUA?

Fiecare framework de agenți AI se bazează astăzi pe aceeași presupunere greșită: că puteți
avea încredere că AI-ul va respecta propriile reguli.

**Problema cu guvernanța bazată pe prompturi:**

Dați unui agent un prompt de sistem care spune „nu accesați niciodată PII-ul clienților". Agentul
citește instrucțiunea. Agentul citește și mesajul utilizatorului care îi cere să extragă istoricul
plăților lui Ion Ionescu. Agentul decide — singur — dacă se conformează. Aceasta nu este
guvernanță. Aceasta este o sugestie fermă.

**SIDJUA este diferit.**

Guvernanța se află **în afara** agentului. Fiecare acțiune trece printr-un pipeline de
aplicare în 5 etape **înainte** de a se executa. Definiți regulile în YAML. Sistemul
le aplică. Agentul nu decide niciodată dacă să le urmeze, deoarece verificarea
are loc înainte ca agentul să acționeze.

Aceasta este guvernanță prin arhitectură — nu prin promptare, nu prin ajustare fină,
nu prin speranță.

---

## Cum funcționează

SIDJUA învelește agenții dvs. într-un strat extern de guvernanță. Apelul LLM al agentului
nu se produce niciodată până când acțiunea propusă nu trece printr-un pipeline de aplicare în 5 etape:

**Etapa 1 — Interzis:** Acțiunile blocate sunt respinse imediat. Niciun apel LLM,
nicio intrare în jurnal marcată „permis", nicio a doua șansă. Dacă acțiunea este pe
lista interzisă, se oprește aici.

**Etapa 2 — Aprobare:** Acțiunile care necesită aprobarea umană sunt reținute pentru
aprobare înainte de execuție. Agentul așteaptă. Omul decide.

**Etapa 3 — Buget:** Fiecare sarcină rulează față de limite de cost în timp real. Bugetele
per sarcină și per agent sunt aplicate. Când limita este atinsă, sarcina este
anulată — nu marcată, nu înregistrată pentru revizuire, *anulată*.

**Etapa 4 — Clasificare:** Datele care traversează granițele diviziei sunt verificate
față de regulile de clasificare. Un agent Tier-2 nu poate accesa date SECRET. Un
agent din Divizia A nu poate citi secretele Diviziei B.

**Etapa 5 — Politică:** Reguli organizaționale personalizate, aplicate structural. Limite
de frecvență pentru apeluri API, limite de tokeni de ieșire, restricții de fereastră temporală.

Întregul pipeline rulează înainte ca orice acțiune să se execute. Nu există un mod „înregistrează și
revizuiește mai târziu" pentru operațiunile critice de guvernanță.

### Fișier de configurare unic

Întreaga organizație de agenți se află într-un singur `divisions.yaml`:

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

`sidjua apply` citește acest fișier și provizionează infrastructura completă a agentului:
agenți, divizii, RBAC, rutare, tabele de audit, căi pentru secrete și reguli de
guvernanță — în 10 pași reproductibili.

### Arhitectura agentului

Agenții sunt organizați în **divizii** (grupuri funcționale) și **niveluri**
(niveluri de încredere). Agenții de Tier 1 au autonomie deplină în cadrul anvelopei lor de guvernanță.
Agenții de Tier 2 necesită aprobare pentru operațiuni sensibile. Agenții de Tier 3
sunt complet supravegheați. Sistemul de niveluri este aplicat structural — un
agent nu se poate auto-promova.

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

## Constrângeri arhitecturale

SIDJUA aplică aceste constrângeri la nivel de arhitectură — nu pot fi
dezactivate, ocolite sau suprascrise de agenți:

1. **Guvernanța este externă**: Stratul de guvernanță învelește agentul. Agentul
   nu are acces la codul de guvernanță, nu poate modifica regulile și nu poate detecta
   dacă guvernanța este prezentă.

2. **Înainte de acțiune, nu după acțiune**: Fiecare acțiune este verificată ÎNAINTE de execuție.
   Nu există un mod „înregistrează și revizuiește mai târziu" pentru operațiunile critice de guvernanță.

3. **Aplicare structurală**: Regulile sunt aplicate prin căi de cod, nu prin
   prompturi sau instrucțiuni ale modelului. Un agent nu poate „evada" din
   guvernanță deoarece guvernanța nu este implementată ca instrucțiuni pentru model.

4. **Imutabilitatea auditului**: Write-Ahead Log (WAL) este doar de adăugare cu
   verificare a integrității. Intrările modificate sunt detectate și excluse.

5. **Izolarea diviziei**: Agenții din divizii diferite nu pot accesa
   datele, secretele sau canalele de comunicare ale celorlalți.

---

## Comparație

| Funcție | SIDJUA | CrewAI | AutoGen | LangGraph | OpenClaw |
|---------|--------|--------|---------|-----------|----------|
| Guvernanță externă | ✅ Arhitectură | ❌ | ❌ | ❌ | ❌ |
| Aplicare înainte de acțiune | ✅ Pipeline în 5 pași | ❌ | ❌ | ❌ | ❌ |
| Conformitate EU AI Act | ✅ | ❌ | ❌ | ❌ | ❌ |
| Auto-găzduit | ✅ | ❌ Cloud | ❌ Cloud | ❌ Cloud | ✅ Plugin |
| Capabil offline | ✅ | ❌ | ❌ | ❌ | ❌ |
| Agnostic față de model | ✅ Orice LLM | Parțial | Parțial | Parțial | ✅ |
| Email bidirecțional | ✅ | ❌ | ❌ | ❌ | ❌ |
| Gateway Discord | ✅ | ❌ | ❌ | ❌ | ❌ |
| Agenți ierarhici | ✅ Divizii + Niveluri | De bază | De bază | Graf | ❌ |
| Aplicare buget | ✅ Limite per agent | ❌ | ❌ | ❌ | ❌ |
| Izolare sandbox | ✅ bubblewrap | ❌ | ❌ | ❌ | ❌ |
| Imutabilitate audit | ✅ WAL + integritate | ❌ | ❌ | ❌ | ❌ |
| Licență | AGPL-3.0 | MIT | MIT | MIT | Mixtă |
| Audituri independente | ✅ 2 externe | ❌ | ❌ | ❌ | ❌ |

---

## Funcționalități

### Guvernanță și conformitate

**Pipeline pre-acțiune (Etapa 0)** rulează înainte de fiecare acțiune a agentului: verificare
interzis → Aprobare umană → Aplicare buget → Clasificare date → Politică
personalizată. Toate cele cinci etape sunt structurale — se execută în cod, nu în
promptul agentului.

**Reguli de bază obligatorii** livrate cu fiecare instalare: 10 reguli de guvernanță
(`SYS-SEC-001` până la `SYS-GOV-002`) care nu pot fi eliminate sau slăbite prin
configurația utilizatorului. Regulile personalizate extind linia de bază; nu o pot suprascrie.

**Conformitate EU AI Act** — traseul de audit, cadrul de clasificare și fluxurile
de aprobare se mapează direct la cerințele Articolelor 9, 12 și 17. Termenul limită
de conformitate din august 2026 este integrat în foaia de parcurs a produsului.

**Raportare conformitate** prin `sidjua audit report/violations/agents/export`:
scor de conformitate, scoruri de încredere per agent, istoric de încălcări, export CSV/JSON
pentru auditori externi sau integrare SIEM.

**Write-Ahead Log (WAL)** cu verificare a integrității: fiecare decizie de guvernanță
este scrisă într-un jurnal de adăugare înaintea execuției. Intrările modificate sunt
detectate la citire. `sidjua memory recover` revalidează și repară.

### Comunicare

Agenții nu doar răspund la apeluri API — participă la canale de comunicare reale.

**Email bidirecțional** (`sidjua email status/test/threads`): agenții primesc
emailuri prin sondare IMAP și răspund prin SMTP. Maparea firelor de discuție prin
antetele In-Reply-To menține coerența conversațiilor. Lista albă a expeditorilor,
limitele de dimensiune a corpului și eliminarea HTML protejează pipeline-ul agentului
de intrări malițioase.

**Bot Gateway Discord**: interfață completă de comenzi slash prin `sidjua module install
discord`. Agenții răspund la mesajele Discord, mențin fire de conversație
și trimit notificări proactive.

**Integrare Telegram**: alerte și notificări ale agentului prin bot Telegram.
Modelul de adaptor multi-canal suportă Telegram, Discord, ntfy și Email
în paralel.

### Operațiuni

**O singură comandă Docker** pentru producție:

```bash
docker run -p 4200:4200 sidjua/sidjua:latest
```

Cheia API este generată automat la prima pornire și tipărită în jurnalele containerului.
Nu sunt necesare variabile de mediu. Nu este necesară nicio configurare. Nu este necesar
niciun server de baze de date — SIDJUA utilizează SQLite, un fișier de bază de date per agent.

**Gestionare CLI** — ciclu de viață complet dintr-un singur binar:

```bash
sidjua init                      # Configurare interactivă a spațiului de lucru (3 pași)
sidjua apply                     # Provizionare din divisions.yaml
sidjua agent create/list/stop    # Ciclul de viață al agentului
sidjua run "task..." --wait      # Trimiteți sarcini cu aplicare de guvernanță
sidjua audit report              # Raport de conformitate
sidjua costs                     # Defalcare costuri pe divizie/agent
sidjua backup create/restore     # Gestionarea copiilor de rezervă semnate HMAC
sidjua update                    # Actualizare versiune cu copie de rezervă automată prealabilă
sidjua rollback                  # Restaurare cu 1 clic la versiunea anterioară
sidjua email status/test         # Gestionarea canalului de email
sidjua secret set/get/rotate     # Gestionarea secretelor criptate
sidjua memory import/search      # Pipeline de cunoștințe semantice
sidjua selftest                  # Verificare stare sistem (7 categorii, scor 0-100)
```

**Memorie semantică** — importați conversații și documente (`sidjua memory import
~/exports/claude-chats.zip`), căutați cu clasificare hibridă vector + BM25. Suportă
embeddings Cloudflare Workers AI (gratuit, fără configurare) și embeddings mari OpenAI
(calitate mai ridicată pentru baze de cunoștințe extinse).

**Fragmentare adaptivă** — pipeline-ul de memorie ajustează automat dimensiunile fragmentelor pentru a rămâne
în limita de tokeni a fiecărui model de embedding.

**Ghid fără configurare** — `sidjua chat guide` lansează un asistent AI interactiv
fără nicio cheie API, alimentat de Cloudflare Workers AI prin proxy-ul SIDJUA.
Întrebați-l cum să configurați agenți, să configurați guvernanța sau să înțelegeți ce s-a întâmplat
în jurnalul de audit.

**Implementare offline** — rulați complet deconectat de internet folosind
LLM-uri locale prin Ollama sau orice endpoint compatibil cu OpenAI. Fără telemetrie implicit.
Raportare opțională a erorilor cu redactare completă PII.

### Securitate

**Izolare sandbox** — abilitățile agentului rulează în interiorul izolației proceselor la nivel de sistem de operare prin
bubblewrap (spații de nume ale utilizatorilor Linux). Zero sarcină suplimentară RAM. Interfață
`SandboxProvider` conectabilă: `none` pentru dezvoltare, `bubblewrap` pentru producție.

**Gestionarea secretelor** — magazin de secrete criptat cu RBAC (`sidjua secret
set/get/list/delete/rotate/namespaces`). Nu este necesar niciun seif extern.

**Construire orientată spre securitate** — suită extinsă de teste interne plus validare
independentă de 2 auditori externi de cod (DeepSeek V3 și xAI Grok). Anteturi
de securitate, protecție CSRF, limitare a ratei și sanitizare a intrărilor pe fiecare suprafață API.
Prevenirea injecției SQL cu interogări parametrizate pretutindeni.

**Integritatea copiei de rezervă** — arhive de copii de rezervă semnate HMAC cu protecție zip-slip,
prevenire bombe zip și verificare sumă de control a manifestului la restaurare.

---

## Import din alte framework-uri

```bash
# Previzualizați ce se importă — fără modificări
sidjua import openclaw --dry-run

# Importați config + fișiere de abilități
sidjua import openclaw --skills
```

Agenții dvs. existenți își păstrează identitatea, modelele și abilitățile. SIDJUA adaugă
guvernanță, trasee de audit și controale bugetare automat.

---

## Referință de configurare

Un `divisions.yaml` minimal pentru a începe:

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

`sidjua apply` provizionează infrastructura completă din acest fișier. Rulați din nou
după modificări — este idempotent.

Consultați [docs/SIDJUA-APPLY-TECH-SPEC-V1.md](docs/SIDJUA-APPLY-TECH-SPEC-V1.md)
pentru specificația completă a celor 10 pași de provizionare.

---

## REST API

SIDJUA REST API rulează pe același port ca și tabloul de bord:

```bash
sidjua server start --port 4200 --api-key $SIDJUA_API_KEY
```

Endpoint-uri cheie:

```
GET  /api/v1/health          # Verificare stare publică (fără autentificare)
GET  /api/v1/info            # Metadate sistem (autentificat)
POST /api/v1/execute/run     # Trimiteți o sarcină
GET  /api/v1/execute/:id/status  # Starea sarcinii
GET  /api/v1/execute/:id/result  # Rezultatul sarcinii
GET  /api/v1/events          # Flux de evenimente SSE
GET  /api/v1/audit/report    # Raport de conformitate
```

Toate endpoint-urile cu excepția `/health` necesită autentificare Bearer. Generați o cheie:

```bash
sidjua api-key generate
```

---

## Docker Compose

```yaml
services:
  sidjua:
    image: sidjua/sidjua:latest
    ports:
      - "4200:4200"
    volumes:
      - sidjua-data:/data
    restart: unless-stopped

volumes:
  sidjua-data:
```

Sau utilizați `docker-compose.yml` inclus care adaugă volume numite pentru configurare,
jurnale și spațiul de lucru al agentului, plus un serviciu Qdrant opțional pentru căutare semantică:

```bash
docker compose up -d
docker compose exec sidjua sidjua init
docker compose exec sidjua sidjua apply
```

---

## Furnizori

SIDJUA se conectează la orice furnizor LLM fără dependență de furnizor:

| Furnizor | Modele | Cheie API |
|----------|--------|-----------|
| Anthropic | Claude Sonnet 4.6, Haiku 4.5, Opus 4.6 | `ANTHROPIC_API_KEY` |
| Google | Gemini 2.0, Gemini 1.5 Pro | `GOOGLE_API_KEY` |
| Groq | Llama 3.x, Mixtral | `GROQ_API_KEY` (nivel gratuit) |
| Cloudflare Workers AI | Llama, Mistral, Phi | `CF_ACCOUNT_ID` + `CF_TOKEN` |
| Ollama | Orice model local | Fără cheie (local) |
| Compatibil OpenAI | Orice endpoint | URL personalizat + cheie |

```bash
# Adăugați o cheie de furnizor
sidjua key set groq gsk_...

# Listați furnizorii și modelele disponibile
sidjua provider list
```

---

## Foaie de parcurs

Foaie de parcurs completă la [sidjua.com/roadmap](https://sidjua.com/roadmap).

Pe termen scurt:
- Modele de orchestrare multi-agent (V1.1)
- Declanșatoare inbound webhook (V1.1)
- Comunicare agent-la-agent (V1.2)
- Integrare Enterprise SSO (V1.x)
- Serviciu de validare a guvernanței găzduit în cloud (V1.x)

---

## Comunitate

- **Discord**: [sidjua.com/discord](https://sidjua.com/discord)
- **GitHub Issues**: [github.com/sidjua-dev/sidjua/issues](https://github.com/sidjua-dev/sidjua/issues)
- **Email**: contact@sidjua.com
- **Documentație**: [sidjua.com/docs](https://sidjua.com/docs)

Dacă găsiți o eroare, deschideți un issue — acționăm rapid.

---

## Traduceri

SIDJUA este disponibil în 26 de limbi. Engleza și germana sunt menținute de echipa de bază. Toate celelalte traduceri sunt generate de AI și menținute de comunitate.

**Documentație:** Acest README și [Ghidul de instalare](docs/INSTALLATION.md) sunt disponibile în toate cele 26 de limbi. Consultați selectorul de limbă din partea de sus a acestei pagini.

| Regiune | Limbi |
|---------|-------|
| Americi | Engleză, Spaniolă, Portugheză (Brazilia) |
| Europa | Germană, Franceză, Italiană, Olandeză, Poloneză, Cehă, Română, Rusă, Ucraineană, Suedeză, Turcă |
| Orientul Mijlociu | Arabă |
| Asia | Hindi, Bengali, Filipineză, Indoneziană, Malaeziană, Thailandeză, Vietnameză, Japoneză, Coreeană, Chineză (simplificată), Chineză (tradițională) |

Ați găsit o eroare de traducere? Deschideți un GitHub Issue cu:
- Limba și codul de localitate (ex. `fil`)
- Textul incorect sau cheia din fișierul de localitate (ex. `gui.nav.dashboard`)
- Traducerea corectă

Doriți să mențineți o limbă? Consultați [CONTRIBUTING.md](CONTRIBUTING.md#translations) — folosim un model de menținător per limbă.

---

## Licență

**AGPL-3.0** — puteți utiliza, modifica și distribui SIDJUA liber atâta timp cât
partajați modificările sub aceeași licență. Codul sursă este întotdeauna disponibil
pentru utilizatorii unei implementări găzduite.

Licența Enterprise disponibilă pentru organizațiile care necesită implementare
proprietară fără obligații AGPL.
[contact@sidjua.com](mailto:contact@sidjua.com)
