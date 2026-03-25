> Dokumen ini telah diterjemahkan oleh AI daripada [asal bahasa Inggeris](../INSTALLATION.md). Jumpa kesilapan? [Laporkan](https://github.com/GoetzKohlberg/sidjua/issues).

# Panduan Pemasangan SIDJUA

Versi SIDJUA: 1.0.0 | Lesen: AGPL-3.0-only | Dikemas kini: 2026-03-25

## Jadual Kandungan

1. [Matriks Sokongan Platform](#1-matriks-sokongan-platform)
2. [Prasyarat](#2-prasyarat)
3. [Kaedah Pemasangan](#3-kaedah-pemasangan)
4. [Susun Atur Direktori](#4-susun-atur-direktori)
5. [Pemboleh Ubah Persekitaran](#5-pemboleh-ubah-persekitaran)
6. [Konfigurasi Provider](#6-konfigurasi-provider)
7. [GUI Desktop (Pilihan)](#7-gui-desktop-pilihan)
8. [Sandboxing Ejen](#8-sandboxing-ejen)
9. [Carian Semantik (Pilihan)](#9-carian-semantik-pilihan)
10. [Penyelesaian Masalah](#10-penyelesaian-masalah)
11. [Rujukan Volume Docker](#11-rujukan-volume-docker)
12. [Naik Taraf](#12-naik-taraf)
13. [Langkah Seterusnya](#13-langkah-seterusnya)

---

## 1. Matriks Sokongan Platform

| Ciri | Linux | macOS | Windows WSL2 | Windows (asli) |
|---------|-------|-------|--------------|------------------|
| CLI + REST API | ✅ Penuh | ✅ Penuh | ✅ Penuh | ✅ Penuh |
| Docker | ✅ Penuh | ✅ Docker Desktop | ✅ Docker Desktop | ✅ Docker Desktop |
| Sandboxing (bubblewrap) | ✅ Penuh | ❌ Fallback ke `none` | ✅ Penuh (dalam WSL2) | ❌ Fallback ke `none` |
| Web Management Console | ✅ Full | ✅ Full | ✅ Full | ✅ Full |
| Carian Semantik (Qdrant) | ✅ | ✅ | ✅ | ✅ |

**Nota tentang bubblewrap:** Sandboxing ruang nama pengguna Linux. macOS dan Windows asli secara automatik beralih kepada mod sandbox `none` — tiada konfigurasi diperlukan.

---

## 2. Prasyarat

### Node.js >= 22.0.0

**Mengapa:** SIDJUA menggunakan modul ES, `fetch()` asli, dan `crypto.subtle` — semuanya memerlukan Node.js 22+.

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

**macOS (pemasang .pkg):** Muat turun dari [nodejs.org/en/download](https://nodejs.org/en/download).

**Windows (winget):**
```powershell
winget install OpenJS.NodeJS.LTS
```

**Windows (.msi):** Muat turun dari [nodejs.org/en/download](https://nodejs.org/en/download).

**WSL2:** Gunakan arahan Ubuntu/Debian di atas dalam terminal WSL2 anda.

Sahkan:
```bash
node --version   # mesti >= 22.0.0
npm --version    # mesti >= 10.0.0
```

---

### Toolchain C/C++ (hanya untuk binaan sumber)

**Mengapa:** `better-sqlite3` dan `argon2` mengkompil tambahan Node.js asli semasa `npm ci`. Pengguna Docker boleh melewati langkah ini.

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

**Windows:** Pasang [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) dengan beban kerja **Desktop development with C++**, kemudian:
```powershell
npm install --global windows-build-tools
```

**Alpine Linux:**
```bash
apk add python3 make g++ build-base linux-headers
```

---

### Docker >= 24 (pilihan)

Diperlukan hanya untuk kaedah pemasangan Docker. Plugin Docker Compose V2 (`docker compose`) mesti tersedia.

**Linux:** Ikuti arahan di [docs.docker.com/engine/install](https://docs.docker.com/engine/install/).
Docker Compose V2 disertakan bersama Docker Engine >= 24.

**macOS / Windows:** Pasang [Docker Desktop](https://www.docker.com/products/docker-desktop/) (termasuk Docker Compose V2).

Sahkan:
```bash
docker --version          # mesti >= 24.0.0
docker compose version    # mesti menunjukkan v2.x.x
```

---

### Git

Mana-mana versi terkini. Pasang melalui pengurus pakej OS anda atau dari [git-scm.com](https://git-scm.com).

---

## 3. Kaedah Pemasangan

### Kaedah A — Docker (Disyorkan)

Laluan terpantas menuju pemasangan SIDJUA yang berfungsi. Semua kebergantungan dibundel dalam imej.

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
docker compose up -d
```

Tunggu sehingga perkhidmatan menjadi sihat (sehingga ~60 saat pada binaan pertama):

```bash
docker compose ps
# NAME              STATUS
# sidjua            Up X seconds (healthy)
# sidjua-qdrant     Up X seconds (healthy)
```

Dapatkan kunci API yang dijana secara automatik:

```bash
docker compose exec sidjua cat /app/.system/api-key
```

Bootstrap tadbir urus dari `divisions.yaml` anda:

```bash
docker compose exec sidjua sidjua apply --verbose
```

Jalankan pemeriksaan kesihatan sistem:

```bash
docker compose exec sidjua sidjua selftest
```

**Nota ARM64:** Imej Docker dibina di atas `node:22-alpine` yang menyokong `linux/amd64` dan `linux/arm64`. Raspberry Pi (64-bit) dan Mac Apple Silicon (melalui Docker Desktop) disokong terus dari kotak.

**Bubblewrap dalam Docker:** Untuk mendayakan sandboxing ejen dalam kontena, tambah `--cap-add=SYS_ADMIN` pada arahan Docker run anda atau tetapkan dalam `docker-compose.yml`:
```yaml
cap_add:
  - SYS_ADMIN
```

---

### Kaedah B — Pemasangan Global npm

```bash
npm install -g sidjua
```

Jalankan wizard persediaan interaktif (3 langkah: lokasi ruang kerja, provider, ejen pertama):
```bash
sidjua init
```

Untuk persekitaran CI atau kontena yang tidak interaktif:
```bash
sidjua init --yes
```

Mulakan panduan AI zero-config (tiada kunci API diperlukan):
```bash
sidjua chat guide
```

---

### Kaedah C — Binaan Sumber

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
npm ci
npm run build
```

Proses binaan menggunakan `tsup` untuk mengkompil `src/index.ts` menjadi:
- `dist/index.js` (ESM)
- `dist/index.cjs` (CommonJS)

Langkah pasca-binaan menyalin fail locale i18n, peranan lalai, bahagian, dan templat pangkalan pengetahuan ke dalam `dist/`.

Jalankan dari sumber:
```bash
node dist/index.js --help
```

Jalankan suite ujian:
```bash
npm test                    # semua ujian
npm run test:coverage       # dengan laporan liputan
npx tsc --noEmit            # semakan jenis sahaja
```

---

## 4. Susun Atur Direktori

### Laluan Penggunaan Docker

| Laluan | Volume Docker | Tujuan | Diurus Oleh |
|------|---------------|---------|------------|
| `/app/dist/` | Lapisan imej | Aplikasi yang dikompil | SIDJUA |
| `/app/node_modules/` | Lapisan imej | Kebergantungan Node.js | SIDJUA |
| `/app/system/` | Lapisan imej | Lalai dan templat terbina dalam | SIDJUA |
| `/app/defaults/` | Lapisan imej | Fail konfigurasi lalai | SIDJUA |
| `/app/docs/` | Lapisan imej | Dokumentasi yang dibundel | SIDJUA |
| `/app/data/` | `sidjua-data` | Pangkalan data SQLite, sandaran, koleksi pengetahuan | Pengguna |
| `/app/config/` | `sidjua-config` | `divisions.yaml` dan konfigurasi tersuai | Pengguna |
| `/app/logs/` | `sidjua-logs` | Fail log berstruktur | Pengguna |
| `/app/.system/` | `sidjua-system` | Kunci API, status kemas kini, kunci proses | Diurus SIDJUA |
| `/app/agents/` | `sidjua-workspace` | Definisi ejen, kemahiran, templat | Pengguna |
| `/app/governance/` | `sidjua-governance` | Jejak audit, syot kilat tadbir urus | Pengguna |

---

### Laluan Pemasangan Manual / npm

Selepas `sidjua init`, ruang kerja anda disusun sebagai:

```
~/sidjua-workspace/           # atau SIDJUA_CONFIG_DIR
├── divisions.yaml            # Konfigurasi tadbir urus anda
├── .sidjua/                  # Status dalaman (WAL, penimbal telemetri)
│   └── telemetry.db
├── data/
│   ├── sidjua.db             # Pangkalan data utama (ejen, tugas, audit, kos)
│   ├── knowledge/            # Pangkalan data pengetahuan setiap ejen
│   │   └── <agent-id>.db
│   └── backups/              # Arkib sandaran bertandatangan HMAC
├── agents/                   # Direktori kemahiran ejen
├── governance/               # Jejak audit (tambah sahaja)
├── logs/                     # Log aplikasi
└── system/                   # Status masa jalan
```

---

### Pangkalan Data SQLite

| Pangkalan Data | Laluan | Kandungan |
|----------|------|----------|
| Utama | `data/sidjua.db` | Ejen, tugas, kos, syot kilat tadbir urus, kunci API, log audit |
| Telemetri | `.sidjua/telemetry.db` | Laporan ralat opt-in pilihan (PII diredaksi) |
| Pengetahuan | `data/knowledge/<agent-id>.db` | Penyematan vektor setiap ejen dan indeks BM25 |

Pangkalan data SQLite adalah fail tunggal, merentas platform, dan mudah alih. Sandannya dengan `sidjua backup create`.

---

## 5. Pemboleh Ubah Persekitaran

Salin `.env.example` ke `.env` dan sesuaikan. Semua pemboleh ubah adalah pilihan kecuali dinyatakan.

### Pelayan

| Pemboleh Ubah | Lalai | Penerangan |
|----------|---------|-------------|
| `SIDJUA_PORT` | `3000` | Port mendengar REST API |
| `SIDJUA_HOST` | `127.0.0.1` | Alamat bind REST API. Gunakan `0.0.0.0` untuk akses jauh |
| `NODE_ENV` | `production` | Mod masa jalan (`production` atau `development`) |
| `SIDJUA_API_KEY` | Dijana automatik | Token pembawa REST API. Dicipta secara automatik pada permulaan pertama jika tiada |
| `SIDJUA_MAX_BODY_SIZE` | `2097152` (2 MiB) | Saiz maksimum badan permintaan masuk dalam bait |

### Pengatasan Direktori

| Pemboleh Ubah | Lalai | Penerangan |
|----------|---------|-------------|
| `SIDJUA_DATA_DIR` | `<workspace>/data` | Ganti lokasi direktori data |
| `SIDJUA_CONFIG_DIR` | `<workspace>` | Ganti lokasi direktori konfigurasi |
| `SIDJUA_LOG_DIR` | `<workspace>/logs` | Ganti lokasi direktori log |

### Carian Semantik

| Pemboleh Ubah | Lalai | Penerangan |
|----------|---------|-------------|
| `SIDJUA_QDRANT_URL` | `http://localhost:6333` | Titik akhir pangkalan data vektor Qdrant. Lalai Docker: `http://qdrant:6333` |
| `OPENAI_API_KEY` | — | Diperlukan untuk penyematan OpenAI `text-embedding-3-large` |
| `SIDJUA_CF_ACCOUNT_ID` | — | ID akaun Cloudflare untuk penyematan percuma |
| `SIDJUA_CF_TOKEN` | — | Token API Cloudflare untuk penyematan percuma |

### Provider LLM

| Pemboleh Ubah | Provider |
|----------|----------|
| `ANTHROPIC_API_KEY` | Anthropic (Claude) |
| `OPENAI_API_KEY` | OpenAI (GPT-4, penyematan) |
| `GOOGLE_AI_API_KEY` | Google AI (Gemini) |
| `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` | Cloudflare Workers AI (peringkat percuma) |
| `GROQ_API_KEY` | Groq (inferens pantas, peringkat percuma tersedia) |
| `DEEPSEEK_API_KEY` | DeepSeek |

---

## 6. Konfigurasi Provider

### Pilihan Tanpa Konfigurasi

`sidjua chat guide` berfungsi tanpa sebarang kunci API. Ia menyambung ke Cloudflare Workers AI melalui proksi SIDJUA. Kadar terhad tetapi sesuai untuk penilaian dan orientasi.

### Menambah Provider Pertama Anda

**Groq (peringkat percuma, tiada kad kredit):**
```bash
sidjua key set groq <your-groq-api-key>
sidjua provider list
```
Dapatkan kunci percuma di [console.groq.com](https://console.groq.com).

**Anthropic (disyorkan untuk pengeluaran):**
```bash
export ANTHROPIC_API_KEY=sk-ant-...
sidjua key set anthropic $ANTHROPIC_API_KEY
```

**Ollama (penggunaan air-gap / tempatan):**
```bash
sidjua provider add-custom \
  --id ollama \
  --name "Ollama (local)" \
  --base-url http://localhost:11434/v1 \
  --model llama3.2
```

Sahkan semua provider yang dikonfigurasi:
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

## 8. Sandboxing Ejen

SIDJUA menggunakan antara muka `SandboxProvider` yang boleh dipasang. Sandbox membungkus pelaksanaan kemahiran ejen dalam pengasingan proses peringkat OS.

### Sokongan Sandbox mengikut Platform

| Platform | Provider Sandbox | Nota |
|----------|-----------------|-------|
| Linux (asli) | `bubblewrap` | Pengasingan ruang nama pengguna penuh |
| Docker (kontena Linux) | `bubblewrap` | Memerlukan `--cap-add=SYS_ADMIN` |
| macOS | `none` (fallback automatik) | macOS tidak menyokong ruang nama pengguna Linux |
| Windows WSL2 | `bubblewrap` | Pasang seperti di Linux dalam WSL2 |
| Windows (asli) | `none` (fallback automatik) | |

### Memasang bubblewrap (Linux)

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

Dalam `divisions.yaml`:
```yaml
governance:
  sandbox: bubblewrap    # atau: none
```

Sahkan ketersediaan sandbox:
```bash
sidjua sandbox check
```

---

## 9. Carian Semantik (Pilihan)

Carian semantik menggerakkan `sidjua memory search` dan pengambilan pengetahuan ejen. Ia memerlukan pangkalan data vektor Qdrant dan provider penyematan.

### Profil Docker Compose

`docker-compose.yml` yang disertakan mempunyai profil `semantic-search`:
```bash
docker compose --profile semantic-search up -d
```
Ini memulakan kontena Qdrant bersama SIDJUA.

### Qdrant Bebas

```bash
docker run -d \
  --name sidjua-qdrant \
  -p 6333:6333 \
  -v qdrant-storage:/qdrant/storage \
  qdrant/qdrant:v1.13.2
```

Tetapkan titik akhir:
```bash
export SIDJUA_QDRANT_URL=http://localhost:6333
```

### Tanpa Qdrant

Jika Qdrant tidak tersedia, `sidjua memory import` dan `sidjua memory search` dilumpuhkan. Semua ciri SIDJUA lain (CLI, REST API, pelaksanaan ejen, tadbir urus, audit) berfungsi seperti biasa. Sistem beralih ke carian kata kunci BM25 untuk sebarang pertanyaan pengetahuan.

---

## 10. Penyelesaian Masalah

### Semua Platform

**`npm ci` gagal dengan ralat `node-pre-gyp` atau `node-gyp`:**
```
gyp ERR! build error
```
Pasang toolchain C/C++ (lihat bahagian Prasyarat). Di Ubuntu: `sudo apt-get install -y python3 make g++ build-essential`.

**`Cannot find divisions.yaml`:**
Semak `SIDJUA_CONFIG_DIR`. Fail mesti berada di `$SIDJUA_CONFIG_DIR/divisions.yaml`. Jalankan `sidjua init` untuk mencipta struktur ruang kerja.

**REST API mengembalikan 401 Unauthorized:**
Sahkan pengepala `Authorization: Bearer <key>`. Dapatkan kunci yang dijana secara automatik dengan:
```bash
cat ~/.sidjua/.system/api-key          # pemasangan manual
docker compose exec sidjua cat /app/.system/api-key  # Docker
```

**Port 3000 sudah digunakan:**
```bash
SIDJUA_PORT=3001 sidjua server start
# atau tetapkan dalam .env: SIDJUA_PORT=3001
```

---

### Ubuntu / Debian

**`better-sqlite3` gagal dikompil dengan `futex.h` tidak ditemui:**
```bash
sudo apt-get install -y linux-headers-$(uname -r)
```

---

### Fedora / RHEL

**SELinux menyekat pemasangan volume Docker:**
```yaml
# Tambah label :Z untuk konteks SELinux
volumes:
  - ./my-config:/app/config:Z
```
Atau tetapkan konteks SELinux secara manual:
```bash
chcon -Rt svirt_sandbox_file_t ./my-config
```

---

### Arch Linux

**Versi Node.js terlalu lama:**
Gunakan `nvm` untuk memasang Node.js 22:
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
Buka Docker Desktop → Settings → Resources → Memory. Tingkatkan kepada sekurang-kurangnya 4 GB.

**Apple Silicon — ketidakpadanan seni bina:**
Sahkan pemasangan Node.js anda adalah ARM64 asli (bukan Rosetta):
```bash
node -e "console.log(process.arch)"
# dijangka: arm64
```
Jika ia mencetak `x64`, pasang semula Node.js menggunakan pemasang ARM64 dari nodejs.org.

---

### Windows (asli)

**`MSBuild` atau `cl.exe` tidak ditemui:**
Pasang [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) dan pilih beban kerja **Desktop development with C++**. Kemudian jalankan:
```powershell
npm install --global windows-build-tools
```

**Ralat laluan panjang (`ENAMETOOLONG`):**
Dayakan sokongan laluan panjang dalam pendaftaran Windows:
```powershell
# Jalankan sebagai Pentadbir
Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" `
  -Name LongPathsEnabled -Value 1
```

**Arahan `sidjua` tidak ditemui selepas `npm install -g`:**
Tambah direktori bin global npm ke PATH anda:
```powershell
npm config get prefix  # menunjukkan cth. C:\Users\you\AppData\Roaming\npm
# Tambah laluan itu ke System Environment Variables → Path
```

---

### Windows WSL2

**Docker gagal dimulakan dalam WSL2:**
Buka Docker Desktop → Settings → General → dayakan **Use the WSL 2 based engine**.
Kemudian mulakan semula Docker Desktop dan terminal WSL2 anda.

**Ralat kebenaran pada fail di bawah `/mnt/c/`:**
Volume Windows NTFS yang dipasang dalam WSL2 mempunyai kebenaran terhad. Pindahkan ruang kerja anda ke laluan asli Linux:
```bash
mkdir ~/sidjua-workspace
cd ~/sidjua-workspace
sidjua init
```

---

### Raspberry Pi / ARM64

**`npm ci` sangat perlahan (5–10 minit):**
Ini adalah normal. Pengkompilan tambahan asli pada ARM64 mengambil masa lebih lama. Pertimbangkan untuk menggunakan imej Docker sebagai gantinya:
```bash
docker pull sidjua/sidjua:latest-arm64
```

**Kehabisan memori semasa binaan:**
Tambah ruang swap:
```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

---

## 11. Rujukan Volume Docker

### Volume Bernama

| Nama Volume | Laluan Kontena | Tujuan |
|-------------|---------------|---------|
| `sidjua-data` | `/app/data` | Pangkalan data SQLite, arkib sandaran, koleksi pengetahuan |
| `sidjua-config` | `/app/config` | `divisions.yaml`, konfigurasi tersuai |
| `sidjua-logs` | `/app/logs` | Log aplikasi berstruktur |
| `sidjua-system` | `/app/.system` | Kunci API, status kemas kini, fail kunci proses |
| `sidjua-workspace` | `/app/agents` | Direktori kemahiran ejen, definisi, templat |
| `sidjua-governance` | `/app/governance` | Jejak audit tidak berubah, syot kilat tadbir urus |
| `qdrant-storage` | `/qdrant/storage` | Indeks vektor Qdrant (hanya profil carian semantik) |

### Menggunakan Direktori Hos

Untuk memasang `divisions.yaml` anda sendiri daripada mengedit dalam kontena:

```yaml
# docker-compose.override.yml
services:
  sidjua:
    volumes:
      - ./my-config:/app/config   # menggantikan volume bernama sidjua-config
```

### Sandaran

```bash
sidjua backup create                    # dari dalam kontena
# atau
docker compose exec sidjua sidjua backup create
```

Sandaran adalah arkib bertandatangan HMAC yang disimpan dalam `/app/data/backups/`.

---

## 12. Naik Taraf

### Docker

```bash
git pull
docker compose build --no-cache
docker compose up -d
docker compose exec sidjua sidjua apply    # jalankan migrasi skema
```

`sidjua apply` adalah idempoten — sentiasa selamat untuk dijalankan semula selepas naik taraf.

### Pemasangan Global npm

```bash
npm update -g sidjua
sidjua apply    # jalankan migrasi skema
```

### Binaan Sumber

```bash
git pull
npm ci
npm run build
node dist/index.js apply    # jalankan migrasi skema
```

### Rollback

SIDJUA mencipta syot kilat tadbir urus sebelum setiap `sidjua apply`. Untuk kembali:

```bash
sidjua rollback list
sidjua rollback <version>
```

---

## 13. Langkah Seterusnya

| Sumber | Arahan / Pautan |
|----------|---------------|
| Mula Pantas | [docs/QUICK-START.md](QUICK-START.md) |
| Rujukan CLI | [docs/CLI-REFERENCE.md](CLI-REFERENCE.md) |
| Contoh Tadbir Urus | [docs/GOVERNANCE-EXAMPLES.md](GOVERNANCE-EXAMPLES.md) |
| Panduan Provider LLM Percuma | [docs/FREE-LLM-PROVIDER-GUIDE.md](FREE-LLM-PROVIDER-GUIDE.md) |
| Penyelesaian Masalah | [docs/TROUBLESHOOTING.md](TROUBLESHOOTING.md) |

Arahan pertama untuk dijalankan selepas pemasangan:

```bash
sidjua chat guide    # panduan AI zero-config — tiada kunci API diperlukan
sidjua selftest      # pemeriksaan kesihatan sistem (7 kategori, skor 0-100)
sidjua apply         # peruntukan ejen dari divisions.yaml
```
