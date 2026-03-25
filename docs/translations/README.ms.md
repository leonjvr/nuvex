[English](../../README.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [Français](README.fr.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [中文 (简体)](README.zh-CN.md) | [中文 (繁體)](README.zh-TW.md) | [العربية](README.ar.md) | [বাংলা](README.bn.md) | [Čeština](README.cs.md) | [Filipino](README.fil.md) | [हिन्दी](README.hi.md) | [Bahasa Indonesia](README.id.md) | [Italiano](README.it.md) | [Bahasa Melayu](README.ms.md) | [Nederlands](README.nl.md) | [Polski](README.pl.md) | [Português (BR)](README.pt-BR.md) | [Română](README.ro.md) | [Русский](README.ru.md) | [Svenska](README.sv.md) | [ภาษาไทย](README.th.md) | [Türkçe](README.tr.md) | [Українська](README.uk.md) | [Tiếng Việt](README.vi.md)

> *Halaman ini diterjemahkan secara automatik daripada [asal bahasa Inggeris](../../README.md). Jumpa kesilapan? [Laporkan](https://github.com/GoetzKohlberg/sidjua/issues).*

---

# SIDJUA — Platform Tadbir Urus Ejen AI

> Satu-satunya platform ejen di mana tadbir urus dikuatkuasakan oleh seni bina, bukan dengan harapan bahawa model akan berkelakuan dengan baik.

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Docker](https://img.shields.io/badge/Docker-sidjua%2Fsidjua-blue)](https://hub.docker.com/r/sidjua/sidjua)
[![Version](https://img.shields.io/badge/version-1.0.0-green)](https://github.com/sidjua-dev/sidjua/releases)

---

## Pemasangan

### Prasyarat

| Alat | Diperlukan | Nota |
|------|-----------|------|
| **Node.js** | >= 22.0.0 | Modul ES, `fetch()`, `crypto.subtle`. [Muat turun](https://nodejs.org) |
| **C/C++ Toolchain** | Untuk binaan sumber sahaja | `better-sqlite3` dan `argon2` mengkompil addon asli |
| **Docker** | >= 24 (pilihan) | Hanya untuk penggunaan Docker |

Pasang Node.js 22: Ubuntu/Debian (`curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs`), macOS (`brew install node@22`), Windows (`winget install OpenJS.NodeJS.LTS`).

Pasang alat C/C++: Ubuntu (`sudo apt-get install -y python3 make g++ build-essential`), macOS (`xcode-select --install`), Windows (`npm install --global windows-build-tools`).

### Pilihan A — Docker (Disyorkan)

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
docker compose up -d
```

```bash
# Lihat kunci API yang dijana secara automatik
docker compose exec sidjua cat /app/.system/api-key

# Bootstrap tadbir urus
docker compose exec sidjua sidjua apply --verbose

# Semak kesihatan sistem
docker compose exec sidjua sidjua selftest
```

Menyokong **linux/amd64** dan **linux/arm64** (Raspberry Pi, Apple Silicon).

### Pilihan B — Pemasangan Global npm

```bash
npm install -g sidjua
sidjua init          # Persediaan interaktif 3 langkah
sidjua chat guide    # Panduan AI tanpa konfigurasi (tiada kunci API diperlukan)
```

### Pilihan C — Binaan dari Sumber

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
npm ci && npm run build
node dist/index.js --help
```

### Nota Platform

| Ciri | Linux | macOS | Windows (WSL2) | Windows (asli) |
|------|-------|-------|----------------|----------------|
| CLI + REST API | ✅ Penuh | ✅ Penuh | ✅ Penuh | ✅ Penuh |
| Docker | ✅ Penuh | ✅ Penuh (Desktop) | ✅ Penuh (Desktop) | ✅ Penuh (Desktop) |
| Sandboxing (bubblewrap) | ✅ Penuh | ❌ Kembali ke `none` | ✅ Penuh (dalam WSL2) | ❌ Kembali ke `none` |
| Web Management Console | ✅ Full | ✅ Full | ✅ Full | ✅ Full |

Tiada pangkalan data luaran diperlukan. SIDJUA menggunakan SQLite. Qdrant adalah pilihan (untuk carian semantik sahaja).

Lihat [docs/INSTALLATION.md](docs/INSTALLATION.md) untuk panduan lengkap dengan susun atur direktori, pemboleh ubah persekitaran, penyelesaian masalah per-OS, dan rujukan Docker volume.

---

## Mengapa SIDJUA?

Setiap rangka kerja ejen AI hari ini bergantung pada andaian yang sama yang sudah rosak: bahawa anda
boleh mempercayai AI untuk mengikuti peraturannya sendiri.

**Masalah dengan tadbir urus berasaskan prompt:**

Anda memberi ejen system prompt yang berkata "jangan sekali-kali mengakses PII pelanggan."
Ejen membaca arahan tersebut. Ejen juga membaca mesej pengguna yang memintanya mengambil
sejarah pembayaran John Smith. Ejen memutuskan — dengan sendirinya — sama ada untuk mematuhi.
Itu bukan tadbir urus. Itu cadangan yang disuarakan dengan tegas.

**SIDJUA berbeza.**

Tadbir urus berada **di luar** ejen. Setiap tindakan melalui saluran paip penguatkuasaan
5 langkah **sebelum** dilaksanakan. Anda mentakrifkan peraturan dalam YAML. Sistem
menguatkuasakannya. Ejen tidak pernah berpeluang memutuskan sama ada untuk mengikutinya,
kerana semakan berlaku sebelum ejen bertindak.

Ini adalah tadbir urus melalui seni bina — bukan melalui prompting, bukan melalui
fine-tuning, bukan dengan berharap.

---

## Cara Ia Berfungsi

SIDJUA membungkus ejen anda dalam lapisan tadbir urus luaran. Panggilan LLM ejen
tidak pernah berlaku sehingga tindakan yang dicadangkan melepasi saluran paip
penguatkuasaan 5 peringkat:

**Peringkat 1 — Dilarang:** Tindakan yang disekat ditolak dengan segera. Tiada panggilan
LLM, tiada entri log yang ditanda "dibenarkan", tiada peluang kedua. Jika tindakan ada
dalam senarai terlarang, ia berhenti di sini.

**Peringkat 2 — Kelulusan:** Tindakan yang memerlukan persetujuan manusia ditahan untuk
kelulusan sebelum dilaksanakan. Ejen menunggu. Manusia memutuskan.

**Peringkat 3 — Belanjawan:** Setiap tugas berjalan terhadap had kos masa nyata. Belanjawan
per-tugas dan per-ejen dikuatkuasakan. Apabila had dicapai, tugas dibatalkan — tidak
ditanda, tidak dilog untuk semakan, *dibatalkan*.

**Peringkat 4 — Pengelasan:** Data yang merentasi sempadan bahagian diperiksa terhadap
peraturan pengelasan. Ejen Tier-2 tidak boleh mengakses data SECRET. Ejen dalam Bahagian A
tidak boleh membaca rahasia Bahagian B.

**Peringkat 5 — Dasar:** Peraturan organisasi tersuai, dikuatkuasakan secara struktural.
Had kekerapan panggilan API, had token output, sekatan tetingkap masa.

Seluruh saluran paip berjalan sebelum sebarang tindakan dilaksanakan. Tiada mod "log dan
semak kemudian" untuk operasi yang kritikal dari segi tadbir urus.

### Fail Konfigurasi Tunggal

Seluruh organisasi ejen anda berada dalam satu `divisions.yaml`:

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

`sidjua apply` membaca fail ini dan memperuntukkan infrastruktur ejen yang lengkap:
ejen, bahagian, RBAC, penghalaan, jadual audit, laluan rahasia, dan peraturan tadbir urus
— dalam 10 langkah yang boleh direproduksi.

### Seni Bina Ejen

Ejen diatur ke dalam **bahagian** (kumpulan fungsional) dan **peringkat**
(tahap kepercayaan). Ejen Tier 1 mempunyai autonomi penuh dalam sampul tadbir urus
mereka. Ejen Tier 2 memerlukan kelulusan untuk operasi sensitif. Ejen Tier 3 sepenuhnya
diselia. Sistem peringkat dikuatkuasakan secara struktural — ejen tidak boleh
mempromosikan dirinya sendiri.

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

## Kekangan Seni Bina

SIDJUA menguatkuasakan kekangan ini di peringkat seni bina — ia tidak boleh
dilumpuhkan, dipintas, atau ditimpa oleh ejen:

1. **Tadbir urus adalah luaran**: Lapisan tadbir urus membungkus ejen. Ejen tidak
   mempunyai akses kepada kod tadbir urus, tidak boleh mengubah suai peraturan, dan
   tidak boleh mengesan sama ada tadbir urus wujud.

2. **Pra-tindakan, bukan pasca-tindakan**: Setiap tindakan diperiksa SEBELUM dilaksanakan.
   Tiada mod "log dan semak kemudian" untuk operasi yang kritikal dari segi tadbir urus.

3. **Penguatkuasaan struktural**: Peraturan dikuatkuasakan oleh laluan kod, bukan oleh
   prompt atau arahan model. Ejen tidak boleh "jailbreak" keluar dari tadbir urus kerana
   tadbir urus tidak dilaksanakan sebagai arahan kepada model.

4. **Keabadian audit**: Write-Ahead Log (WAL) adalah tambah-sahaja dengan pengesahan
   integriti. Entri yang dimanipulasi dikesan dan dikecualikan.

5. **Pengasingan bahagian**: Ejen dalam bahagian yang berbeza tidak boleh mengakses
   data, rahasia, atau saluran komunikasi antara satu sama lain.

---

## Perbandingan

| Ciri | SIDJUA | CrewAI | AutoGen | LangGraph | OpenClaw |
|------|--------|--------|---------|-----------|----------|
| Tadbir Urus Luaran | ✅ Seni Bina | ❌ | ❌ | ❌ | ❌ |
| Penguatkuasaan Pra-Tindakan | ✅ Saluran Paip 5 Langkah | ❌ | ❌ | ❌ | ❌ |
| Sedia EU AI Act | ✅ | ❌ | ❌ | ❌ | ❌ |
| Self-Hosted | ✅ | ❌ Awan | ❌ Awan | ❌ Awan | ✅ Plugin |
| Mampu Air-Gap | ✅ | ❌ | ❌ | ❌ | ❌ |
| Model Agnostik | ✅ Mana-mana LLM | Separa | Separa | Separa | ✅ |
| E-mel Dua Hala | ✅ | ❌ | ❌ | ❌ | ❌ |
| Discord Gateway | ✅ | ❌ | ❌ | ❌ | ❌ |
| Ejen Hierarki | ✅ Bahagian + Peringkat | Asas | Asas | Graf | ❌ |
| Penguatkuasaan Belanjawan | ✅ Had Per-Ejen | ❌ | ❌ | ❌ | ❌ |
| Pengasingan Sandbox | ✅ bubblewrap | ❌ | ❌ | ❌ | ❌ |
| Keabadian Audit | ✅ WAL + integriti | ❌ | ❌ | ❌ | ❌ |
| Lesen | AGPL-3.0 | MIT | MIT | MIT | Campuran |
| Audit Bebas | ✅ 2 Luaran | ❌ | ❌ | ❌ | ❌ |

---

## Ciri-ciri

### Tadbir Urus & Pematuhan

**Saluran Paip Pra-Tindakan (Peringkat 0)** berjalan sebelum setiap tindakan ejen:
Semakan Terlarang → Kelulusan Manusia → Penguatkuasaan Belanjawan → Pengelasan Data →
Dasar Tersuai. Kelima-lima peringkat adalah struktural — dilaksanakan dalam kod,
bukan dalam prompt ejen.

**Peraturan Garis Dasar Wajib** disertakan dengan setiap pemasangan: 10 peraturan
tadbir urus (`SYS-SEC-001` hingga `SYS-GOV-002`) yang tidak boleh dibuang atau
dilemahkan oleh konfigurasi pengguna. Peraturan tersuai melanjutkan garis dasar;
ia tidak boleh menimpa garis dasar.

**Pematuhan EU AI Act** — jejak audit, rangka kerja pengelasan, dan aliran kerja
kelulusan dipetakan terus kepada keperluan Artikel 9, 12, dan 17. Tarikh akhir
pematuhan Ogos 2026 telah dibina ke dalam peta jalan produk.

**Pelaporan Pematuhan** melalui `sidjua audit report/violations/agents/export`:
skor pematuhan, skor kepercayaan per-ejen, sejarah pelanggaran, eksport CSV/JSON
untuk juruaudit luaran atau integrasi SIEM.

**Write-Ahead Log (WAL)** dengan pengesahan integriti: setiap keputusan tadbir urus
ditulis ke log tambah-sahaja sebelum dilaksanakan. Entri yang dimanipulasi dikesan
semasa dibaca. `sidjua memory recover` mengesahkan semula dan membaiki.

### Komunikasi

Ejen bukan sahaja bertindak balas kepada panggilan API — mereka turut serta dalam
saluran komunikasi sebenar.

**E-mel Dua Hala** (`sidjua email status/test/threads`): ejen menerima e-mel melalui
pengundian IMAP dan membalas melalui SMTP. Pemetaan utas melalui pengepala In-Reply-To
mengekalkan perbualan yang koheren. Senarai putih penghantar, had saiz badan, dan
penyingkiran HTML melindungi saluran paip ejen daripada input berniat jahat.

**Bot Discord Gateway**: antara muka perintah slash penuh melalui `sidjua module install
discord`. Ejen bertindak balas kepada mesej Discord, mengekalkan utas perbualan,
dan menghantar pemberitahuan proaktif.

**Integrasi Telegram**: makluman dan pemberitahuan ejen melalui bot Telegram.
Corak penyesuai berbilang saluran menyokong Telegram, Discord, ntfy, dan E-mel
secara selari.

### Operasi

**Satu perintah Docker** ke pengeluaran:

```bash
docker run -p 4200:4200 sidjua/sidjua:latest
```

Kunci API dijana secara automatik pada permulaan pertama dan dicetak ke log kontena.
Tiada pemboleh ubah persekitaran diperlukan. Tiada konfigurasi diperlukan. Tiada
pelayan pangkalan data diperlukan — SIDJUA menggunakan SQLite, satu fail pangkalan
data per ejen.

**Pengurusan CLI** — kitaran hayat lengkap daripada satu binari:

```bash
sidjua init                      # Persediaan ruang kerja interaktif (3 langkah)
sidjua apply                     # Peruntukan daripada divisions.yaml
sidjua agent create/list/stop    # Kitaran hayat ejen
sidjua run "task..." --wait      # Hantar tugas dengan penguatkuasaan tadbir urus
sidjua audit report              # Laporan pematuhan
sidjua costs                     # Pecahan kos mengikut bahagian/ejen
sidjua backup create/restore     # Pengurusan sandaran bertandatangan HMAC
sidjua update                    # Kemas kini versi dengan sandaran automatik sebelumnya
sidjua rollback                  # Pemulihan 1-klik ke versi sebelumnya
sidjua email status/test         # Pengurusan saluran e-mel
sidjua secret set/get/rotate     # Pengurusan rahasia tersulitkan
sidjua memory import/search      # Saluran paip pengetahuan semantik
sidjua selftest                  # Semakan kesihatan sistem (7 kategori, skor 0-100)
```

**Memori Semantik** — import perbualan dan dokumen (`sidjua memory import
~/exports/claude-chats.zip`), cari dengan pemeringkatan hibrid vektor + BM25.
Menyokong embedding Cloudflare Workers AI (percuma, tanpa konfigurasi) dan embedding
besar OpenAI (kualiti lebih tinggi untuk pangkalan pengetahuan besar).

**Chunking Adaptif** — saluran paip memori secara automatik menyesuaikan saiz chunk
untuk kekal dalam had token setiap model embedding.

**Panduan Tanpa Konfigurasi** — `sidjua chat guide` melancarkan pembantu AI interaktif
tanpa sebarang kunci API, dikuasakan oleh Cloudflare Workers AI melalui proksi SIDJUA.
Tanya cara menyediakan ejen, mengkonfigurasi tadbir urus, atau memahami apa yang
berlaku dalam log audit.

**Penggunaan Air-Gap** — jalankan sepenuhnya terputus daripada internet menggunakan
LLM tempatan melalui Ollama atau mana-mana titik akhir yang serasi dengan OpenAI.
Tiada telemetri secara lalai. Pelaporan ranap opsional dengan penyuntingan PII penuh.

### Keselamatan

**Pengasingan Sandbox** — kemahiran ejen berjalan di dalam pengasingan proses peringkat
OS melalui bubblewrap (ruang nama pengguna Linux). Sifar overhed RAM tambahan. Antara
muka `SandboxProvider` yang boleh dipasang: `none` untuk pembangunan, `bubblewrap` untuk pengeluaran.

**Pengurusan Rahasia** — stor rahasia tersulitkan dengan RBAC (`sidjua secret
set/get/list/delete/rotate/namespaces`). Tiada peti besi luaran diperlukan.

**Binaan Keselamatan Dahulu** — suite ujian dalaman yang meluas ditambah pengesahan
bebas oleh 2 juruaudit kod luaran (DeepSeek V3 dan xAI Grok). Pengepala keselamatan,
perlindungan CSRF, pengehadan kadar, dan sanitasi input pada setiap permukaan API.
Pencegahan suntikan SQL dengan pertanyaan berparameter di seluruh sistem.

**Integriti Sandaran** — arkib sandaran bertandatangan HMAC dengan perlindungan zip-slip,
pencegahan bom zip, dan pengesahan checksum manifes semasa pemulihan.

---

## Import daripada Rangka Kerja Lain

```bash
# Pratonton apa yang akan diimport — tiada perubahan dibuat
sidjua import openclaw --dry-run

# Import fail konfigurasi + kemahiran
sidjua import openclaw --skills
```

Ejen sedia ada anda mengekalkan identiti, model, dan kemahiran mereka. SIDJUA
secara automatik menambah tadbir urus, jejak audit, dan kawalan belanjawan.

---

## Rujukan Konfigurasi

`divisions.yaml` minimum untuk bermula:

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

`sidjua apply` memperuntukkan infrastruktur lengkap daripada fail ini. Jalankan
semula selepas perubahan — ia adalah idempoten.

Lihat [docs/SIDJUA-APPLY-TECH-SPEC-V1.md](docs/SIDJUA-APPLY-TECH-SPEC-V1.md)
untuk spesifikasi penuh bagi semua 10 langkah peruntukan.

---

## REST API

SIDJUA REST API berjalan pada port yang sama seperti papan pemuka:

```bash
sidjua server start --port 4200 --api-key $SIDJUA_API_KEY
```

Titik akhir utama:

```
GET  /api/v1/health          # Semakan kesihatan awam (tanpa pengesahan)
GET  /api/v1/info            # Metadata sistem (disahkan)
POST /api/v1/execute/run     # Hantar tugas
GET  /api/v1/execute/:id/status  # Status tugas
GET  /api/v1/execute/:id/result  # Keputusan tugas
GET  /api/v1/events          # Strim acara SSE
GET  /api/v1/audit/report    # Laporan pematuhan
```

Semua titik akhir kecuali `/health` memerlukan pengesahan Bearer. Jana kunci:

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

Atau gunakan `docker-compose.yml` yang disertakan yang menambah volum bernama untuk
konfigurasi, log, dan ruang kerja ejen, ditambah perkhidmatan Qdrant pilihan untuk
carian semantik:

```bash
docker compose up -d
docker compose exec sidjua sidjua init
docker compose exec sidjua sidjua apply
```

---

## Pembekal

SIDJUA berhubung dengan mana-mana pembekal LLM tanpa kunci:

| Pembekal | Model | Kunci API |
|---------|-------|-----------|
| Anthropic | Claude Sonnet 4.6, Haiku 4.5, Opus 4.6 | `ANTHROPIC_API_KEY` |
| Google | Gemini 2.0, Gemini 1.5 Pro | `GOOGLE_API_KEY` |
| Groq | Llama 3.x, Mixtral | `GROQ_API_KEY` (peringkat percuma) |
| Cloudflare Workers AI | Llama, Mistral, Phi | `CF_ACCOUNT_ID` + `CF_TOKEN` |
| Ollama | Mana-mana model tempatan | Tiada kunci (tempatan) |
| Serasi OpenAI | Mana-mana titik akhir | URL tersuai + kunci |

```bash
# Tambah kunci pembekal
sidjua key set groq gsk_...

# Senaraikan pembekal dan model yang tersedia
sidjua provider list
```

---

## Peta Jalan

Peta jalan penuh di [sidjua.com/roadmap](https://sidjua.com/roadmap).

Jangka pendek:
- Corak orkestrasi berbilang ejen (V1.1)
- Pencetus masuk Webhook (V1.1)
- Komunikasi ejen-ke-ejen (V1.2)
- Integrasi SSO perusahaan (V1.x)
- Perkhidmatan pengesahan tadbir urus yang dihoskan di awan (V1.x)

---

## Komuniti

- **Discord**: [sidjua.com/discord](https://sidjua.com/discord)
- **GitHub Issues**: [github.com/sidjua-dev/sidjua/issues](https://github.com/sidjua-dev/sidjua/issues)
- **E-mel**: contact@sidjua.com
- **Dokumentasi**: [sidjua.com/docs](https://sidjua.com/docs)

Jika anda menjumpai pepijat, buka isu — kami bergerak pantas.

---

## Terjemahan

SIDJUA tersedia dalam 26 bahasa. Bahasa Inggeris dan Jerman diselenggarakan oleh pasukan teras. Semua terjemahan lain dijana oleh AI dan diselenggarakan oleh komuniti.

**Dokumentasi:** README ini dan [Panduan Pemasangan](docs/INSTALLATION.md) tersedia dalam semua 26 bahasa. Lihat pemilih bahasa di bahagian atas halaman ini.

| Rantau | Bahasa |
|--------|--------|
| Amerika | Inggeris, Sepanyol, Portugis (Brazil) |
| Eropah | Jerman, Perancis, Itali, Belanda, Poland, Czech, Romania, Rusia, Ukraine, Sweden, Turki |
| Timur Tengah | Arab |
| Asia | Hindi, Bengali, Filipino, Indonesia, Melayu, Thai, Vietnam, Jepun, Korea, Cina (Ringkas), Cina (Tradisional) |

Jumpa kesilapan terjemahan? Sila buka GitHub Issue dengan:
- Bahasa dan kod lokal (mis. `ms`)
- Teks yang salah atau kunci daripada fail lokal (mis. `gui.nav.dashboard`)
- Terjemahan yang betul

Ingin menyelenggara bahasa? Lihat [CONTRIBUTING.md](CONTRIBUTING.md#translations) — kami menggunakan model penyelenggara per bahasa.

---

## Lesen

**AGPL-3.0** — anda boleh menggunakan, mengubah suai, dan mengedarkan SIDJUA secara
bebas selagi anda berkongsi pengubahsuaian di bawah lesen yang sama. Kod sumber sentiasa
tersedia kepada pengguna penggunaan yang dihoskan.

Lesen perusahaan tersedia untuk organisasi yang memerlukan penggunaan proprietari
tanpa kewajipan AGPL.
[contact@sidjua.com](mailto:contact@sidjua.com)
