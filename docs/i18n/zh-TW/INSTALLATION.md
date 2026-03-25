> 本文件已從[英文原版](../INSTALLATION.md)經AI翻譯。發現錯誤？[請回報](https://github.com/GoetzKohlberg/sidjua/issues)。

# SIDJUA 安裝指南

SIDJUA 版本：1.0.0 | 授權：AGPL-3.0-only | 更新日期：2026-03-25

## 目錄

1. [平台支援矩陣](#1-平台支援矩陣)
2. [前置需求](#2-前置需求)
3. [安裝方法](#3-安裝方法)
4. [目錄結構](#4-目錄結構)
5. [環境變數](#5-環境變數)
6. [提供者設定](#6-提供者設定)
7. [桌面 GUI（選用）](#7-桌面-gui選用)
8. [代理程式沙盒](#8-代理程式沙盒)
9. [語意搜尋（選用）](#9-語意搜尋選用)
10. [疑難排解](#10-疑難排解)
11. [Docker 磁碟區參考](#11-docker-磁碟區參考)
12. [升級](#12-升級)
13. [後續步驟](#13-後續步驟)

---

## 1. 平台支援矩陣

| 功能 | Linux | macOS | Windows WSL2 | Windows（原生） |
|------|-------|-------|--------------|----------------|
| CLI + REST API | ✅ 完整 | ✅ 完整 | ✅ 完整 | ✅ 完整 |
| Docker | ✅ 完整 | ✅ Docker Desktop | ✅ Docker Desktop | ✅ Docker Desktop |
| 沙盒（bubblewrap） | ✅ 完整 | ❌ 退回 `none` | ✅ 完整（WSL2 內） | ❌ 退回 `none` |
| Web Management Console | ✅ Full | ✅ Full | ✅ Full | ✅ Full |
| 語意搜尋（Qdrant） | ✅ | ✅ | ✅ | ✅ |

**關於 bubblewrap 的說明：** Linux 使用者命名空間沙盒。macOS 和 Windows 原生會自動退回至沙盒模式 `none`，無需設定。

---

## 2. 前置需求

### Node.js >= 22.0.0

**原因：** SIDJUA 使用 ES 模組、原生 `fetch()` 和 `crypto.subtle`，這些均需要 Node.js 22 以上版本。

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

**macOS（Homebrew）:**
```bash
brew install node@22
echo 'export PATH="/opt/homebrew/opt/node@22/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

**macOS（.pkg 安裝程式）：** 從 [nodejs.org/en/download](https://nodejs.org/en/download) 下載。

**Windows（winget）:**
```powershell
winget install OpenJS.NodeJS.LTS
```

**Windows（.msi）：** 從 [nodejs.org/en/download](https://nodejs.org/en/download) 下載。

**WSL2：** 在 WSL2 終端機內使用 Ubuntu/Debian 的指示。

驗證：
```bash
node --version   # 必須 >= 22.0.0
npm --version    # 必須 >= 10.0.0
```

---

### C/C++ 工具鏈（僅限原始碼建置）

**原因：** `better-sqlite3` 和 `argon2` 在 `npm ci` 期間編譯原生 Node.js 附加元件。Docker 使用者可跳過此步驟。

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

**Windows：** 安裝含有**使用 C++ 的桌面開發**工作負載的 [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)，然後：
```powershell
npm install --global windows-build-tools
```

**Alpine Linux:**
```bash
apk add python3 make g++ build-base linux-headers
```

---

### Docker >= 24（選用）

僅 Docker 安裝方法需要。必須提供 Docker Compose V2 外掛程式（`docker compose`）。

**Linux：** 遵循 [docs.docker.com/engine/install](https://docs.docker.com/engine/install/) 上的指示。
Docker Compose V2 已包含在 Docker Engine >= 24 中。

**macOS / Windows：** 安裝 [Docker Desktop](https://www.docker.com/products/docker-desktop/)（含 Docker Compose V2）。

驗證：
```bash
docker --version          # 必須 >= 24.0.0
docker compose version    # 必須顯示 v2.x.x
```

---

### Git

任何最新版本。透過 OS 套件管理員或 [git-scm.com](https://git-scm.com) 安裝。

---

## 3. 安裝方法

### 方法 A — Docker（建議）

取得可用 SIDJUA 安裝的最快途徑。所有相依性均已打包在映像中。

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
docker compose up -d
```

等待服務變為健康狀態（首次建置最多約 60 秒）：

```bash
docker compose ps
# NAME              STATUS
# sidjua            Up X seconds (healthy)
# sidjua-qdrant     Up X seconds (healthy)
```

取得自動產生的 API 金鑰：

```bash
docker compose exec sidjua cat /app/.system/api-key
```

從您的 `divisions.yaml` 引導治理：

```bash
docker compose exec sidjua sidjua apply --verbose
```

執行系統健康檢查：

```bash
docker compose exec sidjua sidjua selftest
```

**ARM64 說明：** Docker 映像基於 `node:22-alpine` 建置，支援 `linux/amd64` 和 `linux/arm64`。Raspberry Pi（64 位元）和 Apple Silicon Mac（透過 Docker Desktop）均可直接使用。

**Docker 中的 Bubblewrap：** 若要在容器內啟用代理程式沙盒，請在 Docker 執行命令中新增 `--cap-add=SYS_ADMIN`，或在 `docker-compose.yml` 中設定：
```yaml
cap_add:
  - SYS_ADMIN
```

---

### 方法 B — npm 全域安裝

```bash
npm install -g sidjua
```

執行互動式設定精靈（3 個步驟：工作區位置、提供者、第一個代理程式）：
```bash
sidjua init
```

對於非互動式 CI 或容器環境：
```bash
sidjua init --yes
```

啟動零設定 AI 指南（無需 API 金鑰）：
```bash
sidjua chat guide
```

---

### 方法 C — 原始碼建置

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
npm ci
npm run build
```

建置程序使用 `tsup` 將 `src/index.ts` 編譯為：
- `dist/index.js`（ESM）
- `dist/index.cjs`（CommonJS）

建置後步驟會將 i18n 地區設定檔案、預設角色、分部和知識庫範本複製到 `dist/`。

從原始碼執行：
```bash
node dist/index.js --help
```

執行測試套件：
```bash
npm test                    # 所有測試
npm run test:coverage       # 含涵蓋率報告
npx tsc --noEmit            # 僅型別檢查
```

---

## 4. 目錄結構

### Docker 部署路徑

| 路徑 | Docker 磁碟區 | 用途 | 管理者 |
|------|-------------|------|--------|
| `/app/dist/` | 映像層 | 已編譯的應用程式 | SIDJUA |
| `/app/node_modules/` | 映像層 | Node.js 相依性 | SIDJUA |
| `/app/system/` | 映像層 | 內建預設值和範本 | SIDJUA |
| `/app/defaults/` | 映像層 | 預設設定檔案 | SIDJUA |
| `/app/docs/` | 映像層 | 隨附的文件 | SIDJUA |
| `/app/data/` | `sidjua-data` | SQLite 資料庫、備份、知識集合 | 使用者 |
| `/app/config/` | `sidjua-config` | `divisions.yaml` 和自訂設定 | 使用者 |
| `/app/logs/` | `sidjua-logs` | 結構化記錄檔 | 使用者 |
| `/app/.system/` | `sidjua-system` | API 金鑰、更新狀態、程序鎖定 | SIDJUA 管理 |
| `/app/agents/` | `sidjua-workspace` | 代理程式定義、技能、範本 | 使用者 |
| `/app/governance/` | `sidjua-governance` | 稽核軌跡、治理快照 | 使用者 |

---

### 手動 / npm 安裝路徑

執行 `sidjua init` 後，您的工作區組織如下：

```
~/sidjua-workspace/           # 或 SIDJUA_CONFIG_DIR
├── divisions.yaml            # 您的治理設定
├── .sidjua/                  # 內部狀態（WAL、遙測緩衝區）
│   └── telemetry.db
├── data/
│   ├── sidjua.db             # 主資料庫（代理程式、任務、稽核、成本）
│   ├── knowledge/            # 每個代理程式的知識資料庫
│   │   └── <agent-id>.db
│   └── backups/              # HMAC 簽署的備份封存檔
├── agents/                   # 代理程式技能目錄
├── governance/               # 稽核軌跡（僅限附加）
├── logs/                     # 應用程式記錄
└── system/                   # 執行階段狀態
```

---

### SQLite 資料庫

| 資料庫 | 路徑 | 內容 |
|--------|------|------|
| 主要 | `data/sidjua.db` | 代理程式、任務、成本、治理快照、API 金鑰、稽核記錄 |
| 遙測 | `.sidjua/telemetry.db` | 選用的選擇加入錯誤報告（已移除 PII） |
| 知識 | `data/knowledge/<agent-id>.db` | 每個代理程式的向量嵌入和 BM25 索引 |

SQLite 資料庫是單一檔案、跨平台、可移植的。使用 `sidjua backup create` 進行備份。

---

## 5. 環境變數

將 `.env.example` 複製到 `.env` 並自訂。除非另有說明，所有變數均為選用。

### 伺服器

| 變數 | 預設值 | 說明 |
|------|-------|------|
| `SIDJUA_PORT` | `3000` | REST API 監聽連接埠 |
| `SIDJUA_HOST` | `127.0.0.1` | REST API 繫結位址。遠端存取使用 `0.0.0.0` |
| `NODE_ENV` | `production` | 執行階段模式（`production` 或 `development`） |
| `SIDJUA_API_KEY` | 自動產生 | REST API 持有人權杖。首次啟動時若不存在則自動建立 |
| `SIDJUA_MAX_BODY_SIZE` | `2097152`（2 MiB） | 傳入要求本文的最大大小（位元組） |

### 目錄覆寫

| 變數 | 預設值 | 說明 |
|------|-------|------|
| `SIDJUA_DATA_DIR` | `<workspace>/data` | 覆寫資料目錄位置 |
| `SIDJUA_CONFIG_DIR` | `<workspace>` | 覆寫設定目錄位置 |
| `SIDJUA_LOG_DIR` | `<workspace>/logs` | 覆寫記錄目錄位置 |

### 語意搜尋

| 變數 | 預設值 | 說明 |
|------|-------|------|
| `SIDJUA_QDRANT_URL` | `http://localhost:6333` | Qdrant 向量資料庫端點。Docker 預設值：`http://qdrant:6333` |
| `OPENAI_API_KEY` | — | OpenAI `text-embedding-3-large` 嵌入所需 |
| `SIDJUA_CF_ACCOUNT_ID` | — | 免費嵌入的 Cloudflare 帳戶 ID |
| `SIDJUA_CF_TOKEN` | — | 免費嵌入的 Cloudflare API 權杖 |

### LLM 提供者

| 變數 | 提供者 |
|------|-------|
| `ANTHROPIC_API_KEY` | Anthropic（Claude） |
| `OPENAI_API_KEY` | OpenAI（GPT-4、嵌入） |
| `GOOGLE_AI_API_KEY` | Google AI（Gemini） |
| `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` | Cloudflare Workers AI（免費方案） |
| `GROQ_API_KEY` | Groq（快速推論，提供免費方案） |
| `DEEPSEEK_API_KEY` | DeepSeek |

---

## 6. 提供者設定

### 零設定選項

`sidjua chat guide` 無需 API 金鑰即可運作。它透過 SIDJUA 代理連線至 Cloudflare Workers AI。有速率限制，但適合評估和入門使用。

### 新增您的第一個提供者

**Groq（免費方案，無需信用卡）：**
```bash
sidjua key set groq <your-groq-api-key>
sidjua provider list
```
在 [console.groq.com](https://console.groq.com) 取得免費金鑰。

**Anthropic（建議用於正式環境）：**
```bash
export ANTHROPIC_API_KEY=sk-ant-...
sidjua key set anthropic $ANTHROPIC_API_KEY
```

**Ollama（隔離網路 / 本機部署）：**
```bash
sidjua provider add-custom \
  --id ollama \
  --name "Ollama (local)" \
  --base-url http://localhost:11434/v1 \
  --model llama3.2
```

驗證所有已設定的提供者：
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

## 8. 代理程式沙盒

SIDJUA 使用可插拔的 `SandboxProvider` 介面。沙盒將代理程式技能執行包裝在 OS 層級的程序隔離中。

### 依平台的沙盒支援

| 平台 | 沙盒提供者 | 備註 |
|------|----------|------|
| Linux（原生） | `bubblewrap` | 完整的使用者命名空間隔離 |
| Docker（Linux 容器） | `bubblewrap` | 需要 `--cap-add=SYS_ADMIN` |
| macOS | `none`（自動退回） | macOS 不支援 Linux 使用者命名空間 |
| Windows WSL2 | `bubblewrap` | 在 WSL2 內如同 Linux 一樣安裝 |
| Windows（原生） | `none`（自動退回） | |

### 安裝 bubblewrap（Linux）

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

### 設定

在 `divisions.yaml` 中：
```yaml
governance:
  sandbox: bubblewrap    # 或：none
```

驗證沙盒可用性：
```bash
sidjua sandbox check
```

---

## 9. 語意搜尋（選用）

語意搜尋為 `sidjua memory search` 和代理程式知識擷取提供支援。需要 Qdrant 向量資料庫和嵌入提供者。

### Docker Compose 設定檔

隨附的 `docker-compose.yml` 有一個 `semantic-search` 設定檔：
```bash
docker compose --profile semantic-search up -d
```
這會在 SIDJUA 旁邊啟動一個 Qdrant 容器。

### 獨立 Qdrant

```bash
docker run -d \
  --name sidjua-qdrant \
  -p 6333:6333 \
  -v qdrant-storage:/qdrant/storage \
  qdrant/qdrant:v1.13.2
```

設定端點：
```bash
export SIDJUA_QDRANT_URL=http://localhost:6333
```

### 不使用 Qdrant

若 Qdrant 無法使用，`sidjua memory import` 和 `sidjua memory search` 將被停用。所有其他 SIDJUA 功能（CLI、REST API、代理程式執行、治理、稽核）正常運作。系統將退回至 BM25 關鍵字搜尋處理知識查詢。

---

## 10. 疑難排解

### 所有平台

**`npm ci` 因 `node-pre-gyp` 或 `node-gyp` 錯誤失敗：**
```
gyp ERR! build error
```
安裝 C/C++ 工具鏈（請參閱前置需求章節）。Ubuntu 上：`sudo apt-get install -y python3 make g++ build-essential`。

**`Cannot find divisions.yaml`：**
檢查 `SIDJUA_CONFIG_DIR`。檔案必須位於 `$SIDJUA_CONFIG_DIR/divisions.yaml`。執行 `sidjua init` 建立工作區結構。

**REST API 傳回 401 Unauthorized：**
驗證 `Authorization: Bearer <key>` 標頭。使用以下命令取得自動產生的金鑰：
```bash
cat ~/.sidjua/.system/api-key          # 手動安裝
docker compose exec sidjua cat /app/.system/api-key  # Docker
```

**連接埠 3000 已被佔用：**
```bash
SIDJUA_PORT=3001 sidjua server start
# 或在 .env 中設定：SIDJUA_PORT=3001
```

---

### Ubuntu / Debian

**`better-sqlite3` 因找不到 `futex.h` 而編譯失敗：**
```bash
sudo apt-get install -y linux-headers-$(uname -r)
```

---

### Fedora / RHEL

**SELinux 封鎖 Docker 磁碟區掛載：**
```yaml
# 為 SELinux 內容新增 :Z 標籤
volumes:
  - ./my-config:/app/config:Z
```
或手動設定 SELinux 內容：
```bash
chcon -Rt svirt_sandbox_file_t ./my-config
```

---

### Arch Linux

**Node.js 版本太舊：**
使用 `nvm` 安裝 Node.js 22：
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
nvm install 22
nvm use 22
```

---

### macOS

**`xcrun: error: invalid active developer path`：**
```bash
xcode-select --install
```

**Docker Desktop 記憶體不足：**
開啟 Docker Desktop → 設定 → 資源 → 記憶體。增加至至少 4 GB。

**Apple Silicon — 架構不符：**
驗證您的 Node.js 安裝是原生 ARM64（而非 Rosetta）：
```bash
node -e "console.log(process.arch)"
# 預期：arm64
```
若顯示 `x64`，請使用 nodejs.org 的 ARM64 安裝程式重新安裝 Node.js。

---

### Windows（原生）

**找不到 `MSBuild` 或 `cl.exe`：**
安裝 [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) 並選取**使用 C++ 的桌面開發**工作負載。然後執行：
```powershell
npm install --global windows-build-tools
```

**長路徑錯誤（`ENAMETOOLONG`）：**
在 Windows 登錄中啟用長路徑支援：
```powershell
# 以系統管理員身分執行
Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" `
  -Name LongPathsEnabled -Value 1
```

**`npm install -g` 後找不到 `sidjua` 命令：**
將 npm 全域 bin 目錄新增至 PATH：
```powershell
npm config get prefix  # 例如 C:\Users\you\AppData\Roaming\npm
# 將該路徑新增至系統環境變數 → Path
```

---

### Windows WSL2

**Docker 無法在 WSL2 內啟動：**
開啟 Docker Desktop → 設定 → 一般 → 啟用**使用 WSL 2 型引擎**。
然後重新啟動 Docker Desktop 和 WSL2 終端機。

**`/mnt/c/` 下檔案的權限錯誤：**
在 WSL2 中掛載的 Windows NTFS 磁碟區具有受限的權限。將工作區移至 Linux 原生路徑：
```bash
mkdir ~/sidjua-workspace
cd ~/sidjua-workspace
sidjua init
```

---

### Raspberry Pi / ARM64

**`npm ci` 非常緩慢（5-10 分鐘）：**
這是正常的。ARM64 上的原生附加元件編譯需要更長時間。請考慮改用 Docker 映像：
```bash
docker pull sidjua/sidjua:latest-arm64
```

**建置期間記憶體不足：**
新增交換空間：
```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

---

## 11. Docker 磁碟區參考

### 具名磁碟區

| 磁碟區名稱 | 容器路徑 | 用途 |
|----------|---------|------|
| `sidjua-data` | `/app/data` | SQLite 資料庫、備份封存檔、知識集合 |
| `sidjua-config` | `/app/config` | `divisions.yaml`、自訂設定 |
| `sidjua-logs` | `/app/logs` | 結構化應用程式記錄 |
| `sidjua-system` | `/app/.system` | API 金鑰、更新狀態、程序鎖定檔案 |
| `sidjua-workspace` | `/app/agents` | 代理程式技能目錄、定義、範本 |
| `sidjua-governance` | `/app/governance` | 不可變的稽核軌跡、治理快照 |
| `qdrant-storage` | `/qdrant/storage` | Qdrant 向量索引（僅限語意搜尋設定檔） |

### 使用主機目錄

若要掛載您自己的 `divisions.yaml` 而不是在容器內編輯：

```yaml
# docker-compose.override.yml
services:
  sidjua:
    volumes:
      - ./my-config:/app/config   # 取代 sidjua-config 具名磁碟區
```

### 備份

```bash
sidjua backup create                    # 從容器內部
# 或
docker compose exec sidjua sidjua backup create
```

備份是儲存在 `/app/data/backups/` 中的 HMAC 簽署封存檔。

---

## 12. 升級

### Docker

```bash
git pull
docker compose build --no-cache
docker compose up -d
docker compose exec sidjua sidjua apply    # 執行結構描述移轉
```

`sidjua apply` 具有冪等性——升級後重新執行一律是安全的。

### npm 全域安裝

```bash
npm update -g sidjua
sidjua apply    # 執行結構描述移轉
```

### 原始碼建置

```bash
git pull
npm ci
npm run build
node dist/index.js apply    # 執行結構描述移轉
```

### 復原

SIDJUA 在每次 `sidjua apply` 前建立治理快照。若要復原：

```bash
sidjua rollback list
sidjua rollback <version>
```

---

## 13. 後續步驟

| 資源 | 命令 / 連結 |
|------|-----------|
| 快速入門 | [docs/QUICK-START.md](QUICK-START.md) |
| CLI 參考 | [docs/CLI-REFERENCE.md](CLI-REFERENCE.md) |
| 治理範例 | [docs/GOVERNANCE-EXAMPLES.md](GOVERNANCE-EXAMPLES.md) |
| 免費 LLM 提供者指南 | [docs/FREE-LLM-PROVIDER-GUIDE.md](FREE-LLM-PROVIDER-GUIDE.md) |
| 疑難排解 | [docs/TROUBLESHOOTING.md](TROUBLESHOOTING.md) |

安裝後首先執行的命令：

```bash
sidjua chat guide    # 零設定 AI 指南——無需 API 金鑰
sidjua selftest      # 系統健康檢查（7 個類別，0-100 分）
sidjua apply         # 從 divisions.yaml 佈建代理程式
```
