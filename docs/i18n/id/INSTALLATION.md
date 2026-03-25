> Dokumen ini telah diterjemahkan oleh AI dari [asli bahasa Inggris](../INSTALLATION.md). Menemukan kesalahan? [Laporkan](https://github.com/GoetzKohlberg/sidjua/issues).

# Panduan Instalasi SIDJUA

SIDJUA versi: 1.0.0 | Lisensi: AGPL-3.0-only | Diperbarui: 2026-03-25

## Daftar Isi

1. [Matriks Dukungan Platform](#1-matriks-dukungan-platform)
2. [Prasyarat](#2-prasyarat)
3. [Metode Instalasi](#3-metode-instalasi)
4. [Tata Letak Direktori](#4-tata-letak-direktori)
5. [Variabel Lingkungan](#5-variabel-lingkungan)
6. [Konfigurasi Provider](#6-konfigurasi-provider)
7. [GUI Desktop (Opsional)](#7-gui-desktop-opsional)
8. [Sandboxing Agen](#8-sandboxing-agen)
9. [Pencarian Semantik (Opsional)](#9-pencarian-semantik-opsional)
10. [Pemecahan Masalah](#10-pemecahan-masalah)
11. [Referensi Volume Docker](#11-referensi-volume-docker)
12. [Peningkatan Versi](#12-peningkatan-versi)
13. [Langkah Selanjutnya](#13-langkah-selanjutnya)

---

## 1. Matriks Dukungan Platform

| Fitur | Linux | macOS | Windows WSL2 | Windows (natif) |
|---------|-------|-------|--------------|------------------|
| CLI + REST API | ✅ Penuh | ✅ Penuh | ✅ Penuh | ✅ Penuh |
| Docker | ✅ Penuh | ✅ Docker Desktop | ✅ Docker Desktop | ✅ Docker Desktop |
| Sandboxing (bubblewrap) | ✅ Penuh | ❌ Fallback ke `none` | ✅ Penuh (di dalam WSL2) | ❌ Fallback ke `none` |
| Web Management Console | ✅ Full | ✅ Full | ✅ Full | ✅ Full |
| Pencarian Semantik (Qdrant) | ✅ | ✅ | ✅ | ✅ |

**Catatan tentang bubblewrap:** Sandboxing namespace pengguna Linux. macOS dan Windows natif secara otomatis beralih ke mode sandbox `none` — tidak ada konfigurasi yang diperlukan.

---

## 2. Prasyarat

### Node.js >= 22.0.0

**Mengapa:** SIDJUA menggunakan modul ES, `fetch()` natif, dan `crypto.subtle` — semua memerlukan Node.js 22+.

**Ubuntu / Debian:**
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

**Fedora / RHEL / CentOS:**
```bash
curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
sudo dnf install -y nodejs
```

**Arch Linux:**
```bash
sudo pacman -S nodejs npm
```

**macOS (Homebrew):**
```bash
brew install node@22
echo 'export PATH="/opt/homebrew/opt/node@22/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

**macOS (installer .pkg):** Unduh dari [nodejs.org/en/download](https://nodejs.org/en/download).

**Windows (winget):**
```powershell
winget install OpenJS.NodeJS.LTS
```

**Windows (.msi):** Unduh dari [nodejs.org/en/download](https://nodejs.org/en/download).

**WSL2:** Gunakan instruksi Ubuntu/Debian di atas di dalam terminal WSL2 Anda.

Verifikasi:
```bash
node --version   # harus >= 22.0.0
npm --version    # harus >= 10.0.0
```

---

### Toolchain C/C++ (hanya untuk build dari sumber)

**Mengapa:** `better-sqlite3` dan `argon2` mengkompilasi addon natif Node.js selama `npm ci`. Pengguna Docker dapat melewati langkah ini.

**Ubuntu / Debian:**
```bash
sudo apt-get install -y python3 make g++ build-essential linux-headers-$(uname -r)
```

**Fedora / RHEL:**
```bash
sudo dnf groupinstall "Development Tools"
sudo dnf install python3
```

**Arch Linux:**
```bash
sudo pacman -S base-devel python
```

**macOS:**
```bash
xcode-select --install
```

**Windows:** Instal [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) dengan workload **Desktop development with C++**, kemudian:
```powershell
npm install --global windows-build-tools
```

**Alpine Linux:**
```bash
apk add python3 make g++ build-base linux-headers
```

---

### Docker >= 24 (opsional)

Hanya diperlukan untuk metode instalasi Docker. Plugin Docker Compose V2 (`docker compose`) harus tersedia.

**Linux:** Ikuti instruksi di [docs.docker.com/engine/install](https://docs.docker.com/engine/install/).
Docker Compose V2 sudah termasuk dalam Docker Engine >= 24.

**macOS / Windows:** Instal [Docker Desktop](https://www.docker.com/products/docker-desktop/) (sudah termasuk Docker Compose V2).

Verifikasi:
```bash
docker --version          # harus >= 24.0.0
docker compose version    # harus menampilkan v2.x.x
```

---

### Git

Versi terbaru apa pun. Instal melalui manajer paket OS Anda atau dari [git-scm.com](https://git-scm.com).

---

## 3. Metode Instalasi

### Metode A — Docker (Direkomendasikan)

Cara tercepat menuju instalasi SIDJUA yang berfungsi. Semua dependensi sudah terbundel dalam image.

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
docker compose up -d
```

Tunggu hingga layanan menjadi sehat (hingga ~60 detik pada build pertama):

```bash
docker compose ps
# NAME              STATUS
# sidjua            Up X seconds (healthy)
# sidjua-qdrant     Up X seconds (healthy)
```

Ambil kunci API yang dibuat otomatis:

```bash
docker compose exec sidjua cat /app/.system/api-key
```

Bootstrap tata kelola dari `divisions.yaml` Anda:

```bash
docker compose exec sidjua sidjua apply --verbose
```

Jalankan pemeriksaan kesehatan sistem:

```bash
docker compose exec sidjua sidjua selftest
```

**Catatan ARM64:** Image Docker dibangun di atas `node:22-alpine` yang mendukung `linux/amd64` dan `linux/arm64`. Raspberry Pi (64-bit) dan Mac Apple Silicon (melalui Docker Desktop) didukung secara langsung.

**Bubblewrap di Docker:** Untuk mengaktifkan sandboxing agen di dalam container, tambahkan `--cap-add=SYS_ADMIN` ke perintah Docker run Anda atau atur di `docker-compose.yml`:
```yaml
cap_add:
  - SYS_ADMIN
```

---

### Metode B — Instalasi Global npm

```bash
npm install -g sidjua
```

Jalankan wizard pengaturan interaktif (3 langkah: lokasi workspace, provider, agen pertama):
```bash
sidjua init
```

Untuk lingkungan CI atau container yang non-interaktif:
```bash
sidjua init --yes
```

Mulai panduan AI zero-config (tidak memerlukan kunci API):
```bash
sidjua chat guide
```

---

### Metode C — Build dari Sumber

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
npm ci
npm run build
```

Proses build menggunakan `tsup` untuk mengkompilasi `src/index.ts` menjadi:
- `dist/index.js` (ESM)
- `dist/index.cjs` (CommonJS)

Langkah pasca-build menyalin file locale i18n, peran default, divisi, dan template basis pengetahuan ke dalam `dist/`.

Jalankan dari sumber:
```bash
node dist/index.js --help
```

Jalankan test suite:
```bash
npm test                    # semua tes
npm run test:coverage       # dengan laporan cakupan
npx tsc --noEmit            # pemeriksaan tipe saja
```

---

## 4. Tata Letak Direktori

### Jalur Deployment Docker

| Jalur | Volume Docker | Tujuan | Dikelola Oleh |
|------|---------------|---------|------------|
| `/app/dist/` | Layer image | Aplikasi yang dikompilasi | SIDJUA |
| `/app/node_modules/` | Layer image | Dependensi Node.js | SIDJUA |
| `/app/system/` | Layer image | Default dan template bawaan | SIDJUA |
| `/app/defaults/` | Layer image | File konfigurasi default | SIDJUA |
| `/app/docs/` | Layer image | Dokumentasi yang dibundel | SIDJUA |
| `/app/data/` | `sidjua-data` | Database SQLite, backup, koleksi pengetahuan | Pengguna |
| `/app/config/` | `sidjua-config` | `divisions.yaml` dan konfigurasi khusus | Pengguna |
| `/app/logs/` | `sidjua-logs` | File log terstruktur | Pengguna |
| `/app/.system/` | `sidjua-system` | Kunci API, status pembaruan, kunci proses | Dikelola SIDJUA |
| `/app/agents/` | `sidjua-workspace` | Definisi agen, kemampuan, template | Pengguna |
| `/app/governance/` | `sidjua-governance` | Jejak audit, snapshot tata kelola | Pengguna |

---

### Jalur Instalasi Manual / npm

Setelah `sidjua init`, workspace Anda terorganisasi sebagai:

```
~/sidjua-workspace/           # atau SIDJUA_CONFIG_DIR
├── divisions.yaml            # Konfigurasi tata kelola Anda
├── .sidjua/                  # Status internal (WAL, buffer telemetri)
│   └── telemetry.db
├── data/
│   ├── sidjua.db             # Database utama (agen, tugas, audit, biaya)
│   ├── knowledge/            # Database pengetahuan per agen
│   │   └── <agent-id>.db
│   └── backups/              # Arsip backup bertanda tangan HMAC
├── agents/                   # Direktori kemampuan agen
├── governance/               # Jejak audit (hanya tambah)
├── logs/                     # Log aplikasi
└── system/                   # Status runtime
```

---

### Database SQLite

| Database | Jalur | Konten |
|----------|------|----------|
| Utama | `data/sidjua.db` | Agen, tugas, biaya, snapshot tata kelola, kunci API, log audit |
| Telemetri | `.sidjua/telemetry.db` | Laporan kesalahan opt-in opsional (PII diredaksi) |
| Pengetahuan | `data/knowledge/<agent-id>.db` | Embedding vektor per agen dan indeks BM25 |

Database SQLite adalah file tunggal, lintas platform, dan portabel. Cadangkan dengan `sidjua backup create`.

---

## 5. Variabel Lingkungan

Salin `.env.example` ke `.env` dan sesuaikan. Semua variabel bersifat opsional kecuali disebutkan.

### Server

| Variabel | Default | Deskripsi |
|----------|---------|-------------|
| `SIDJUA_PORT` | `3000` | Port yang didengarkan REST API |
| `SIDJUA_HOST` | `127.0.0.1` | Alamat bind REST API. Gunakan `0.0.0.0` untuk akses jarak jauh |
| `NODE_ENV` | `production` | Mode runtime (`production` atau `development`) |
| `SIDJUA_API_KEY` | Dibuat otomatis | Token bearer REST API. Dibuat otomatis saat pertama kali dimulai jika tidak ada |
| `SIDJUA_MAX_BODY_SIZE` | `2097152` (2 MiB) | Ukuran maksimum body permintaan masuk dalam byte |

### Override Direktori

| Variabel | Default | Deskripsi |
|----------|---------|-------------|
| `SIDJUA_DATA_DIR` | `<workspace>/data` | Override lokasi direktori data |
| `SIDJUA_CONFIG_DIR` | `<workspace>` | Override lokasi direktori konfigurasi |
| `SIDJUA_LOG_DIR` | `<workspace>/logs` | Override lokasi direktori log |

### Pencarian Semantik

| Variabel | Default | Deskripsi |
|----------|---------|-------------|
| `SIDJUA_QDRANT_URL` | `http://localhost:6333` | Endpoint database vektor Qdrant. Default Docker: `http://qdrant:6333` |
| `OPENAI_API_KEY` | — | Diperlukan untuk embedding OpenAI `text-embedding-3-large` |
| `SIDJUA_CF_ACCOUNT_ID` | — | ID akun Cloudflare untuk embedding gratis |
| `SIDJUA_CF_TOKEN` | — | Token API Cloudflare untuk embedding gratis |

### Provider LLM

| Variabel | Provider |
|----------|----------|
| `ANTHROPIC_API_KEY` | Anthropic (Claude) |
| `OPENAI_API_KEY` | OpenAI (GPT-4, embedding) |
| `GOOGLE_AI_API_KEY` | Google AI (Gemini) |
| `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` | Cloudflare Workers AI (tier gratis) |
| `GROQ_API_KEY` | Groq (inferensi cepat, tersedia tier gratis) |
| `DEEPSEEK_API_KEY` | DeepSeek |

---

## 6. Konfigurasi Provider

### Opsi Tanpa Konfigurasi

`sidjua chat guide` berfungsi tanpa kunci API apa pun. Ini terhubung ke Cloudflare Workers AI melalui proxy SIDJUA. Dibatasi kecepatan tetapi cocok untuk evaluasi dan orientasi.

### Menambahkan Provider Pertama Anda

**Groq (tier gratis, tidak perlu kartu kredit):**
```bash
sidjua key set groq <your-groq-api-key>
sidjua provider list
```
Dapatkan kunci gratis di [console.groq.com](https://console.groq.com).

**Anthropic (direkomendasikan untuk produksi):**
```bash
export ANTHROPIC_API_KEY=sk-ant-...
sidjua key set anthropic $ANTHROPIC_API_KEY
```

**Ollama (deployment air-gap / lokal):**
```bash
sidjua provider add-custom \
  --id ollama \
  --name "Ollama (local)" \
  --base-url http://localhost:11434/v1 \
  --model llama3.2
```

Validasi semua provider yang dikonfigurasi:
```bash
sidjua setup --validate
```

---

## 7. Web Management Console (Optional)

The SIDJUA Web Management Console is a React/TypeScript application served via the Hono REST API. It is optional — the CLI and REST API work without it.

No additional installation steps are required. The web console is served automatically when the SIDJUA API server is running.

### Accessing the Console

Once the API server is started, open a browser at:

```
http://localhost:PORT
```

Where `PORT` is the API server port (default: `4000`). The console requires authentication using your API key or a scoped token.

---

## 8. Sandboxing Agen

SIDJUA menggunakan antarmuka `SandboxProvider` yang dapat dipasang. Sandbox membungkus eksekusi kemampuan agen dalam isolasi proses tingkat OS.

### Dukungan Sandbox berdasarkan Platform

| Platform | Provider Sandbox | Catatan |
|----------|-----------------|-------|
| Linux (natif) | `bubblewrap` | Isolasi namespace pengguna penuh |
| Docker (container Linux) | `bubblewrap` | Memerlukan `--cap-add=SYS_ADMIN` |
| macOS | `none` (fallback otomatis) | macOS tidak mendukung namespace pengguna Linux |
| Windows WSL2 | `bubblewrap` | Instal seperti di Linux di dalam WSL2 |
| Windows (natif) | `none` (fallback otomatis) | |

### Menginstal bubblewrap (Linux)

**Ubuntu / Debian:**
```bash
sudo apt-get install -y bubblewrap socat
```

**Fedora / RHEL:**
```bash
sudo dnf install -y bubblewrap socat
```

**Arch Linux:**
```bash
sudo pacman -S bubblewrap socat
```

### Konfigurasi

Di `divisions.yaml`:
```yaml
governance:
  sandbox: bubblewrap    # atau: none
```

Verifikasi ketersediaan sandbox:
```bash
sidjua sandbox check
```

---

## 9. Pencarian Semantik (Opsional)

Pencarian semantik mendukung `sidjua memory search` dan pengambilan pengetahuan agen. Ini memerlukan database vektor Qdrant dan provider embedding.

### Profil Docker Compose

`docker-compose.yml` yang disertakan memiliki profil `semantic-search`:
```bash
docker compose --profile semantic-search up -d
```
Ini memulai container Qdrant bersama SIDJUA.

### Qdrant Mandiri

```bash
docker run -d \
  --name sidjua-qdrant \
  -p 6333:6333 \
  -v qdrant-storage:/qdrant/storage \
  qdrant/qdrant:v1.13.2
```

Atur endpoint:
```bash
export SIDJUA_QDRANT_URL=http://localhost:6333
```

### Tanpa Qdrant

Jika Qdrant tidak tersedia, `sidjua memory import` dan `sidjua memory search` dinonaktifkan. Semua fitur SIDJUA lainnya (CLI, REST API, eksekusi agen, tata kelola, audit) bekerja secara normal. Sistem beralih ke pencarian kata kunci BM25 untuk kueri pengetahuan apa pun.

---

## 10. Pemecahan Masalah

### Semua Platform

**`npm ci` gagal dengan kesalahan `node-pre-gyp` atau `node-gyp`:**
```
gyp ERR! build error
```
Instal toolchain C/C++ (lihat bagian Prasyarat). Di Ubuntu: `sudo apt-get install -y python3 make g++ build-essential`.

**`Cannot find divisions.yaml`:**
Periksa `SIDJUA_CONFIG_DIR`. File harus berada di `$SIDJUA_CONFIG_DIR/divisions.yaml`. Jalankan `sidjua init` untuk membuat struktur workspace.

**REST API mengembalikan 401 Unauthorized:**
Verifikasi header `Authorization: Bearer <key>`. Ambil kunci yang dibuat otomatis dengan:
```bash
cat ~/.sidjua/.system/api-key          # instalasi manual
docker compose exec sidjua cat /app/.system/api-key  # Docker
```

**Port 3000 sudah digunakan:**
```bash
SIDJUA_PORT=3001 sidjua server start
# atau atur di .env: SIDJUA_PORT=3001
```

---

### Ubuntu / Debian

**`better-sqlite3` gagal dikompilasi karena `futex.h` tidak ditemukan:**
```bash
sudo apt-get install -y linux-headers-$(uname -r)
```

---

### Fedora / RHEL

**SELinux memblokir mount volume Docker:**
```yaml
# Tambahkan label :Z untuk konteks SELinux
volumes:
  - ./my-config:/app/config:Z
```
Atau atur konteks SELinux secara manual:
```bash
chcon -Rt svirt_sandbox_file_t ./my-config
```

---

### Arch Linux

**Versi Node.js terlalu lama:**
Gunakan `nvm` untuk menginstal Node.js 22:
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
nvm install 22
nvm use 22
```

---

### macOS

**`xcrun: error: invalid active developer path`:**
```bash
xcode-select --install
```

**Docker Desktop kehabisan memori:**
Buka Docker Desktop → Settings → Resources → Memory. Tingkatkan ke setidaknya 4 GB.

**Apple Silicon — ketidakcocokan arsitektur:**
Verifikasi bahwa instalasi Node.js Anda adalah ARM64 natif (bukan Rosetta):
```bash
node -e "console.log(process.arch)"
# diharapkan: arm64
```
Jika mencetak `x64`, instal ulang Node.js menggunakan installer ARM64 dari nodejs.org.

---

### Windows (natif)

**`MSBuild` atau `cl.exe` tidak ditemukan:**
Instal [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) dan pilih workload **Desktop development with C++**. Kemudian jalankan:
```powershell
npm install --global windows-build-tools
```

**Kesalahan jalur panjang (`ENAMETOOLONG`):**
Aktifkan dukungan jalur panjang di registri Windows:
```powershell
# Jalankan sebagai Administrator
Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" `
  -Name LongPathsEnabled -Value 1
```

**Perintah `sidjua` tidak ditemukan setelah `npm install -g`:**
Tambahkan direktori bin global npm ke PATH Anda:
```powershell
npm config get prefix  # menampilkan mis. C:\Users\you\AppData\Roaming\npm
# Tambahkan jalur itu ke System Environment Variables → Path
```

---

### Windows WSL2

**Docker gagal dimulai di dalam WSL2:**
Buka Docker Desktop → Settings → General → aktifkan **Use the WSL 2 based engine**.
Kemudian restart Docker Desktop dan terminal WSL2 Anda.

**Kesalahan izin pada file di bawah `/mnt/c/`:**
Volume Windows NTFS yang dipasang di WSL2 memiliki izin terbatas. Pindahkan workspace Anda ke jalur natif Linux:
```bash
mkdir ~/sidjua-workspace
cd ~/sidjua-workspace
sidjua init
```

---

### Raspberry Pi / ARM64

**`npm ci` sangat lambat (5–10 menit):**
Ini normal. Kompilasi addon natif di ARM64 memakan waktu lebih lama. Pertimbangkan untuk menggunakan image Docker sebagai gantinya:
```bash
docker pull sidjua/sidjua:latest-arm64
```

**Kehabisan memori saat build:**
Tambahkan ruang swap:
```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

---

## 11. Referensi Volume Docker

### Volume Bernama

| Nama Volume | Jalur Container | Tujuan |
|-------------|---------------|---------|
| `sidjua-data` | `/app/data` | Database SQLite, arsip backup, koleksi pengetahuan |
| `sidjua-config` | `/app/config` | `divisions.yaml`, konfigurasi khusus |
| `sidjua-logs` | `/app/logs` | Log aplikasi terstruktur |
| `sidjua-system` | `/app/.system` | Kunci API, status pembaruan, file kunci proses |
| `sidjua-workspace` | `/app/agents` | Direktori kemampuan agen, definisi, template |
| `sidjua-governance` | `/app/governance` | Jejak audit yang tidak dapat diubah, snapshot tata kelola |
| `qdrant-storage` | `/qdrant/storage` | Indeks vektor Qdrant (hanya profil pencarian semantik) |

### Menggunakan Direktori Host

Untuk memasang `divisions.yaml` Anda sendiri alih-alih mengedit di dalam container:

```yaml
# docker-compose.override.yml
services:
  sidjua:
    volumes:
      - ./my-config:/app/config   # menggantikan volume bernama sidjua-config
```

### Backup

```bash
sidjua backup create                    # dari dalam container
# atau
docker compose exec sidjua sidjua backup create
```

Backup adalah arsip bertanda tangan HMAC yang disimpan di `/app/data/backups/`.

---

## 12. Peningkatan Versi

### Docker

```bash
git pull
docker compose build --no-cache
docker compose up -d
docker compose exec sidjua sidjua apply    # jalankan migrasi skema
```

`sidjua apply` bersifat idempoten — selalu aman untuk dijalankan ulang setelah peningkatan.

### Instalasi Global npm

```bash
npm update -g sidjua
sidjua apply    # jalankan migrasi skema
```

### Build dari Sumber

```bash
git pull
npm ci
npm run build
node dist/index.js apply    # jalankan migrasi skema
```

### Rollback

SIDJUA membuat snapshot tata kelola sebelum setiap `sidjua apply`. Untuk mengembalikan:

```bash
sidjua rollback list
sidjua rollback <version>
```

---

## 13. Langkah Selanjutnya

| Sumber Daya | Perintah / Tautan |
|----------|---------------|
| Mulai Cepat | [docs/QUICK-START.md](QUICK-START.md) |
| Referensi CLI | [docs/CLI-REFERENCE.md](CLI-REFERENCE.md) |
| Contoh Tata Kelola | [docs/GOVERNANCE-EXAMPLES.md](GOVERNANCE-EXAMPLES.md) |
| Panduan Provider LLM Gratis | [docs/FREE-LLM-PROVIDER-GUIDE.md](FREE-LLM-PROVIDER-GUIDE.md) |
| Pemecahan Masalah | [docs/TROUBLESHOOTING.md](TROUBLESHOOTING.md) |

Perintah pertama yang perlu dijalankan setelah instalasi:

```bash
sidjua chat guide    # panduan AI zero-config — tidak perlu kunci API
sidjua selftest      # pemeriksaan kesehatan sistem (7 kategori, skor 0-100)
sidjua apply         # provisioning agen dari divisions.yaml
```
