[English](../../README.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [Français](README.fr.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [中文 (简体)](README.zh-CN.md) | [中文 (繁體)](README.zh-TW.md) | [العربية](README.ar.md) | [বাংলা](README.bn.md) | [Čeština](README.cs.md) | [Filipino](README.fil.md) | [हिन्दी](README.hi.md) | [Bahasa Indonesia](README.id.md) | [Italiano](README.it.md) | [Bahasa Melayu](README.ms.md) | [Nederlands](README.nl.md) | [Polski](README.pl.md) | [Português (BR)](README.pt-BR.md) | [Română](README.ro.md) | [Русский](README.ru.md) | [Svenska](README.sv.md) | [ภาษาไทย](README.th.md) | [Türkçe](README.tr.md) | [Українська](README.uk.md) | [Tiếng Việt](README.vi.md)

> *Ang pahinang ito ay awtomatikong isinalin mula sa [orihinal na Ingles](../../README.md). Nakahanap ng error? [I-ulat ito](https://github.com/GoetzKohlberg/sidjua/issues).*

---

# SIDJUA — Ang Plataporma ng Pamamahala ng AI Agent

> Ang tanging plataporma ng agent kung saan ang pamamahala ay ipinapatupad ng arkitektura, hindi ng pag-asa na maayos na kikilos ang modelo.

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Docker](https://img.shields.io/badge/Docker-ghcr.io%2Fgoetzkohlberg%2Fsidjua-blue)](https://ghcr.io/goetzkohlberg/sidjua)
[![Version](https://img.shields.io/badge/version-1.0.0-green)](https://github.com/GoetzKohlberg/sidjua/releases)

---

## Pag-install

### Mga Kinakailangan

| Tool | Kinakailangan | Mga Tala |
|------|--------------|----------|
| **Node.js** | >= 22.0.0 | Mga ES module, `fetch()`, `crypto.subtle`. [I-download](https://nodejs.org) |
| **C/C++ Toolchain** | Para sa source build lamang | Nag-compile ng native addons ang `better-sqlite3` at `argon2` |
| **Docker** | >= 24 (opsyonal) | Para sa Docker deployment lamang |

Mag-install ng Node.js 22: Ubuntu/Debian (`curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs`), macOS (`brew install node@22`), Windows (`winget install OpenJS.NodeJS.LTS`).

Mag-install ng mga C/C++ tool: Ubuntu (`sudo apt-get install -y python3 make g++ build-essential`), macOS (`xcode-select --install`), Windows (`npm install --global windows-build-tools`).

### Pagpipilian A — Docker (Inirerekomenda)

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
docker compose up -d
```

```bash
# Tingnan ang awtomatikong nabuong API key
docker compose exec sidjua cat /app/.system/api-key

# I-bootstrap ang pamamahala
docker compose exec sidjua sidjua apply --verbose

# Suriin ang kalusugan ng sistema
docker compose exec sidjua sidjua selftest
```

Sumusuporta sa **linux/amd64** at **linux/arm64** (Raspberry Pi, Apple Silicon).

### Pagpipilian B — npm Global na Pag-install

```bash
npm install -g sidjua
sidjua init          # Interactive na 3-hakbang na setup
sidjua chat guide    # Zero-config na AI guide (hindi kailangan ng API key)
```

### Pagpipilian C — Source Build

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
npm ci && npm run build
node dist/index.js --help
```

### Mga Tala sa Plataporma

| Feature | Linux | macOS | Windows (WSL2) | Windows (native) |
|---------|-------|-------|----------------|------------------|
| CLI + REST API | ✅ Buo | ✅ Buo | ✅ Buo | ✅ Buo |
| Docker | ✅ Buo | ✅ Buo (Desktop) | ✅ Buo (Desktop) | ✅ Buo (Desktop) |
| Sandboxing (bubblewrap) | ✅ Buo | ❌ Bumabalik sa `none` | ✅ Buo (sa loob ng WSL2) | ❌ Bumabalik sa `none` |
| Web Management Console | ✅ Full | ✅ Full | ✅ Full | ✅ Full |

Hindi kailangan ng panlabas na database. Gumagamit ang SIDJUA ng SQLite. Ang Qdrant ay opsyonal (para sa semantic search lamang).

Tingnan ang [docs/INSTALLATION.md](docs/INSTALLATION.md) para sa kumpletong gabay na may layout ng direktoryo, mga environment variable, paglutas ng problema sa bawat OS, at Docker volume reference.

---

## Bakit SIDJUA?

Ang bawat framework ng AI agent ngayon ay umaasa sa parehong sirang pagpapalagay: na
maaari kang magtiwala sa AI na susundin ang sarili nitong mga panuntunan.

**Ang problema sa pamamahala batay sa prompt:**

Binibigyan mo ang isang agent ng system prompt na nagsasabing "huwag kailanman i-access ang PII ng customer."
Binabasa ng agent ang tagubilin. Binabasa rin ng agent ang mensahe ng gumagamit na
humihiling sa kanya na kunin ang kasaysayan ng bayad ni John Smith. Nagpapasya ang agent
— sa sarili nitong desisyon — kung susundin ito. Hindi iyon pamamahala. Iyon ay isang matibay na mungkahi.

**Naiiba ang SIDJUA.**

Ang pamamahala ay nasa **labas** ng agent. Ang bawat aksyon ay dumadaan sa isang 5-hakbang
na pipeline ng pagpapatupad **bago** ito isagawa. Tinutukoy mo ang mga panuntunan sa YAML.
Ipinapatupad ng sistema ang mga ito. Hindi kailanman makakagawa ng desisyon ang agent
kung susundin ang mga ito, dahil ang pagsusuri ay nangyayari bago kumilos ang agent.

Ito ang pamamahala sa pamamagitan ng arkitektura — hindi sa pamamagitan ng pag-prompt,
hindi sa pamamagitan ng fine-tuning, hindi sa pamamagitan ng pag-asa.

---

## Paano Ito Gumagana

Binibigyan ng SIDJUA ang iyong mga agent ng panlabas na layer ng pamamahala. Ang LLM
call ng agent ay hindi kailanman mangyayari hanggang ang iminungkahing aksyon ay makalusot
sa isang 5-yugto na pipeline ng pagpapatupad:

**Yugto 1 — Ipinagbabawal:** Ang mga naharang na aksyon ay agad na tinatanggihan. Walang LLM
call, walang log entry na minarkahan bilang "pinahintulutan", walang pangalawang pagkakataon.
Kung ang aksyon ay nasa listahan ng ipinagbabawal, dito ito titigil.

**Yugto 2 — Pag-apruba:** Ang mga aksyon na nangangailangan ng human sign-off ay pinapanatili
para sa pag-apruba bago isagawa. Naghihintay ang agent. Nagpapasya ang tao.

**Yugto 3 — Badyet:** Ang bawat gawain ay tumatakbo laban sa mga real-time na limitasyon ng gastos.
Ang mga badyet bawat-gawain at bawat-agent ay ipinapatupad. Kapag naabot ang limitasyon, ang
gawain ay kinakansela — hindi minarkahan, hindi naka-log para sa pagsusuri, *kinakansela*.

**Yugto 4 — Klasipikasyon:** Ang data na tumatawid sa mga hangganan ng dibisyon ay sinusuri
laban sa mga patakaran ng klasipikasyon. Ang isang Tier-2 agent ay hindi maaaring ma-access
ang SECRET data. Ang agent sa Dibisyon A ay hindi maaaring basahin ang mga lihim ng Dibisyon B.

**Yugto 5 — Patakaran:** Mga pasadyang panuntunan ng organisasyon, ipinapatupad nang
struktural. Mga limitasyon ng dalas ng API call, mga limitasyon ng output token, mga
paghihigpit sa time-window.

Ang buong pipeline ay tumatakbo bago isagawa ang anumang aksyon. Walang mode na "mag-log
at susuriin mamaya" para sa mga operasyong kritikal sa pamamahala.

### Iisang Configuration File

Ang buong organisasyon ng iyong agent ay nasa isang `divisions.yaml`:

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

Binabasa ng `sidjua apply` ang file na ito at nagbibigay ng kumpletong imprastraktura ng agent:
mga agent, dibisyon, RBAC, routing, mga audit table, mga landas ng lihim, at mga patakaran
ng pamamahala — sa 10 reproducible na hakbang.

### Arkitektura ng Agent

Ang mga agent ay inayos sa **mga dibisyon** (mga functional na grupo) at **mga tier**
(mga antas ng tiwala). Ang mga Tier 1 agent ay may buong awtonomiya sa loob ng kanilang
governance envelope. Ang mga Tier 2 agent ay nangangailangan ng pag-apruba para sa mga
sensitibong operasyon. Ang mga Tier 3 agent ay ganap na nasa ilalim ng pangangasiwa.
Ang sistema ng tier ay ipinapatupad nang struktural — hindi maaaring mag-promote ng
sarili ang isang agent.

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

## Mga Hadlang sa Arkitektura

Ipinapatupad ng SIDJUA ang mga hadlang na ito sa antas ng arkitektura — hindi sila
maaaring i-disable, i-bypass, o i-override ng mga agent:

1. **Ang pamamahala ay panlabas**: Ang layer ng pamamahala ay bumibigyan ng wrapper ang agent.
   Walang access ang agent sa code ng pamamahala, hindi nito maaaring baguhin ang mga
   panuntunan, at hindi nito matukoy kung naroroon ang pamamahala.

2. **Bago ang aksyon, hindi pagkatapos**: Ang bawat aksyon ay sinusuri BAGO isagawa.
   Walang mode na "mag-log at susuriin mamaya" para sa mga operasyong kritikal sa pamamahala.

3. **Struktural na pagpapatupad**: Ang mga panuntunan ay ipinapatupad ng mga code path,
   hindi ng mga prompt o tagubilin ng modelo. Hindi maaaring "jailbreak" ng isang agent
   mula sa pamamahala dahil ang pamamahala ay hindi ipinapatupad bilang mga tagubilin sa modelo.

4. **Immutability ng audit**: Ang Write-Ahead Log (WAL) ay append-only na may
   integrity verification. Ang mga tampered na entry ay natukoy at ibinubukod.

5. **Paghihiwalay ng dibisyon**: Ang mga agent sa iba't ibang dibisyon ay hindi maaaring
   ma-access ang data, mga lihim, o mga channel ng komunikasyon ng isa't isa.

---

## Paghahambing

| Feature | SIDJUA | CrewAI | AutoGen | LangGraph | OpenClaw |
|---------|--------|--------|---------|-----------|----------|
| Panlabas na Pamamahala | ✅ Arkitektura | ❌ | ❌ | ❌ | ❌ |
| Pre-Action na Pagpapatupad | ✅ 5-Hakbang na Pipeline | ❌ | ❌ | ❌ | ❌ |
| Handa para sa EU AI Act | ✅ | ❌ | ❌ | ❌ | ❌ |
| Self-Hosted | ✅ | ❌ Cloud | ❌ Cloud | ❌ Cloud | ✅ Plugin |
| Kayang Gawin nang Air-Gap | ✅ | ❌ | ❌ | ❌ | ❌ |
| Model Agnostic | ✅ Anumang LLM | Bahagya | Bahagya | Bahagya | ✅ |
| Bidirectional na Email | ✅ | ❌ | ❌ | ❌ | ❌ |
| Discord Gateway | ✅ | ❌ | ❌ | ❌ | ❌ |
| Mga Hierarchical na Agent | ✅ Mga Dibisyon + Tier | Pangunahin | Pangunahin | Graph | ❌ |
| Pagpapatupad ng Badyet | ✅ Mga Limitasyon bawat Agent | ❌ | ❌ | ❌ | ❌ |
| Sandbox Isolation | ✅ bubblewrap | ❌ | ❌ | ❌ | ❌ |
| Immutability ng Audit | ✅ WAL + integridad | ❌ | ❌ | ❌ | ❌ |
| Lisensya | AGPL-3.0 | MIT | MIT | MIT | Halo-halo |
| Mga Independiyenteng Audit | ✅ 2 Panlabas | ❌ | ❌ | ❌ | ❌ |

---

## Mga Feature

### Pamamahala at Pagsunod

**Pre-Action Pipeline (Stage 0)** ay tumatakbo bago ang bawat aksyon ng agent: Pagsusuri
ng Ipinagbabawal → Human na Pag-apruba → Pagpapatupad ng Badyet → Klasipikasyon ng Data →
Pasadyang Patakaran. Lahat ng limang yugto ay struktural — nagsasagawa ang mga ito sa code,
hindi sa prompt ng agent.

**Mga Mandatory na Baseline Rule** ay kasama sa bawat pag-install: 10 patakaran ng pamamahala
(`SYS-SEC-001` hanggang `SYS-GOV-002`) na hindi maaaring alisin o pahihinain ng user
configuration. Ang mga pasadyang panuntunan ay nagpapalawak ng baseline; hindi sila maaaring
mag-override nito.

**EU AI Act Compliance** — ang audit trail, classification framework, at mga daloy ng
trabaho ng pag-apruba ay direktang nagma-map sa mga kinakailangan ng Artikulo 9, 12, at 17.
Ang deadline ng pagsunod sa Agosto 2026 ay naka-built sa product roadmap.

**Compliance Reporting** sa pamamagitan ng `sidjua audit report/violations/agents/export`:
compliance score, mga trust score bawat agent, kasaysayan ng paglabag, CSV/JSON export
para sa mga panlabas na auditor o SIEM integration.

**Write-Ahead Log (WAL)** na may integrity verification: ang bawat desisyon sa pamamahala
ay isinusulat sa isang append-only na log bago isagawa. Ang mga tampered na entry ay
natukoy sa pagbabasa. Ang `sidjua memory recover` ay muling nagbeberipika at nagkukumpuni.

### Komunikasyon

Hindi lang sumasagot ang mga agent sa mga API call — lumalahok sila sa mga tunay na
channel ng komunikasyon.

**Bidirectional na Email** (`sidjua email status/test/threads`): tinatanggap ng mga agent
ang email sa pamamagitan ng IMAP polling at sumasagot sa pamamagitan ng SMTP. Ang thread
mapping sa pamamagitan ng mga In-Reply-To header ay nagpapanatiling magkakaugnay ang mga
pag-uusap. Ang whitelisting ng nagpadala, mga limitasyon ng laki ng katawan, at pagtanggal
ng HTML ay nagpoprotekta sa pipeline ng agent mula sa mapanganib na input.

**Discord Gateway Bot**: kumpletong slash-command interface sa pamamagitan ng `sidjua module install
discord`. Sumasagot ang mga agent sa mga mensahe ng Discord, nagpapanatili ng mga thread
ng pag-uusap, at nagpapadala ng mga proaktibong abiso.

**Telegram Integration**: mga alerto at abiso ng agent sa pamamagitan ng Telegram bot.
Ang multi-channel adapter pattern ay sumusuporta sa Telegram, Discord, ntfy, at Email
nang sabay-sabay.

### Mga Operasyon

**Iisang Docker command** hanggang produksyon:

```bash
docker run -p 4200:4200 ghcr.io/goetzkohlberg/sidjua:latest
```

Ang API key ay awtomatikong nabubuo sa unang pagsisimula at naka-print sa mga log ng container.
Hindi kailangan ng mga environment variable. Hindi kailangan ng configuration. Hindi kailangan
ng database server — gumagamit ang SIDJUA ng SQLite, isang database file bawat agent.

**CLI Management** — kumpletong lifecycle mula sa isang binary:

```bash
sidjua init                      # Interactive na setup ng workspace (3 hakbang)
sidjua apply                     # Mag-provision mula sa divisions.yaml
sidjua agent create/list/stop    # Lifecycle ng agent
sidjua run "task..." --wait      # Magsumite ng gawain na may pagpapatupad ng pamamahala
sidjua audit report              # Ulat ng pagsunod
sidjua costs                     # Pagbabago ng gastos ayon sa dibisyon/agent
sidjua backup create/restore     # Pamamahala ng backup na may lagda ng HMAC
sidjua update                    # Pag-update ng bersyon na may awtomatikong pre-backup
sidjua rollback                  # 1-click na pagbabalik sa nakaraang bersyon
sidjua email status/test         # Pamamahala ng email channel
sidjua secret set/get/rotate     # Pamamahala ng naka-encrypt na lihim
sidjua memory import/search      # Semantic knowledge pipeline
sidjua selftest                  # Pagsusuri ng kalusugan ng sistema (7 kategorya, marka na 0-100)
```

**Semantic Memory** — mag-import ng mga pag-uusap at dokumento (`sidjua memory import
~/exports/claude-chats.zip`), maghanap gamit ang vector + BM25 hybrid ranking. Sumusuporta
sa mga Cloudflare Workers AI embedding (libre, zero-config) at malalaking OpenAI embedding
(mas mataas na kalidad para sa malalaking knowledge base).

**Adaptive Chunking** — awtomatikong inaayos ng memory pipeline ang mga laki ng chunk
upang manatili sa loob ng limitasyon ng token ng bawat modelo ng embedding.

**Zero-Config Guide** — inilulunsad ng `sidjua chat guide` ang isang interactive AI assistant
nang walang anumang API key, pinapagana ng Cloudflare Workers AI sa pamamagitan ng SIDJUA proxy.
Itanong kung paano mag-set up ng mga agent, mag-configure ng pamamahala, o maunawaan kung
ano ang nangyari sa audit log.

**Air-Gap Deployment** — tumakbo nang ganap na nakaputol sa internet gamit ang mga lokal
na LLM sa pamamagitan ng Ollama o anumang endpoint na compatible sa OpenAI. Walang telemetry
bilang default. Opsyonal na opt-in crash reporting na may buong PII redaction.

### Seguridad

**Sandbox Isolation** — ang mga kasanayan ng agent ay tumatakbo sa loob ng OS-level na
process isolation sa pamamagitan ng bubblewrap (Linux user namespaces). Zero karagdagang
RAM overhead. Pluggable na `SandboxProvider` interface: `none` para sa development,
`bubblewrap` para sa produksyon.

**Secrets Management** — naka-encrypt na secrets store na may RBAC (`sidjua secret
set/get/list/delete/rotate/namespaces`). Hindi kailangan ng panlabas na vault.

**Security-First Build** — malawak na internal na test suite at independiyenteng
pag-validate ng 2 panlabas na code auditor (DeepSeek V3 at xAI Grok). Mga security
header, CSRF protection, rate limiting, at input sanitization sa bawat API surface.
Pag-iwas sa SQL injection na may mga parameterized na query sa lahat ng dako.

**Backup Integrity** — mga backup archive na may lagda ng HMAC na may zip-slip protection,
pag-iwas sa zip bomb, at manifest checksum verification sa restore.

---

## Pag-import mula sa Ibang mga Framework

```bash
# I-preview kung ano ang ma-import — walang mga pagbababago
sidjua import openclaw --dry-run

# Mag-import ng config + mga skill file
sidjua import openclaw --skills
```

Ang iyong mga kasalukuyang agent ay pinapanatili ang kanilang pagkakakilanlan, mga modelo,
at mga kasanayan. Awtomatikong nagdadagdag ang SIDJUA ng pamamahala, mga audit trail,
at mga kontrol sa badyet.

---

## Configuration Reference

Isang minimal na `divisions.yaml` para makapagsimula:

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

Nagbibigay ang `sidjua apply` ng kumpletong imprastraktura mula sa file na ito. Patakbuhin
muli pagkatapos ng mga pagbabago — ito ay idempotent.

Tingnan ang [docs/SIDJUA-APPLY-TECH-SPEC-V1.md](docs/SIDJUA-APPLY-TECH-SPEC-V1.md)
para sa buong detalye ng lahat ng 10 hakbang ng provisioning.

---

## REST API

Ang SIDJUA REST API ay tumatakbo sa parehong port tulad ng dashboard:

```bash
sidjua server start --port 4200 --api-key $SIDJUA_API_KEY
```

Mga pangunahing endpoint:

```
GET  /api/v1/health          # Pampublikong pagsusuri ng kalusugan (walang auth)
GET  /api/v1/info            # Metadata ng sistema (authenticated)
POST /api/v1/execute/run     # Magsumite ng gawain
GET  /api/v1/execute/:id/status  # Katayuan ng gawain
GET  /api/v1/execute/:id/result  # Resulta ng gawain
GET  /api/v1/events          # SSE event stream
GET  /api/v1/audit/report    # Ulat ng pagsunod
```

Ang lahat ng endpoint maliban sa `/health` ay nangangailangan ng Bearer authentication.
Gumawa ng key:

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

O gamitin ang kasamang `docker-compose.yml` na nagdadagdag ng mga pinangalanang volume para
sa config, mga log, at agent workspace, kasama ang opsyonal na serbisyo ng Qdrant para sa
semantic search:

```bash
docker compose up -d
docker compose exec sidjua sidjua init
docker compose exec sidjua sidjua apply
```

---

## Mga Provider

Kumokonekta ang SIDJUA sa anumang LLM provider nang walang lock-in:

| Provider | Mga Modelo | API Key |
|----------|-----------|---------|
| Anthropic | Claude Sonnet 4.6, Haiku 4.5, Opus 4.6 | `ANTHROPIC_API_KEY` |
| Google | Gemini 2.0, Gemini 1.5 Pro | `GOOGLE_API_KEY` |
| Groq | Llama 3.x, Mixtral | `GROQ_API_KEY` (libreng tier) |
| Cloudflare Workers AI | Llama, Mistral, Phi | `CF_ACCOUNT_ID` + `CF_TOKEN` |
| Ollama | Anumang lokal na modelo | Walang key (lokal) |
| OpenAI-compatible | Anumang endpoint | Custom URL + key |

```bash
# Magdagdag ng provider key
sidjua key set groq gsk_...

# Ilista ang mga available na provider at modelo
sidjua provider list
```

---

## Roadmap

Buong roadmap sa [sidjua.com/roadmap](https://sidjua.com/roadmap).

Sa malapit na hinaharap:
- Mga pattern ng multi-agent orchestration (V1.1)
- Mga Webhook inbound trigger (V1.1)
- Komunikasyon ng agent-sa-agent (V1.2)
- Enterprise SSO integration (V1.x)
- Cloud-hosted na serbisyo ng validation ng pamamahala (V1.x)

---

## Komunidad

- **Discord**: [sidjua.com/discord](https://sidjua.com/discord)
- **GitHub Issues**: [github.com/GoetzKohlberg/sidjua/issues](https://github.com/GoetzKohlberg/sidjua/issues)
- **Email**: contact@sidjua.com
- **Docs**: [sidjua.com/docs](https://sidjua.com/docs)

Kung makahanap ng bug, magbukas ng issue — mabilis kaming gumagalaw.

---

## Mga Pagsasalin

Available ang SIDJUA sa 26 wika. Ang Ingles at Aleman ay pinananatili ng core team. Ang lahat ng iba pang pagsasalin ay AI-generated at pinananatili ng komunidad.

**Dokumentasyon:** Ang README na ito at ang [Installation Guide](docs/INSTALLATION.md) ay available sa lahat ng 26 wika. Tingnan ang language selector sa itaas ng pahinang ito.

| Rehiyon | Mga Wika |
|---------|----------|
| Amerikas | Ingles, Espanyol, Portuges (Brazil) |
| Europa | Aleman, Pranses, Italyano, Dutch, Polish, Czech, Romanian, Russian, Ukrainian, Swedish, Turkish |
| Gitnang Silangan | Arabik |
| Asya | Hindi, Bengali, Filipino, Indonesian, Malay, Thai, Vietnamese, Japanese, Korean, Chinese (Simplified), Chinese (Traditional) |

Nakahanap ng error sa pagsasalin? Mangyaring magbukas ng GitHub Issue na may:
- Wika at locale code (hal. `fil`)
- Ang maling teksto o key mula sa locale file (hal. `gui.nav.dashboard`)
- Ang tamang pagsasalin

Gusto bang mag-maintain ng isang wika? Tingnan ang [CONTRIBUTING.md](CONTRIBUTING.md#translations) — gumagamit kami ng modelo ng maintainer bawat wika.

---

## Lisensya

**AGPL-3.0** — maaari mong gamitin, baguhin, at ipamahagi ang SIDJUA nang libre hangga't
ibinabahagi mo ang mga pagbabago sa ilalim ng parehong lisensya. Ang source code ay palaging
available sa mga gumagamit ng isang hosted deployment.

Available ang enterprise license para sa mga organisasyong nangangailangan ng proprietary
deployment nang walang mga obligasyon ng AGPL.
[contact@sidjua.com](mailto:contact@sidjua.com)
