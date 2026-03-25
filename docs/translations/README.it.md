[English](../../README.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [Français](README.fr.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [中文 (简体)](README.zh-CN.md) | [中文 (繁體)](README.zh-TW.md) | [العربية](README.ar.md) | [বাংলা](README.bn.md) | [Čeština](README.cs.md) | [Filipino](README.fil.md) | [हिन्दी](README.hi.md) | [Bahasa Indonesia](README.id.md) | [Italiano](README.it.md) | [Bahasa Melayu](README.ms.md) | [Nederlands](README.nl.md) | [Polski](README.pl.md) | [Português (BR)](README.pt-BR.md) | [Română](README.ro.md) | [Русский](README.ru.md) | [Svenska](README.sv.md) | [ภาษาไทย](README.th.md) | [Türkçe](README.tr.md) | [Українська](README.uk.md) | [Tiếng Việt](README.vi.md)

> *Questa pagina è stata tradotta automaticamente dall'[originale inglese](../../README.md). Hai trovato un errore? [Segnalalo](https://github.com/GoetzKohlberg/sidjua/issues).*

---

# SIDJUA — La Piattaforma di Governance per Agenti IA

> L'unica piattaforma di agenti dove la governance è imposta dall'architettura, non dalla speranza che il modello si comporti correttamente.

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Docker](https://img.shields.io/badge/Docker-sidjua%2Fsidjua-blue)](https://hub.docker.com/r/sidjua/sidjua)
[![Version](https://img.shields.io/badge/version-1.0.0-green)](https://github.com/sidjua-dev/sidjua/releases)

---

## Installazione

### Prerequisiti

| Strumento | Richiesto | Note |
|-----------|-----------|------|
| **Node.js** | >= 22.0.0 | Moduli ES, `fetch()`, `crypto.subtle`. [Scarica](https://nodejs.org) |
| **Toolchain C/C++** | Solo per compilazioni da sorgente | `better-sqlite3` e `argon2` compilano moduli nativi |
| **Docker** | >= 24 (opzionale) | Solo per il deployment Docker |

Installare Node.js 22: Ubuntu/Debian (`curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs`), macOS (`brew install node@22`), Windows (`winget install OpenJS.NodeJS.LTS`).

Installare gli strumenti C/C++: Ubuntu (`sudo apt-get install -y python3 make g++ build-essential`), macOS (`xcode-select --install`), Windows (`npm install --global windows-build-tools`).

### Opzione A — Docker (Consigliato)

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
docker compose up -d
```

```bash
# Visualizza la chiave API generata automaticamente
docker compose exec sidjua cat /app/.system/api-key

# Inizializza la governance
docker compose exec sidjua sidjua apply --verbose

# Controllo dello stato del sistema
docker compose exec sidjua sidjua selftest
```

Supporta **linux/amd64** e **linux/arm64** (Raspberry Pi, Apple Silicon).

### Opzione B — Installazione globale npm

```bash
npm install -g sidjua
sidjua init          # Configurazione interattiva in 3 passi
sidjua chat guide    # Guida IA senza configurazione (nessuna chiave API richiesta)
```

### Opzione C — Compilazione da sorgente

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
npm ci && npm run build
node dist/index.js --help
```

### Note per piattaforma

| Funzionalità | Linux | macOS | Windows (WSL2) | Windows (nativo) |
|--------------|-------|-------|----------------|------------------|
| CLI + REST API | ✅ Completo | ✅ Completo | ✅ Completo | ✅ Completo |
| Docker | ✅ Completo | ✅ Completo (Desktop) | ✅ Completo (Desktop) | ✅ Completo (Desktop) |
| Sandboxing (bubblewrap) | ✅ Completo | ❌ Ritorna a `none` | ✅ Completo (dentro WSL2) | ❌ Ritorna a `none` |
| Web Management Console | ✅ Full | ✅ Full | ✅ Full | ✅ Full |

Nessun database esterno richiesto. SIDJUA usa SQLite. Qdrant è opzionale (solo per la ricerca semantica).

Consulta [docs/INSTALLATION.md](docs/INSTALLATION.md) per la guida completa con struttura delle directory, variabili d'ambiente, risoluzione dei problemi per sistema operativo e riferimento ai volumi Docker.

---

## Perché SIDJUA?

Ogni framework di agenti IA oggi si basa sulla stessa ipotesi difettosa: che si
possa fidarsi dell'IA per seguire le proprie regole.

**Il problema con la governance basata sui prompt:**

Dai a un agente un prompt di sistema che dice "non accedere mai ai PII dei clienti." L'
agente legge l'istruzione. L'agente legge anche il messaggio dell'utente che gli chiede di
recuperare la cronologia dei pagamenti di Mario Rossi. L'agente decide — autonomamente — se
obbedire. Non è governance. È un suggerimento formulato con fermezza.

**SIDJUA è diverso.**

La governance si trova **all'esterno** dell'agente. Ogni azione passa attraverso un
pipeline di applicazione preventiva in 5 fasi **prima** di essere eseguita. Definisci le regole in
YAML. Il sistema le applica. L'agente non può mai decidere se seguirle, perché
il controllo avviene prima che l'agente agisca.

Questa è governance tramite architettura — non tramite prompting, non tramite fine-tuning,
non tramite la speranza.

---

## Come funziona

SIDJUA avvolge i tuoi agenti in uno strato di governance esterno. La chiamata LLM
dell'agente non avviene mai fino a quando l'azione proposta non supera un pipeline di
applicazione a 5 stadi:

**Stadio 1 — Vietato:** Le azioni bloccate vengono rifiutate immediatamente. Nessuna chiamata LLM,
nessuna voce di registro contrassegnata come "consentita", nessuna seconda possibilità. Se l'azione è nella
lista dei vietati, si ferma qui.

**Stadio 2 — Approvazione:** Le azioni che richiedono la firma umana vengono trattenute per
approvazione prima dell'esecuzione. L'agente aspetta. L'umano decide.

**Stadio 3 — Budget:** Ogni attività viene eseguita contro limiti di costo in tempo reale. I
budget per attività e per agente vengono applicati. Quando viene raggiunto il limite, l'attività è
annullata — non contrassegnata, non registrata per revisione, *annullata*.

**Stadio 4 — Classificazione:** I dati che attraversano i confini della divisione vengono verificati
rispetto alle regole di classificazione. Un agente di Tier 2 non può accedere ai dati SECRET. Un
agente nella Divisione A non può leggere i segreti della Divisione B.

**Stadio 5 — Politica:** Regole organizzative personalizzate, applicate strutturalmente. Limiti di
frequenza delle chiamate API, limiti di token di output, restrizioni della finestra temporale.

L'intero pipeline viene eseguito prima di qualsiasi azione. Non esiste una modalità "registra e
rivedi in seguito" per le operazioni critiche di governance.

### File di configurazione singolo

L'intera organizzazione degli agenti risiede in un unico `divisions.yaml`:

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

`sidjua apply` legge questo file e predispone l'infrastruttura completa degli agenti:
agenti, divisioni, RBAC, routing, tabelle di audit, percorsi dei segreti e regole di
governance — in 10 passaggi riproducibili.

### Architettura degli agenti

Gli agenti sono organizzati in **divisioni** (gruppi funzionali) e **tier**
(livelli di fiducia). Gli agenti di Tier 1 hanno piena autonomia all'interno del loro
perimetro di governance. Gli agenti di Tier 2 richiedono l'approvazione per le operazioni sensibili. Gli
agenti di Tier 3 sono completamente supervisionati. Il sistema di tier è applicato strutturalmente —
un agente non può auto-promuoversi.

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

## Vincoli architetturali

SIDJUA applica questi vincoli a livello architetturale — non possono essere
disattivati, aggirati o annullati dagli agenti:

1. **La governance è esterna**: Lo strato di governance avvolge l'agente. L'agente
   non ha accesso al codice di governance, non può modificare le regole e non può rilevare
   se la governance è presente.

2. **Pre-azione, non post-azione**: Ogni azione viene verificata PRIMA dell'esecuzione.
   Non esiste una modalità "registra e rivedi in seguito" per le operazioni critiche di governance.

3. **Applicazione strutturale**: Le regole vengono applicate tramite percorsi di codice, non tramite
   prompt o istruzioni del modello. Un agente non può fare "jailbreak" della
   governance perché essa non è implementata come istruzioni al modello.

4. **Immutabilità dell'audit**: Il Write-Ahead Log (WAL) è di sola aggiunta con
   verifica dell'integrità. Le voci manomesse vengono rilevate ed escluse.

5. **Isolamento delle divisioni**: Gli agenti in divisioni diverse non possono accedere
   ai dati, ai segreti o ai canali di comunicazione degli altri.

---

## Confronto

| Funzionalità | SIDJUA | CrewAI | AutoGen | LangGraph | OpenClaw |
|--------------|--------|--------|---------|-----------|----------|
| Governance esterna | ✅ Architettura | ❌ | ❌ | ❌ | ❌ |
| Applicazione pre-azione | ✅ Pipeline a 5 fasi | ❌ | ❌ | ❌ | ❌ |
| Pronto per EU AI Act | ✅ | ❌ | ❌ | ❌ | ❌ |
| Auto-ospitato | ✅ | ❌ Cloud | ❌ Cloud | ❌ Cloud | ✅ Plugin |
| Capacità air-gap | ✅ | ❌ | ❌ | ❌ | ❌ |
| Agnostico al modello | ✅ Qualsiasi LLM | Parziale | Parziale | Parziale | ✅ |
| Email bidirezionale | ✅ | ❌ | ❌ | ❌ | ❌ |
| Gateway Discord | ✅ | ❌ | ❌ | ❌ | ❌ |
| Agenti gerarchici | ✅ Divisioni + Tier | Base | Base | Grafo | ❌ |
| Applicazione del budget | ✅ Limiti per agente | ❌ | ❌ | ❌ | ❌ |
| Isolamento sandbox | ✅ bubblewrap | ❌ | ❌ | ❌ | ❌ |
| Immutabilità dell'audit | ✅ WAL + integrità | ❌ | ❌ | ❌ | ❌ |
| Licenza | AGPL-3.0 | MIT | MIT | MIT | Mista |
| Audit indipendenti | ✅ 2 Esterni | ❌ | ❌ | ❌ | ❌ |

---

## Funzionalità

### Governance e Conformità

**Pipeline pre-azione (Stadio 0)** viene eseguito prima di ogni azione dell'agente: Verifica di
divieto → Approvazione umana → Applicazione del budget → Classificazione dei dati → Politica
personalizzata. Tutti e cinque gli stadi sono strutturali — vengono eseguiti nel codice, non nel
prompt dell'agente.

**Regole di base obbligatorie** incluse in ogni installazione: 10 regole di governance
(`SYS-SEC-001` fino a `SYS-GOV-002`) che non possono essere rimosse né indebolite dalla
configurazione utente. Le regole personalizzate estendono la base; non possono sovrascriverla.

**Conformità EU AI Act** — il registro di audit, il framework di classificazione e i flussi
di lavoro di approvazione corrispondono direttamente ai requisiti degli Articoli 9, 12 e 17. La
scadenza di conformità di agosto 2026 è integrata nella roadmap del prodotto.

**Report di conformità** tramite `sidjua audit report/violations/agents/export`:
punteggio di conformità, punteggi di fiducia per agente, cronologia delle violazioni, esportazione CSV/JSON
per revisori esterni o integrazione SIEM.

**Write-Ahead Log (WAL)** con verifica dell'integrità: ogni decisione di governance viene
scritta in un registro di sola aggiunta prima dell'esecuzione. Le voci manomesse vengono rilevate
alla lettura. `sidjua memory recover` ri-valida e ripara.

### Comunicazione

Gli agenti non si limitano a rispondere alle chiamate API — partecipano a veri canali di comunicazione.

**Email bidirezionale** (`sidjua email status/test/threads`): gli agenti ricevono
email tramite sondaggio IMAP e rispondono via SMTP. Il mapping dei thread tramite intestazioni
In-Reply-To mantiene la coerenza delle conversazioni. La lista bianca dei mittenti, i limiti di
dimensione del corpo e la rimozione dell'HTML proteggono il pipeline dell'agente da input malevoli.

**Bot Gateway Discord**: interfaccia completa di comandi slash tramite `sidjua module install
discord`. Gli agenti rispondono ai messaggi Discord, mantengono thread di conversazione
e inviano notifiche proattive.

**Integrazione Telegram**: avvisi e notifiche dell'agente tramite bot Telegram.
Il modello di adattatore multicanale supporta Telegram, Discord, ntfy ed Email in
parallelo.

### Operazioni

**Un singolo comando Docker** per la produzione:

```bash
docker run -p 4200:4200 sidjua/sidjua:latest
```

La chiave API viene generata automaticamente al primo avvio e stampata nei log del
container. Nessuna variabile d'ambiente richiesta. Nessuna configurazione richiesta. Nessun
server di database richiesto — SIDJUA usa SQLite, un file di database per agente.

**Gestione CLI** — ciclo di vita completo da un singolo binario:

```bash
sidjua init                      # Configurazione interattiva dello spazio di lavoro (3 passi)
sidjua apply                     # Predisposizione da divisions.yaml
sidjua agent create/list/stop    # Ciclo di vita dell'agente
sidjua run "task..." --wait      # Invia attività con applicazione della governance
sidjua audit report              # Report di conformità
sidjua costs                     # Ripartizione dei costi per divisione/agente
sidjua backup create/restore     # Gestione backup firmati HMAC
sidjua update                    # Aggiornamento versione con backup preventivo automatico
sidjua rollback                  # Ripristino con 1 clic alla versione precedente
sidjua email status/test         # Gestione del canale email
sidjua secret set/get/rotate     # Gestione segreti cifrati
sidjua memory import/search      # Pipeline di conoscenza semantica
sidjua selftest                  # Verifica dello stato del sistema (7 categorie, punteggio 0-100)
```

**Memoria semantica** — importa conversazioni e documenti (`sidjua memory import
~/exports/claude-chats.zip`), cerca con ranking ibrido vettoriale + BM25. Supporta
gli embedding di Cloudflare Workers AI (gratuito, senza configurazione) e i grandi embedding di OpenAI
(qualità superiore per grandi basi di conoscenza).

**Chunking adattivo** — il pipeline di memoria regola automaticamente le dimensioni dei frammenti
per rimanere entro il limite di token di ogni modello di embedding.

**Guida senza configurazione** — `sidjua chat guide` avvia un assistente IA interattivo
senza alcuna chiave API, alimentato da Cloudflare Workers AI attraverso il proxy SIDJUA.
Chiedigli come configurare agenti, impostare la governance o capire cosa è successo
nel registro di audit.

**Deployment air-gap** — funziona completamente disconnesso da Internet usando LLM locali
tramite Ollama o qualsiasi endpoint compatibile con OpenAI. Nessuna telemetria per impostazione predefinita.
Report degli errori opt-in con redazione completa dei PII.

### Sicurezza

**Isolamento sandbox** — le competenze degli agenti vengono eseguite nell'isolamento del processo a livello
di sistema operativo tramite bubblewrap (namespace utente Linux). Nessun overhead RAM aggiuntivo.
Interfaccia `SandboxProvider` collegabile: `none` per lo sviluppo, `bubblewrap` per la produzione.

**Gestione dei segreti** — archivio segreti cifrato con RBAC (`sidjua secret
set/get/list/delete/rotate/namespaces`). Nessun vault esterno richiesto.

**Build orientato alla sicurezza** — ampia suite di test interna più validazione indipendente
da parte di 2 revisori di codice esterni (DeepSeek V3 e xAI Grok). Intestazioni di
sicurezza, protezione CSRF, limitazione della frequenza e sanificazione dell'input su ogni superficie API.
Prevenzione dell'iniezione SQL con query parametrizzate ovunque.

**Integrità del backup** — archivi di backup firmati HMAC con protezione zip-slip,
prevenzione delle zip bomb e verifica del checksum del manifesto al ripristino.

---

## Importa da altri framework

```bash
# Anteprima di cosa viene importato — nessuna modifica effettuata
sidjua import openclaw --dry-run

# Importa configurazione + file delle competenze
sidjua import openclaw --skills
```

I tuoi agenti esistenti mantengono la loro identità, i modelli e le competenze. SIDJUA aggiunge
automaticamente governance, tracce di audit e controlli del budget.

---

## Riferimento alla configurazione

Un `divisions.yaml` minimale per iniziare:

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

`sidjua apply` predispone l'infrastruttura completa da questo file. Eseguilo
di nuovo dopo le modifiche — è idempotente.

Consulta [docs/SIDJUA-APPLY-TECH-SPEC-V1.md](docs/SIDJUA-APPLY-TECH-SPEC-V1.md)
per la specifica completa di tutti e 10 i passi di predisposizione.

---

## REST API

La REST API di SIDJUA viene eseguita sulla stessa porta del pannello di controllo:

```bash
sidjua server start --port 4200 --api-key $SIDJUA_API_KEY
```

Endpoint chiave:

```
GET  /api/v1/health          # Controllo di salute pubblico (senza auth)
GET  /api/v1/info            # Metadati del sistema (autenticato)
POST /api/v1/execute/run     # Invia un'attività
GET  /api/v1/execute/:id/status  # Stato dell'attività
GET  /api/v1/execute/:id/result  # Risultato dell'attività
GET  /api/v1/events          # Flusso di eventi SSE
GET  /api/v1/audit/report    # Report di conformità
```

Tutti gli endpoint tranne `/health` richiedono l'autenticazione Bearer. Genera una chiave:

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

Oppure usa il `docker-compose.yml` incluso che aggiunge volumi nominati per configurazione,
log e spazio di lavoro degli agenti, più un servizio Qdrant opzionale per la ricerca semantica:

```bash
docker compose up -d
docker compose exec sidjua sidjua init
docker compose exec sidjua sidjua apply
```

---

## Provider

SIDJUA si connette a qualsiasi provider LLM senza dipendenza:

| Provider | Modelli | Chiave API |
|----------|---------|------------|
| Anthropic | Claude Sonnet 4.6, Haiku 4.5, Opus 4.6 | `ANTHROPIC_API_KEY` |
| Google | Gemini 2.0, Gemini 1.5 Pro | `GOOGLE_API_KEY` |
| Groq | Llama 3.x, Mixtral | `GROQ_API_KEY` (livello gratuito) |
| Cloudflare Workers AI | Llama, Mistral, Phi | `CF_ACCOUNT_ID` + `CF_TOKEN` |
| Ollama | Qualsiasi modello locale | Nessuna chiave (locale) |
| Compatibile con OpenAI | Qualsiasi endpoint | URL personalizzato + chiave |

```bash
# Aggiungere una chiave provider
sidjua key set groq gsk_...

# Elencare i provider e i modelli disponibili
sidjua provider list
```

---

## Roadmap

Roadmap completa su [sidjua.com/roadmap](https://sidjua.com/roadmap).

A breve termine:
- Modelli di orchestrazione multi-agente (V1.1)
- Trigger in entrata tramite webhook (V1.1)
- Comunicazione agente-agente (V1.2)
- Integrazione SSO enterprise (V1.x)
- Servizio di validazione della governance ospitato nel cloud (V1.x)

---

## Comunità

- **Discord**: [sidjua.com/discord](https://sidjua.com/discord)
- **GitHub Issues**: [github.com/sidjua-dev/sidjua/issues](https://github.com/sidjua-dev/sidjua/issues)
- **Email**: contact@sidjua.com
- **Documentazione**: [sidjua.com/docs](https://sidjua.com/docs)

Se trovi un bug, apri un issue — agiamo rapidamente.

---

## Traduzioni

SIDJUA è disponibile in 26 lingue. L'inglese e il tedesco sono mantenuti dal team principale. Tutte le altre traduzioni sono generate dall'IA e mantenute dalla comunità.

**Documentazione:** Questo README e la [Guida all'installazione](docs/INSTALLATION.md) sono disponibili in tutte le 26 lingue. Consulta il selettore di lingua in cima a questa pagina.

| Regione | Lingue |
|---------|--------|
| Americhe | Inglese, Spagnolo, Portoghese (Brasile) |
| Europa | Tedesco, Francese, Italiano, Olandese, Polacco, Ceco, Rumeno, Russo, Ucraino, Svedese, Turco |
| Medio Oriente | Arabo |
| Asia | Hindi, Bengalese, Filipino, Indonesiano, Malese, Tailandese, Vietnamita, Giapponese, Coreano, Cinese (Semplificato), Cinese (Tradizionale) |

Hai trovato un errore di traduzione? Per favore apri un Issue GitHub con:
- Lingua e codice locale (es. `it`)
- Il testo errato o la chiave dal file locale (es. `gui.nav.dashboard`)
- La traduzione corretta

Vuoi mantenere una lingua? Consulta [CONTRIBUTING.md](CONTRIBUTING.md#translations) — usiamo un modello di manutentore per lingua.

---

## Licenza

**AGPL-3.0** — puoi usare, modificare e distribuire SIDJUA liberamente a condizione che
tu condivida le modifiche sotto la stessa licenza. Il codice sorgente è sempre disponibile
per gli utenti di un deployment ospitato.

Licenza enterprise disponibile per le organizzazioni che richiedono un deployment
proprietario senza obblighi AGPL.
[contact@sidjua.com](mailto:contact@sidjua.com)
