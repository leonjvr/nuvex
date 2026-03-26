[English](../../README.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [Français](README.fr.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [中文 (简体)](README.zh-CN.md) | [中文 (繁體)](README.zh-TW.md) | [العربية](README.ar.md) | [বাংলা](README.bn.md) | [Čeština](README.cs.md) | [Filipino](README.fil.md) | [हिन्दी](README.hi.md) | [Bahasa Indonesia](README.id.md) | [Italiano](README.it.md) | [Bahasa Melayu](README.ms.md) | [Nederlands](README.nl.md) | [Polski](README.pl.md) | [Português (BR)](README.pt-BR.md) | [Română](README.ro.md) | [Русский](README.ru.md) | [Svenska](README.sv.md) | [ภาษาไทย](README.th.md) | [Türkçe](README.tr.md) | [Українська](README.uk.md) | [Tiếng Việt](README.vi.md)

> *Halaman ini diterjemahkan secara otomatis dari [asli bahasa Inggris](../../README.md). Menemukan kesalahan? [Laporkan](https://github.com/GoetzKohlberg/sidjua/issues).*

---

# SIDJUA — Platform Tata Kelola Agen AI

> Satu-satunya platform agen di mana tata kelola ditegakkan oleh arsitektur, bukan dengan harapan bahwa model akan berperilaku dengan baik.

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Docker](https://img.shields.io/badge/Docker-ghcr.io%2Fgoetzkohlberg%2Fsidjua-blue)](https://ghcr.io/goetzkohlberg/sidjua)
[![Version](https://img.shields.io/badge/version-1.0.0-green)](https://github.com/GoetzKohlberg/sidjua/releases)

---

## Instalasi

### Prasyarat

| Alat | Diperlukan | Catatan |
|------|-----------|---------|
| **Node.js** | >= 22.0.0 | Modul ES, `fetch()`, `crypto.subtle`. [Unduh](https://nodejs.org) |
| **C/C++ Toolchain** | Hanya untuk build sumber | `better-sqlite3` dan `argon2` mengkompilasi addon native |
| **Docker** | >= 24 (opsional) | Hanya untuk deployment Docker |

Instal Node.js 22: Ubuntu/Debian (`curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs`), macOS (`brew install node@22`), Windows (`winget install OpenJS.NodeJS.LTS`).

Instal alat C/C++: Ubuntu (`sudo apt-get install -y python3 make g++ build-essential`), macOS (`xcode-select --install`), Windows (`npm install --global windows-build-tools`).

### Opsi A — Docker (Direkomendasikan)

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
docker compose up -d
```

```bash
# Lihat kunci API yang dibuat otomatis
docker compose exec sidjua cat /app/.system/api-key

# Bootstrap tata kelola
docker compose exec sidjua sidjua apply --verbose

# Pemeriksaan kesehatan sistem
docker compose exec sidjua sidjua selftest
```

Mendukung **linux/amd64** dan **linux/arm64** (Raspberry Pi, Apple Silicon).

### Opsi B — Instalasi Global npm

```bash
npm install -g sidjua
sidjua init          # Penyiapan interaktif 3 langkah
sidjua chat guide    # Panduan AI tanpa konfigurasi (tidak memerlukan kunci API)
```

### Opsi C — Build dari Sumber

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
npm ci && npm run build
node dist/index.js --help
```

### Catatan Platform

| Fitur | Linux | macOS | Windows (WSL2) | Windows (native) |
|-------|-------|-------|----------------|------------------|
| CLI + REST API | ✅ Penuh | ✅ Penuh | ✅ Penuh | ✅ Penuh |
| Docker | ✅ Penuh | ✅ Penuh (Desktop) | ✅ Penuh (Desktop) | ✅ Penuh (Desktop) |
| Sandboxing (bubblewrap) | ✅ Penuh | ❌ Kembali ke `none` | ✅ Penuh (di dalam WSL2) | ❌ Kembali ke `none` |
| Web Management Console | ✅ Full | ✅ Full | ✅ Full | ✅ Full |

Tidak diperlukan database eksternal. SIDJUA menggunakan SQLite. Qdrant bersifat opsional (hanya untuk pencarian semantik).

Lihat [docs/INSTALLATION.md](docs/INSTALLATION.md) untuk panduan lengkap dengan tata letak direktori, variabel lingkungan, pemecahan masalah per OS, dan referensi Docker volume.

---

## Mengapa SIDJUA?

Setiap framework agen AI saat ini mengandalkan asumsi yang sama yang sudah rusak: bahwa Anda
dapat mempercayai AI untuk mengikuti aturannya sendiri.

**Masalah dengan tata kelola berbasis prompt:**

Anda memberikan agen sebuah system prompt yang mengatakan "jangan pernah mengakses PII pelanggan."
Agen membaca instruksi tersebut. Agen juga membaca pesan pengguna yang memintanya untuk mengambil
riwayat pembayaran John Smith. Agen memutuskan — dengan sendirinya — apakah akan mematuhi.
Itu bukan tata kelola. Itu saran yang diucapkan dengan tegas.

**SIDJUA berbeda.**

Tata kelola berada **di luar** agen. Setiap tindakan melewati pipeline penegakan 5 langkah
**sebelum** dieksekusi. Anda mendefinisikan aturan dalam YAML. Sistem menegakkannya.
Agen tidak pernah berkesempatan memutuskan apakah akan mengikutinya, karena pemeriksaan
terjadi sebelum agen bertindak.

Ini adalah tata kelola melalui arsitektur — bukan melalui prompting, bukan melalui
fine-tuning, bukan dengan berharap.

---

## Cara Kerjanya

SIDJUA membungkus agen Anda dalam lapisan tata kelola eksternal. Panggilan LLM agen
tidak pernah terjadi sampai tindakan yang diusulkan melewati pipeline penegakan 5 tahap:

**Tahap 1 — Dilarang:** Tindakan yang diblokir langsung ditolak. Tidak ada panggilan LLM,
tidak ada entri log yang ditandai "diizinkan", tidak ada kesempatan kedua. Jika tindakan
ada di daftar terlarang, berhenti di sini.

**Tahap 2 — Persetujuan:** Tindakan yang memerlukan persetujuan manusia ditahan untuk
disetujui sebelum dieksekusi. Agen menunggu. Manusia memutuskan.

**Tahap 3 — Anggaran:** Setiap tugas berjalan terhadap batas biaya real-time. Anggaran
per-tugas dan per-agen ditegakkan. Ketika batas tercapai, tugas dibatalkan — tidak ditandai,
tidak dicatat untuk ditinjau, *dibatalkan*.

**Tahap 4 — Klasifikasi:** Data yang melewati batas divisi diperiksa terhadap aturan
klasifikasi. Agen Tier-2 tidak dapat mengakses data SECRET. Agen di Divisi A tidak dapat
membaca rahasia Divisi B.

**Tahap 5 — Kebijakan:** Aturan organisasi khusus, ditegakkan secara struktural. Batas
frekuensi panggilan API, batas token output, pembatasan jendela waktu.

Seluruh pipeline berjalan sebelum tindakan apa pun dieksekusi. Tidak ada mode "catat dan
tinjau nanti" untuk operasi yang kritis dari segi tata kelola.

### File Konfigurasi Tunggal

Seluruh organisasi agen Anda berada dalam satu `divisions.yaml`:

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

`sidjua apply` membaca file ini dan menyediakan infrastruktur agen yang lengkap:
agen, divisi, RBAC, routing, tabel audit, jalur rahasia, dan aturan tata kelola
— dalam 10 langkah yang dapat direproduksi.

### Arsitektur Agen

Agen diorganisir ke dalam **divisi** (kelompok fungsional) dan **tingkatan**
(tingkat kepercayaan). Agen Tier 1 memiliki otonomi penuh dalam amplop tata kelola mereka.
Agen Tier 2 memerlukan persetujuan untuk operasi sensitif. Agen Tier 3 sepenuhnya
diawasi. Sistem tingkatan ditegakkan secara struktural — agen tidak dapat mempromosikan dirinya sendiri.

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

## Batasan Arsitektur

SIDJUA menerapkan batasan-batasan ini di tingkat arsitektur — tidak dapat dinonaktifkan,
dilewati, atau ditimpa oleh agen:

1. **Tata kelola bersifat eksternal**: Lapisan tata kelola membungkus agen. Agen tidak
   memiliki akses ke kode tata kelola, tidak dapat memodifikasi aturan, dan tidak dapat
   mendeteksi apakah tata kelola ada.

2. **Pra-tindakan, bukan pasca-tindakan**: Setiap tindakan diperiksa SEBELUM dieksekusi.
   Tidak ada mode "catat dan tinjau nanti" untuk operasi yang kritis dari segi tata kelola.

3. **Penegakan struktural**: Aturan ditegakkan oleh jalur kode, bukan oleh prompt atau
   instruksi model. Agen tidak dapat "jailbreak" keluar dari tata kelola karena tata kelola
   tidak diimplementasikan sebagai instruksi ke model.

4. **Kekekalan audit**: Write-Ahead Log (WAL) hanya bisa ditambahkan dengan verifikasi
   integritas. Entri yang dimanipulasi terdeteksi dan dikecualikan.

5. **Isolasi divisi**: Agen di divisi yang berbeda tidak dapat mengakses data, rahasia,
   atau saluran komunikasi satu sama lain.

---

## Perbandingan

| Fitur | SIDJUA | CrewAI | AutoGen | LangGraph | OpenClaw |
|-------|--------|--------|---------|-----------|----------|
| Tata Kelola Eksternal | ✅ Arsitektur | ❌ | ❌ | ❌ | ❌ |
| Penegakan Pra-Tindakan | ✅ Pipeline 5 Langkah | ❌ | ❌ | ❌ | ❌ |
| Siap EU AI Act | ✅ | ❌ | ❌ | ❌ | ❌ |
| Self-Hosted | ✅ | ❌ Cloud | ❌ Cloud | ❌ Cloud | ✅ Plugin |
| Mampu Air-Gap | ✅ | ❌ | ❌ | ❌ | ❌ |
| Model Agnostik | ✅ LLM Apapun | Sebagian | Sebagian | Sebagian | ✅ |
| Email Dua Arah | ✅ | ❌ | ❌ | ❌ | ❌ |
| Discord Gateway | ✅ | ❌ | ❌ | ❌ | ❌ |
| Agen Hierarkis | ✅ Divisi + Tingkatan | Dasar | Dasar | Graf | ❌ |
| Penegakan Anggaran | ✅ Batas Per-Agen | ❌ | ❌ | ❌ | ❌ |
| Isolasi Sandbox | ✅ bubblewrap | ❌ | ❌ | ❌ | ❌ |
| Kekekalan Audit | ✅ WAL + integritas | ❌ | ❌ | ❌ | ❌ |
| Lisensi | AGPL-3.0 | MIT | MIT | MIT | Campuran |
| Audit Independen | ✅ 2 Eksternal | ❌ | ❌ | ❌ | ❌ |

---

## Fitur

### Tata Kelola & Kepatuhan

**Pipeline Pra-Tindakan (Tahap 0)** berjalan sebelum setiap tindakan agen: Pemeriksaan
Terlarang → Persetujuan Manusia → Penegakan Anggaran → Klasifikasi Data → Kebijakan Khusus.
Semua lima tahap bersifat struktural — dieksekusi dalam kode, bukan dalam prompt agen.

**Aturan Dasar Wajib** disertakan dengan setiap instalasi: 10 aturan tata kelola
(`SYS-SEC-001` hingga `SYS-GOV-002`) yang tidak dapat dihapus atau dilemahkan oleh
konfigurasi pengguna. Aturan khusus memperluas dasar; tidak dapat menimpanya.

**Kepatuhan EU AI Act** — jejak audit, kerangka klasifikasi, dan alur kerja persetujuan
langsung dipetakan ke persyaratan Pasal 9, 12, dan 17. Tenggat kepatuhan Agustus 2026
sudah terintegrasi dalam peta jalan produk.

**Pelaporan Kepatuhan** melalui `sidjua audit report/violations/agents/export`:
skor kepatuhan, skor kepercayaan per-agen, riwayat pelanggaran, ekspor CSV/JSON
untuk auditor eksternal atau integrasi SIEM.

**Write-Ahead Log (WAL)** dengan verifikasi integritas: setiap keputusan tata kelola
ditulis ke log yang hanya bisa ditambahkan sebelum dieksekusi. Entri yang dimanipulasi
terdeteksi saat dibaca. `sidjua memory recover` memvalidasi ulang dan memperbaiki.

### Komunikasi

Agen tidak hanya merespons panggilan API — mereka berpartisipasi dalam saluran komunikasi nyata.

**Email Dua Arah** (`sidjua email status/test/threads`): agen menerima email melalui
polling IMAP dan membalas melalui SMTP. Pemetaan thread melalui header In-Reply-To
menjaga percakapan tetap koheren. Daftar putih pengirim, batas ukuran isi, dan
penghapusan HTML melindungi pipeline agen dari input berbahaya.

**Bot Discord Gateway**: antarmuka perintah slash lengkap melalui `sidjua module install
discord`. Agen merespons pesan Discord, mempertahankan thread percakapan,
dan mengirim notifikasi proaktif.

**Integrasi Telegram**: peringatan dan notifikasi agen melalui bot Telegram.
Pola adaptor multi-saluran mendukung Telegram, Discord, ntfy, dan Email secara paralel.

### Operasi

**Satu perintah Docker** ke produksi:

```bash
docker run -p 4200:4200 ghcr.io/goetzkohlberg/sidjua:latest
```

Kunci API dibuat otomatis pada start pertama dan dicetak ke log kontainer.
Tidak diperlukan variabel lingkungan. Tidak diperlukan konfigurasi. Tidak diperlukan
server database — SIDJUA menggunakan SQLite, satu file database per agen.

**Manajemen CLI** — siklus hidup lengkap dari satu binary:

```bash
sidjua init                      # Penyiapan workspace interaktif (3 langkah)
sidjua apply                     # Provisioning dari divisions.yaml
sidjua agent create/list/stop    # Siklus hidup agen
sidjua run "task..." --wait      # Kirim tugas dengan penegakan tata kelola
sidjua audit report              # Laporan kepatuhan
sidjua costs                     # Rincian biaya per divisi/agen
sidjua backup create/restore     # Manajemen backup bertanda tangan HMAC
sidjua update                    # Pembaruan versi dengan backup otomatis sebelumnya
sidjua rollback                  # Pemulihan 1-klik ke versi sebelumnya
sidjua email status/test         # Manajemen saluran email
sidjua secret set/get/rotate     # Manajemen rahasia terenkripsi
sidjua memory import/search      # Pipeline pengetahuan semantik
sidjua selftest                  # Pemeriksaan kesehatan sistem (7 kategori, skor 0-100)
```

**Memori Semantik** — impor percakapan dan dokumen (`sidjua memory import
~/exports/claude-chats.zip`), cari dengan peringkat hibrida vektor + BM25. Mendukung
embedding Cloudflare Workers AI (gratis, tanpa konfigurasi) dan embedding besar OpenAI
(kualitas lebih tinggi untuk basis pengetahuan besar).

**Chunking Adaptif** — pipeline memori secara otomatis menyesuaikan ukuran chunk
agar tetap dalam batas token setiap model embedding.

**Panduan Tanpa Konfigurasi** — `sidjua chat guide` meluncurkan asisten AI interaktif
tanpa kunci API apapun, didukung oleh Cloudflare Workers AI melalui proxy SIDJUA.
Tanyakan cara menyiapkan agen, mengkonfigurasi tata kelola, atau memahami apa yang
terjadi di log audit.

**Deployment Air-Gap** — jalankan sepenuhnya terputus dari internet menggunakan
LLM lokal melalui Ollama atau endpoint yang kompatibel dengan OpenAI apapun.
Tidak ada telemetri secara default. Pelaporan crash opsional dengan redaksi PII penuh.

### Keamanan

**Isolasi Sandbox** — keterampilan agen berjalan di dalam isolasi proses tingkat OS
melalui bubblewrap (namespace pengguna Linux). Nol overhead RAM tambahan. Antarmuka
`SandboxProvider` yang dapat dipasang: `none` untuk pengembangan, `bubblewrap` untuk produksi.

**Manajemen Rahasia** — penyimpanan rahasia terenkripsi dengan RBAC (`sidjua secret
set/get/list/delete/rotate/namespaces`). Tidak diperlukan vault eksternal.

**Build Security-First** — rangkaian pengujian internal yang ekstensif ditambah
validasi independen oleh 2 auditor kode eksternal (DeepSeek V3 dan xAI Grok).
Header keamanan, perlindungan CSRF, pembatasan laju, dan sanitasi input di setiap
permukaan API. Pencegahan injeksi SQL dengan kueri berparameter di seluruh sistem.

**Integritas Backup** — arsip backup bertanda tangan HMAC dengan perlindungan zip-slip,
pencegahan zip bomb, dan verifikasi checksum manifes saat pemulihan.

---

## Impor dari Framework Lain

```bash
# Pratinjau apa yang diimpor — tidak ada perubahan yang dibuat
sidjua import openclaw --dry-run

# Impor file konfigurasi + keterampilan
sidjua import openclaw --skills
```

Agen Anda yang ada mempertahankan identitas, model, dan keterampilan mereka. SIDJUA
secara otomatis menambahkan tata kelola, jejak audit, dan kontrol anggaran.

---

## Referensi Konfigurasi

`divisions.yaml` minimal untuk memulai:

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

`sidjua apply` menyediakan infrastruktur lengkap dari file ini. Jalankan kembali
setelah perubahan — bersifat idempoten.

Lihat [docs/SIDJUA-APPLY-TECH-SPEC-V1.md](docs/SIDJUA-APPLY-TECH-SPEC-V1.md)
untuk spesifikasi lengkap dari semua 10 langkah provisioning.

---

## REST API

SIDJUA REST API berjalan di port yang sama dengan dashboard:

```bash
sidjua server start --port 4200 --api-key $SIDJUA_API_KEY
```

Endpoint utama:

```
GET  /api/v1/health          # Pemeriksaan kesehatan publik (tanpa autentikasi)
GET  /api/v1/info            # Metadata sistem (terautentikasi)
POST /api/v1/execute/run     # Kirim tugas
GET  /api/v1/execute/:id/status  # Status tugas
GET  /api/v1/execute/:id/result  # Hasil tugas
GET  /api/v1/events          # Aliran event SSE
GET  /api/v1/audit/report    # Laporan kepatuhan
```

Semua endpoint kecuali `/health` memerlukan autentikasi Bearer. Buat kunci:

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

Atau gunakan `docker-compose.yml` yang disertakan yang menambahkan volume bernama untuk
konfigurasi, log, dan workspace agen, ditambah layanan Qdrant opsional untuk pencarian
semantik:

```bash
docker compose up -d
docker compose exec sidjua sidjua init
docker compose exec sidjua sidjua apply
```

---

## Penyedia

SIDJUA terhubung ke penyedia LLM mana pun tanpa ketergantungan:

| Penyedia | Model | Kunci API |
|---------|-------|-----------|
| Anthropic | Claude Sonnet 4.6, Haiku 4.5, Opus 4.6 | `ANTHROPIC_API_KEY` |
| Google | Gemini 2.0, Gemini 1.5 Pro | `GOOGLE_API_KEY` |
| Groq | Llama 3.x, Mixtral | `GROQ_API_KEY` (tier gratis) |
| Cloudflare Workers AI | Llama, Mistral, Phi | `CF_ACCOUNT_ID` + `CF_TOKEN` |
| Ollama | Model lokal apa pun | Tanpa kunci (lokal) |
| Kompatibel OpenAI | Endpoint apa pun | URL kustom + kunci |

```bash
# Tambahkan kunci penyedia
sidjua key set groq gsk_...

# Daftar penyedia dan model yang tersedia
sidjua provider list
```

---

## Peta Jalan

Peta jalan lengkap di [sidjua.com/roadmap](https://sidjua.com/roadmap).

Jangka pendek:
- Pola orkestrasi multi-agen (V1.1)
- Pemicu inbound Webhook (V1.1)
- Komunikasi agen-ke-agen (V1.2)
- Integrasi SSO enterprise (V1.x)
- Layanan validasi tata kelola yang dihosting di cloud (V1.x)

---

## Komunitas

- **Discord**: [sidjua.com/discord](https://sidjua.com/discord)
- **GitHub Issues**: [github.com/GoetzKohlberg/sidjua/issues](https://github.com/GoetzKohlberg/sidjua/issues)
- **Email**: contact@sidjua.com
- **Dokumentasi**: [sidjua.com/docs](https://sidjua.com/docs)

Jika menemukan bug, buka issue — kami bergerak cepat.

---

## Terjemahan

SIDJUA tersedia dalam 26 bahasa. Bahasa Inggris dan Jerman dikelola oleh tim inti. Semua terjemahan lainnya dibuat oleh AI dan dikelola oleh komunitas.

**Dokumentasi:** README ini dan [Panduan Instalasi](docs/INSTALLATION.md) tersedia dalam semua 26 bahasa. Lihat pemilih bahasa di bagian atas halaman ini.

| Wilayah | Bahasa |
|---------|--------|
| Amerika | Inggris, Spanyol, Portugis (Brasil) |
| Eropa | Jerman, Prancis, Italia, Belanda, Polandia, Ceko, Rumania, Rusia, Ukraina, Swedia, Turki |
| Timur Tengah | Arab |
| Asia | Hindi, Bengali, Filipino, Indonesia, Melayu, Thai, Vietnam, Jepang, Korea, Cina (Sederhana), Cina (Tradisional) |

Menemukan kesalahan terjemahan? Silakan buka GitHub Issue dengan:
- Bahasa dan kode lokal (mis. `id`)
- Teks yang salah atau kunci dari file lokal (mis. `gui.nav.dashboard`)
- Terjemahan yang benar

Ingin memelihara suatu bahasa? Lihat [CONTRIBUTING.md](CONTRIBUTING.md#translations) — kami menggunakan model pemelihara per bahasa.

---

## Lisensi

**AGPL-3.0** — Anda dapat menggunakan, memodifikasi, dan mendistribusikan SIDJUA secara
bebas selama Anda berbagi modifikasi di bawah lisensi yang sama. Kode sumber selalu tersedia
bagi pengguna deployment yang dihosting.

Lisensi enterprise tersedia untuk organisasi yang memerlukan deployment proprietary
tanpa kewajiban AGPL.
[contact@sidjua.com](mailto:contact@sidjua.com)
