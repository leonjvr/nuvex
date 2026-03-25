> Tài liệu này được dịch bởi AI từ [bản gốc tiếng Anh](../INSTALLATION.md). Tìm thấy lỗi? [Báo cáo](https://github.com/GoetzKohlberg/sidjua/issues).

# Hướng dẫn Cài đặt SIDJUA

Phiên bản SIDJUA: 1.0.0 | Giấy phép: AGPL-3.0-only | Cập nhật: 2026-03-25

## Mục lục

1. [Ma trận Hỗ trợ Nền tảng](#1-ma-trận-hỗ-trợ-nền-tảng)
2. [Điều kiện Tiên quyết](#2-điều-kiện-tiên-quyết)
3. [Phương pháp Cài đặt](#3-phương-pháp-cài-đặt)
4. [Cấu trúc Thư mục](#4-cấu-trúc-thư-mục)
5. [Biến Môi trường](#5-biến-môi-trường)
6. [Cấu hình Nhà cung cấp](#6-cấu-hình-nhà-cung-cấp)
7. [Giao diện Desktop (Tùy chọn)](#7-giao-diện-desktop-tùy-chọn)
8. [Sandbox cho Tác nhân](#8-sandbox-cho-tác-nhân)
9. [Tìm kiếm Ngữ nghĩa (Tùy chọn)](#9-tìm-kiếm-ngữ-nghĩa-tùy-chọn)
10. [Khắc phục Sự cố](#10-khắc-phục-sự-cố)
11. [Tham chiếu Volume Docker](#11-tham-chiếu-volume-docker)
12. [Nâng cấp](#12-nâng-cấp)
13. [Các Bước Tiếp theo](#13-các-bước-tiếp-theo)

---

## 1. Ma trận Hỗ trợ Nền tảng

| Tính năng | Linux | macOS | Windows WSL2 | Windows (gốc) |
|-----------|-------|-------|--------------|--------------|
| CLI + REST API | ✅ Đầy đủ | ✅ Đầy đủ | ✅ Đầy đủ | ✅ Đầy đủ |
| Docker | ✅ Đầy đủ | ✅ Docker Desktop | ✅ Docker Desktop | ✅ Docker Desktop |
| Sandbox (bubblewrap) | ✅ Đầy đủ | ❌ Dự phòng về `none` | ✅ Đầy đủ (trong WSL2) | ❌ Dự phòng về `none` |
| Web Management Console | ✅ Full | ✅ Full | ✅ Full | ✅ Full |
| Tìm kiếm Ngữ nghĩa (Qdrant) | ✅ | ✅ | ✅ | ✅ |

**Ghi chú về bubblewrap:** Sandbox sử dụng không gian tên người dùng Linux. macOS và Windows (gốc) tự động dự phòng về chế độ sandbox `none` — không cần cấu hình.

---

## 2. Điều kiện Tiên quyết

### Node.js >= 22.0.0

**Lý do:** SIDJUA sử dụng các module ES, `fetch()` gốc và `crypto.subtle` — tất cả đều yêu cầu Node.js 22+.

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

**macOS (trình cài đặt .pkg):** Tải xuống từ [nodejs.org/en/download](https://nodejs.org/en/download).

**Windows (winget):**
```powershell
winget install OpenJS.NodeJS.LTS
```

**Windows (.msi):** Tải xuống từ [nodejs.org/en/download](https://nodejs.org/en/download).

**WSL2:** Sử dụng hướng dẫn Ubuntu/Debian ở trên trong terminal WSL2 của bạn.

Kiểm tra:
```bash
node --version   # phải là >= 22.0.0
npm --version    # phải là >= 10.0.0
```

---

### Chuỗi công cụ C/C++ (chỉ dành cho bản build từ mã nguồn)

**Lý do:** `better-sqlite3` và `argon2` biên dịch các addon Node.js gốc trong quá trình `npm ci`. Người dùng Docker có thể bỏ qua bước này.

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

**Windows:** Cài đặt [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) với khối lượng công việc **Phát triển Desktop với C++**, sau đó:
```powershell
npm install --global windows-build-tools
```

**Alpine Linux:**
```bash
apk add python3 make g++ build-base linux-headers
```

---

### Docker >= 24 (tùy chọn)

Chỉ cần thiết cho phương pháp cài đặt Docker. Plugin Docker Compose V2 (`docker compose`) phải có sẵn.

**Linux:** Làm theo hướng dẫn tại [docs.docker.com/engine/install](https://docs.docker.com/engine/install/).
Docker Compose V2 được bao gồm trong Docker Engine >= 24.

**macOS / Windows:** Cài đặt [Docker Desktop](https://www.docker.com/products/docker-desktop/) (bao gồm Docker Compose V2).

Kiểm tra:
```bash
docker --version          # phải là >= 24.0.0
docker compose version    # phải hiển thị v2.x.x
```

---

### Git

Bất kỳ phiên bản gần đây nào. Cài đặt qua trình quản lý gói của hệ điều hành hoặc từ [git-scm.com](https://git-scm.com).

---

## 3. Phương pháp Cài đặt

### Phương pháp A — Docker (Khuyến nghị)

Con đường nhanh nhất để có cài đặt SIDJUA hoạt động. Tất cả các phụ thuộc đều được đóng gói trong image.

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
docker compose up -d
```

Chờ cho các dịch vụ trở nên lành mạnh (lên đến ~60 giây trong lần build đầu tiên):

```bash
docker compose ps
# NAME              STATUS
# sidjua            Up X seconds (healthy)
# sidjua-qdrant     Up X seconds (healthy)
```

Lấy API key được tạo tự động:

```bash
docker compose exec sidjua cat /app/.system/api-key
```

Khởi động quản trị từ `divisions.yaml` của bạn:

```bash
docker compose exec sidjua sidjua apply --verbose
```

Chạy kiểm tra sức khỏe hệ thống:

```bash
docker compose exec sidjua sidjua selftest
```

**Lưu ý ARM64:** Image Docker được xây dựng trên `node:22-alpine` hỗ trợ `linux/amd64` và `linux/arm64`. Raspberry Pi (64-bit) và Mac Apple Silicon (qua Docker Desktop) được hỗ trợ ngay từ đầu.

**Bubblewrap trong Docker:** Để bật sandbox cho tác nhân bên trong container, hãy thêm `--cap-add=SYS_ADMIN` vào lệnh Docker run hoặc đặt trong `docker-compose.yml`:
```yaml
cap_add:
  - SYS_ADMIN
```

---

### Phương pháp B — Cài đặt npm Global

```bash
npm install -g sidjua
```

Chạy trình hướng dẫn cài đặt tương tác (3 bước: vị trí không gian làm việc, nhà cung cấp, tác nhân đầu tiên):
```bash
sidjua init
```

Đối với môi trường CI hoặc container không tương tác:
```bash
sidjua init --yes
```

Khởi động hướng dẫn AI không cần cấu hình (không cần API key):
```bash
sidjua chat guide
```

---

### Phương pháp C — Build từ Mã nguồn

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
npm ci
npm run build
```

Quá trình build sử dụng `tsup` để biên dịch `src/index.ts` thành:
- `dist/index.js` (ESM)
- `dist/index.cjs` (CommonJS)

Các bước sau build sao chép các tệp locale i18n, vai trò mặc định, phòng ban và mẫu cơ sở kiến thức vào `dist/`.

Chạy từ mã nguồn:
```bash
node dist/index.js --help
```

Chạy bộ kiểm thử:
```bash
npm test                    # tất cả các bài kiểm thử
npm run test:coverage       # với báo cáo độ bao phủ
npx tsc --noEmit            # chỉ kiểm tra kiểu dữ liệu
```

---

## 4. Cấu trúc Thư mục

### Đường dẫn Triển khai Docker

| Đường dẫn | Docker Volume | Mục đích | Quản lý bởi |
|-----------|--------------|----------|------------|
| `/app/dist/` | Lớp image | Ứng dụng đã biên dịch | SIDJUA |
| `/app/node_modules/` | Lớp image | Phụ thuộc Node.js | SIDJUA |
| `/app/system/` | Lớp image | Giá trị mặc định và mẫu tích hợp | SIDJUA |
| `/app/defaults/` | Lớp image | Tệp cấu hình mặc định | SIDJUA |
| `/app/docs/` | Lớp image | Tài liệu đính kèm | SIDJUA |
| `/app/data/` | `sidjua-data` | Cơ sở dữ liệu SQLite, bản sao lưu, bộ sưu tập kiến thức | Người dùng |
| `/app/config/` | `sidjua-config` | `divisions.yaml` và cấu hình tùy chỉnh | Người dùng |
| `/app/logs/` | `sidjua-logs` | Tệp nhật ký có cấu trúc | Người dùng |
| `/app/.system/` | `sidjua-system` | API key, trạng thái cập nhật, khóa tiến trình | Quản lý bởi SIDJUA |
| `/app/agents/` | `sidjua-workspace` | Định nghĩa tác nhân, kỹ năng, mẫu | Người dùng |
| `/app/governance/` | `sidjua-governance` | Dấu vết kiểm toán, ảnh chụp quản trị | Người dùng |

---

### Đường dẫn Cài đặt Thủ công / npm

Sau `sidjua init`, không gian làm việc của bạn được tổ chức như sau:

```
~/sidjua-workspace/           # hoặc SIDJUA_CONFIG_DIR
├── divisions.yaml            # Cấu hình quản trị của bạn
├── .sidjua/                  # Trạng thái nội bộ (WAL, bộ đệm telemetry)
│   └── telemetry.db
├── data/
│   ├── sidjua.db             # Cơ sở dữ liệu chính (tác nhân, nhiệm vụ, kiểm toán, chi phí)
│   ├── knowledge/            # Cơ sở dữ liệu kiến thức theo từng tác nhân
│   │   └── <agent-id>.db
│   └── backups/              # Kho lưu trữ sao lưu được ký HMAC
├── agents/                   # Thư mục kỹ năng tác nhân
├── governance/               # Dấu vết kiểm toán (chỉ thêm)
├── logs/                     # Nhật ký ứng dụng
└── system/                   # Trạng thái runtime
```

---

### Cơ sở dữ liệu SQLite

| Cơ sở dữ liệu | Đường dẫn | Nội dung |
|--------------|----------|---------|
| Chính | `data/sidjua.db` | Tác nhân, nhiệm vụ, chi phí, ảnh chụp quản trị, API key, nhật ký kiểm toán |
| Telemetry | `.sidjua/telemetry.db` | Báo cáo lỗi tùy chọn theo sự đồng ý (đã xóa PII) |
| Kiến thức | `data/knowledge/<agent-id>.db` | Nhúng vector theo từng tác nhân và chỉ mục BM25 |

Cơ sở dữ liệu SQLite là tệp đơn, đa nền tảng và có thể di chuyển. Sao lưu bằng `sidjua backup create`.

---

## 5. Biến Môi trường

Sao chép `.env.example` thành `.env` và tùy chỉnh. Tất cả các biến đều là tùy chọn trừ khi có ghi chú.

### Máy chủ

| Biến | Mặc định | Mô tả |
|------|---------|-------|
| `SIDJUA_PORT` | `3000` | Cổng lắng nghe REST API |
| `SIDJUA_HOST` | `127.0.0.1` | Địa chỉ liên kết REST API. Dùng `0.0.0.0` để truy cập từ xa |
| `NODE_ENV` | `production` | Chế độ runtime (`production` hoặc `development`) |
| `SIDJUA_API_KEY` | Tự động tạo | Token Bearer REST API. Tự động tạo khi khởi động lần đầu nếu không có |
| `SIDJUA_MAX_BODY_SIZE` | `2097152` (2 MiB) | Kích thước tối đa của nội dung yêu cầu đến tính bằng byte |

### Ghi đè Thư mục

| Biến | Mặc định | Mô tả |
|------|---------|-------|
| `SIDJUA_DATA_DIR` | `<workspace>/data` | Ghi đè vị trí thư mục dữ liệu |
| `SIDJUA_CONFIG_DIR` | `<workspace>` | Ghi đè vị trí thư mục cấu hình |
| `SIDJUA_LOG_DIR` | `<workspace>/logs` | Ghi đè vị trí thư mục nhật ký |

### Tìm kiếm Ngữ nghĩa

| Biến | Mặc định | Mô tả |
|------|---------|-------|
| `SIDJUA_QDRANT_URL` | `http://localhost:6333` | Endpoint cơ sở dữ liệu vector Qdrant. Mặc định Docker: `http://qdrant:6333` |
| `OPENAI_API_KEY` | — | Cần thiết cho các nhúng OpenAI `text-embedding-3-large` |
| `SIDJUA_CF_ACCOUNT_ID` | — | ID tài khoản Cloudflare cho các nhúng miễn phí |
| `SIDJUA_CF_TOKEN` | — | Token API Cloudflare cho các nhúng miễn phí |

### Nhà cung cấp LLM

| Biến | Nhà cung cấp |
|------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic (Claude) |
| `OPENAI_API_KEY` | OpenAI (GPT-4, nhúng) |
| `GOOGLE_AI_API_KEY` | Google AI (Gemini) |
| `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` | Cloudflare Workers AI (gói miễn phí) |
| `GROQ_API_KEY` | Groq (suy luận nhanh, có gói miễn phí) |
| `DEEPSEEK_API_KEY` | DeepSeek |

---

## 6. Cấu hình Nhà cung cấp

### Tùy chọn Không cần Cấu hình

`sidjua chat guide` hoạt động mà không cần bất kỳ API key nào. Nó kết nối với Cloudflare Workers AI thông qua proxy SIDJUA. Bị giới hạn tốc độ nhưng phù hợp để đánh giá và giới thiệu.

### Thêm Nhà cung cấp Đầu tiên

**Groq (gói miễn phí, không cần thẻ tín dụng):**
```bash
sidjua key set groq <your-groq-api-key>
sidjua provider list
```
Nhận key miễn phí tại [console.groq.com](https://console.groq.com).

**Anthropic (được khuyến nghị cho môi trường production):**
```bash
export ANTHROPIC_API_KEY=sk-ant-...
sidjua key set anthropic $ANTHROPIC_API_KEY
```

**Ollama (triển khai air-gap / local):**
```bash
sidjua provider add-custom \
  --id ollama \
  --name "Ollama (local)" \
  --base-url http://localhost:11434/v1 \
  --model llama3.2
```

Xác thực tất cả các nhà cung cấp đã cấu hình:
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

## 8. Sandbox cho Tác nhân

SIDJUA sử dụng giao diện `SandboxProvider` có thể cắm vào. Sandbox bao bọc việc thực thi kỹ năng tác nhân trong cách ly tiến trình ở cấp độ hệ điều hành.

### Hỗ trợ Sandbox theo Nền tảng

| Nền tảng | Nhà cung cấp Sandbox | Ghi chú |
|----------|---------------------|---------|
| Linux (gốc) | `bubblewrap` | Cách ly không gian tên người dùng đầy đủ |
| Docker (container Linux) | `bubblewrap` | Yêu cầu `--cap-add=SYS_ADMIN` |
| macOS | `none` (tự động dự phòng) | macOS không hỗ trợ không gian tên người dùng Linux |
| Windows WSL2 | `bubblewrap` | Cài đặt như trên Linux bên trong WSL2 |
| Windows (gốc) | `none` (tự động dự phòng) | |

### Cài đặt bubblewrap (Linux)

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

### Cấu hình

Trong `divisions.yaml`:
```yaml
governance:
  sandbox: bubblewrap    # hoặc: none
```

Kiểm tra tính khả dụng của sandbox:
```bash
sidjua sandbox check
```

---

## 9. Tìm kiếm Ngữ nghĩa (Tùy chọn)

Tìm kiếm ngữ nghĩa cung cấp sức mạnh cho `sidjua memory search` và truy xuất kiến thức tác nhân. Nó yêu cầu cơ sở dữ liệu vector Qdrant và nhà cung cấp nhúng.

### Docker Compose Profile

Tệp `docker-compose.yml` đi kèm có profile `semantic-search`:
```bash
docker compose --profile semantic-search up -d
```
Điều này khởi động một container Qdrant cùng với SIDJUA.

### Qdrant Độc lập

```bash
docker run -d \
  --name sidjua-qdrant \
  -p 6333:6333 \
  -v qdrant-storage:/qdrant/storage \
  qdrant/qdrant:v1.13.2
```

Đặt endpoint:
```bash
export SIDJUA_QDRANT_URL=http://localhost:6333
```

### Không có Qdrant

Nếu Qdrant không khả dụng, `sidjua memory import` và `sidjua memory search` bị vô hiệu hóa. Tất cả các tính năng SIDJUA khác (CLI, REST API, thực thi tác nhân, quản trị, kiểm toán) hoạt động bình thường. Hệ thống dự phòng về tìm kiếm từ khóa BM25 cho bất kỳ truy vấn kiến thức nào.

---

## 10. Khắc phục Sự cố

### Tất cả Nền tảng

**`npm ci` thất bại với lỗi `node-pre-gyp` hoặc `node-gyp`:**
```
gyp ERR! build error
```
Cài đặt chuỗi công cụ C/C++ (xem phần Điều kiện Tiên quyết). Trên Ubuntu: `sudo apt-get install -y python3 make g++ build-essential`.

**`Cannot find divisions.yaml`:**
Kiểm tra `SIDJUA_CONFIG_DIR`. Tệp phải ở `$SIDJUA_CONFIG_DIR/divisions.yaml`. Chạy `sidjua init` để tạo cấu trúc không gian làm việc.

**REST API trả về 401 Unauthorized:**
Xác minh header `Authorization: Bearer <key>`. Lấy key được tạo tự động bằng:
```bash
cat ~/.sidjua/.system/api-key          # cài đặt thủ công
docker compose exec sidjua cat /app/.system/api-key  # Docker
```

**Cổng 3000 đã được sử dụng:**
```bash
SIDJUA_PORT=3001 sidjua server start
# hoặc đặt trong .env: SIDJUA_PORT=3001
```

---

### Ubuntu / Debian

**`better-sqlite3` không biên dịch được, `futex.h` không tìm thấy:**
```bash
sudo apt-get install -y linux-headers-$(uname -r)
```

---

### Fedora / RHEL

**SELinux chặn mount volume Docker:**
```yaml
# Thêm nhãn :Z cho ngữ cảnh SELinux
volumes:
  - ./my-config:/app/config:Z
```
Hoặc đặt ngữ cảnh SELinux thủ công:
```bash
chcon -Rt svirt_sandbox_file_t ./my-config
```

---

### Arch Linux

**Phiên bản Node.js quá cũ:**
Sử dụng `nvm` để cài đặt Node.js 22:
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

**Docker Desktop hết bộ nhớ:**
Mở Docker Desktop → Cài đặt → Tài nguyên → Bộ nhớ. Tăng lên ít nhất 4 GB.

**Apple Silicon — không khớp kiến trúc:**
Xác minh cài đặt Node.js của bạn là ARM64 gốc (không qua Rosetta):
```bash
node -e "console.log(process.arch)"
# dự kiến: arm64
```
Nếu in ra `x64`, hãy cài đặt lại Node.js bằng trình cài đặt ARM64 từ nodejs.org.

---

### Windows (gốc)

**Không tìm thấy `MSBuild` hoặc `cl.exe`:**
Cài đặt [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) và chọn khối lượng công việc **Phát triển Desktop với C++**. Sau đó chạy:
```powershell
npm install --global windows-build-tools
```

**Lỗi đường dẫn dài (`ENAMETOOLONG`):**
Bật hỗ trợ đường dẫn dài trong registry Windows:
```powershell
# Chạy với tư cách Quản trị viên
Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" `
  -Name LongPathsEnabled -Value 1
```

**Lệnh `sidjua` không tìm thấy sau `npm install -g`:**
Thêm thư mục bin global của npm vào PATH:
```powershell
npm config get prefix  # hiển thị ví dụ C:\Users\you\AppData\Roaming\npm
# Thêm đường dẫn đó vào Biến Môi trường Hệ thống → Path
```

---

### Windows WSL2

**Docker không khởi động trong WSL2:**
Mở Docker Desktop → Cài đặt → Chung → bật **Use the WSL 2 based engine**.
Sau đó khởi động lại Docker Desktop và terminal WSL2 của bạn.

**Lỗi quyền truy cập trên các tệp dưới `/mnt/c/`:**
Các volume Windows NTFS được gắn kết trong WSL2 có quyền hạn chế. Di chuyển không gian làm việc của bạn sang đường dẫn Linux gốc:
```bash
mkdir ~/sidjua-workspace
cd ~/sidjua-workspace
sidjua init
```

---

### Raspberry Pi / ARM64

**`npm ci` rất chậm (5-10 phút):**
Đây là điều bình thường. Biên dịch addon gốc trên ARM64 mất nhiều thời gian hơn. Hãy xem xét sử dụng image Docker thay thế:
```bash
docker pull sidjua/sidjua:latest-arm64
```

**Hết bộ nhớ trong quá trình build:**
Thêm không gian swap:
```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

---

## 11. Tham chiếu Volume Docker

### Volume Được Đặt Tên

| Tên Volume | Đường dẫn Container | Mục đích |
|-----------|-------------------|---------|
| `sidjua-data` | `/app/data` | Cơ sở dữ liệu SQLite, kho lưu trữ sao lưu, bộ sưu tập kiến thức |
| `sidjua-config` | `/app/config` | `divisions.yaml`, cấu hình tùy chỉnh |
| `sidjua-logs` | `/app/logs` | Nhật ký ứng dụng có cấu trúc |
| `sidjua-system` | `/app/.system` | API key, trạng thái cập nhật, tệp khóa tiến trình |
| `sidjua-workspace` | `/app/agents` | Thư mục kỹ năng tác nhân, định nghĩa, mẫu |
| `sidjua-governance` | `/app/governance` | Dấu vết kiểm toán bất biến, ảnh chụp quản trị |
| `qdrant-storage` | `/qdrant/storage` | Chỉ mục vector Qdrant (chỉ profile tìm kiếm ngữ nghĩa) |

### Sử dụng Thư mục Host

Để mount `divisions.yaml` của riêng bạn thay vì chỉnh sửa bên trong container:

```yaml
# docker-compose.override.yml
services:
  sidjua:
    volumes:
      - ./my-config:/app/config   # thay thế volume được đặt tên sidjua-config
```

### Sao lưu

```bash
sidjua backup create                    # từ bên trong container
# hoặc
docker compose exec sidjua sidjua backup create
```

Các bản sao lưu là các kho lưu trữ được ký HMAC được lưu trữ trong `/app/data/backups/`.

---

## 12. Nâng cấp

### Docker

```bash
git pull
docker compose build --no-cache
docker compose up -d
docker compose exec sidjua sidjua apply    # chạy các migration schema
```

`sidjua apply` là idempotent — luôn an toàn khi chạy lại sau khi nâng cấp.

### Cài đặt npm Global

```bash
npm update -g sidjua
sidjua apply    # chạy các migration schema
```

### Build từ Mã nguồn

```bash
git pull
npm ci
npm run build
node dist/index.js apply    # chạy các migration schema
```

### Khôi phục

SIDJUA tạo ảnh chụp quản trị trước mỗi `sidjua apply`. Để hoàn nguyên:

```bash
sidjua rollback list
sidjua rollback <version>
```

---

## 13. Các Bước Tiếp theo

| Tài nguyên | Lệnh / Liên kết |
|-----------|----------------|
| Bắt đầu Nhanh | [docs/QUICK-START.md](QUICK-START.md) |
| Tham chiếu CLI | [docs/CLI-REFERENCE.md](CLI-REFERENCE.md) |
| Ví dụ Quản trị | [docs/GOVERNANCE-EXAMPLES.md](GOVERNANCE-EXAMPLES.md) |
| Hướng dẫn Nhà cung cấp LLM Miễn phí | [docs/FREE-LLM-PROVIDER-GUIDE.md](FREE-LLM-PROVIDER-GUIDE.md) |
| Khắc phục Sự cố | [docs/TROUBLESHOOTING.md](TROUBLESHOOTING.md) |

Các lệnh đầu tiên cần chạy sau khi cài đặt:

```bash
sidjua chat guide    # hướng dẫn AI không cần cấu hình — không cần API key
sidjua selftest      # kiểm tra sức khỏe hệ thống (7 danh mục, điểm 0-100)
sidjua apply         # cung cấp tác nhân từ divisions.yaml
```
