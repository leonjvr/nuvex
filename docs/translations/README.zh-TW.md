[English](../../README.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [Français](README.fr.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [中文 (简体)](README.zh-CN.md) | [中文 (繁體)](README.zh-TW.md) | [العربية](README.ar.md) | [বাংলা](README.bn.md) | [Čeština](README.cs.md) | [Filipino](README.fil.md) | [हिन्दी](README.hi.md) | [Bahasa Indonesia](README.id.md) | [Italiano](README.it.md) | [Bahasa Melayu](README.ms.md) | [Nederlands](README.nl.md) | [Polski](README.pl.md) | [Português (BR)](README.pt-BR.md) | [Română](README.ro.md) | [Русский](README.ru.md) | [Svenska](README.sv.md) | [ภาษาไทย](README.th.md) | [Türkçe](README.tr.md) | [Українська](README.uk.md) | [Tiếng Việt](README.vi.md)

> *本頁面已從[英文原版](../../README.md)自動翻譯。發現錯誤？[請回報](https://github.com/GoetzKohlberg/sidjua/issues)。*

# SIDJUA — AI 智能體治理平台

> 唯一一個透過架構強制執行治理的智能體平台，而不是寄望於模型的自覺。

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Docker](https://img.shields.io/badge/Docker-sidjua%2Fsidjua-blue)](https://hub.docker.com/r/sidjua/sidjua)
[![Version](https://img.shields.io/badge/version-1.0.0-green)](https://github.com/sidjua-dev/sidjua/releases)

---

## 安裝

### 前置需求

| 工具 | 是否必須 | 說明 |
|------|----------|------|
| **Node.js** | >= 22.0.0 | ES 模組、`fetch()`、`crypto.subtle`。[下載](https://nodejs.org) |
| **C/C++ 工具鏈** | 僅原始碼建置 | `better-sqlite3` 和 `argon2` 需要編譯原生附加元件 |
| **Docker** | >= 24（選用） | 僅用於 Docker 部署 |

安裝 Node.js 22：Ubuntu/Debian（`curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs`），macOS（`brew install node@22`），Windows（`winget install OpenJS.NodeJS.LTS`）。

安裝 C/C++ 工具：Ubuntu（`sudo apt-get install -y python3 make g++ build-essential`），macOS（`xcode-select --install`），Windows（`npm install --global windows-build-tools`）。

### 選項 A — Docker（建議）

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
docker compose up -d
```

```bash
# 查看自動產生的 API 金鑰
docker compose exec sidjua cat /app/.system/api-key

# 初始化治理
docker compose exec sidjua sidjua apply --verbose

# 系統健康檢查
docker compose exec sidjua sidjua selftest
```

支援 **linux/amd64** 和 **linux/arm64**（Raspberry Pi、Apple Silicon）。

### 選項 B — npm 全域安裝

```bash
npm install -g sidjua
sidjua init          # 互動式三步驟設定
sidjua chat guide    # 零設定 AI 嚮導（無需 API 金鑰）
```

### 選項 C — 原始碼建置

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
npm ci && npm run build
node dist/index.js --help
```

### 平台注意事項

| 功能 | Linux | macOS | Windows (WSL2) | Windows（原生） |
|------|-------|-------|----------------|-----------------|
| CLI + REST API | ✅ 完整 | ✅ 完整 | ✅ 完整 | ✅ 完整 |
| Docker | ✅ 完整 | ✅ 完整 (Desktop) | ✅ 完整 (Desktop) | ✅ 完整 (Desktop) |
| 沙箱隔離 (bubblewrap) | ✅ 完整 | ❌ 退回 `none` | ✅ 完整（WSL2 內） | ❌ 退回 `none` |
| Web Management Console | ✅ Full | ✅ Full | ✅ Full | ✅ Full |

無需外部資料庫。SIDJUA 使用 SQLite。Qdrant 為選用（僅用於語義搜尋）。

有關目錄結構、環境變數、各作業系統疑難排解和 Docker 磁碟區參考的完整指南，請參閱 [docs/INSTALLATION.md](docs/INSTALLATION.md)。

---

## 為何選擇 SIDJUA？

當今所有 AI 智能體框架都依賴同一個錯誤假設：可以信任 AI 遵循自己的規則。

**基於提示的治理問題：**

你給智能體一個系統提示，說「永遠不要存取客戶 PII」。智能體讀取了這條指令。智能體同時也讀取了使用者要求拉取張三付款記錄的訊息。智能體自行決定是否遵守。那不是治理。那只是措辭強硬的建議。

**SIDJUA 與眾不同。**

治理位於智能體**外部**。每個動作在執行**之前**都要通過一個五步驟預操作執行管道。你在 YAML 中定義規則。系統強制執行規則。智能體永遠沒有機會決定是否遵守，因為檢查在智能體行動之前就已經發生了。

這是透過架構實現的治理——不是靠提示、不是靠微調、不是靠期望。

---

## 運作方式

SIDJUA 用外部治理層包裹你的智能體。在提議的動作通過五階段執行管道之前，智能體的 LLM 呼叫永遠不會發生：

**階段 1 — 禁止：** 被封鎖的動作立即被拒絕。無 LLM 呼叫、無標記為「已允許」的日誌條目、無第二次機會。如果動作在禁止清單上，它就在這裡停止。

**階段 2 — 審核：** 需要人工簽核的動作在執行前被暫掛等待審核。智能體等待。人類決定。

**階段 3 — 預算：** 每個任務都受即時成本限制約束。每任務和每智能體的預算被強制執行。當達到限制時，任務被取消——不是標記，不是記錄待審查，而是*取消*。

**階段 4 — 分類：** 跨部門邊界的資料按分類規則進行檢查。二級智能體無法存取 SECRET 資料。A 部門的智能體無法讀取 B 部門的機密。

**階段 5 — 策略：** 結構化執行的自訂組織規則。API 呼叫頻率限制、輸出令牌上限、時間視窗限制。

整個管道在任何動作執行之前運行。對於治理關鍵操作，不存在「記錄後再審查」模式。

### 單一設定檔

你的整個智能體組織儲存在一個 `divisions.yaml` 中：

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

`sidjua apply` 讀取此檔案並佈建完整的智能體基礎設施：智能體、部門、RBAC、路由、稽核表、機密路徑和治理規則——透過 10 個可重現的步驟。

### 智能體架構

智能體被組織為**部門**（職能群組）和**層級**（信任等級）。一級智能體在其治理信封內具有完全自主權。二級智能體需要對敏感操作進行審核。三級智能體完全受監督。層級系統在結構上強制執行——智能體無法自我晉升。

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

## 架構限制

SIDJUA 在架構層級強制執行這些限制——它們無法被智能體停用、繞過或覆寫：

1. **治理是外部的：** 治理層包裹智能體。智能體無法存取治理程式碼，無法修改規則，也無法偵測治理是否存在。

2. **預操作，而非後操作：** 每個動作在執行之前都要經過檢查。對於治理關鍵操作，不存在「記錄後再審查」模式。

3. **結構化執行：** 規則由程式碼路徑強制執行，而不是透過提示或模型指令。智能體無法從治理中「越獄」，因為治理不是作為對模型的指令實作的。

4. **稽核不可變性：** Write-Ahead Log (WAL) 是帶有完整性驗證的僅附加日誌。被竄改的條目會被偵測並排除。

5. **部門隔離：** 不同部門的智能體無法存取彼此的資料、機密或通訊頻道。

---

## 比較

| 功能 | SIDJUA | CrewAI | AutoGen | LangGraph | OpenClaw |
|------|--------|--------|---------|-----------|----------|
| 外部治理 | ✅ 架構級 | ❌ | ❌ | ❌ | ❌ |
| 預操作執行 | ✅ 五步驟管道 | ❌ | ❌ | ❌ | ❌ |
| EU AI 法案就緒 | ✅ | ❌ | ❌ | ❌ | ❌ |
| 自架主機 | ✅ | ❌ 雲端 | ❌ 雲端 | ❌ 雲端 | ✅ 外掛 |
| 離網部署 | ✅ | ❌ | ❌ | ❌ | ❌ |
| 模型無關 | ✅ 任意 LLM | 部分 | 部分 | 部分 | ✅ |
| 雙向電子郵件 | ✅ | ❌ | ❌ | ❌ | ❌ |
| Discord 閘道 | ✅ | ❌ | ❌ | ❌ | ❌ |
| 階層化智能體 | ✅ 部門 + 層級 | 基礎 | 基礎 | 圖 | ❌ |
| 預算執行 | ✅ 每智能體限額 | ❌ | ❌ | ❌ | ❌ |
| 沙箱隔離 | ✅ bubblewrap | ❌ | ❌ | ❌ | ❌ |
| 稽核不可變性 | ✅ WAL + 完整性 | ❌ | ❌ | ❌ | ❌ |
| 授權條款 | AGPL-3.0 | MIT | MIT | MIT | 混合 |
| 獨立稽核 | ✅ 2 家外部 | ❌ | ❌ | ❌ | ❌ |

---

## 功能特色

### 治理與合規

**預操作管道（第 0 階段）** 在每個智能體動作之前執行：禁止檢查 → 人工審核 → 預算執行 → 資料分類 → 自訂策略。全部五個階段都是結構性的——它們在程式碼中執行，而不是在智能體的提示詞中。

**強制基準規則** 隨每次安裝提供：10 條治理規則（`SYS-SEC-001` 到 `SYS-GOV-002`），不能透過使用者設定刪除或削弱。自訂規則擴充基準，但不能覆寫它。

**EU AI 法案合規** — 稽核追蹤、分類框架和審核工作流程直接對應第 9 條、第 12 條和第 17 條的要求。2026 年 8 月的合規截止日期已納入產品藍圖。

**合規報告** 透過 `sidjua audit report/violations/agents/export`：合規評分、每智能體信任評分、違規歷史、面向外部稽核師或 SIEM 整合的 CSV/JSON 匯出。

**Write-Ahead Log (WAL)** 與完整性驗證：每項治理決策在執行前都寫入僅附加日誌。被竄改的條目在讀取時被偵測到。`sidjua memory recover` 重新驗證並修復。

### 通訊

智能體不只是回應 API 呼叫——它們參與真實的通訊頻道。

**雙向電子郵件** (`sidjua email status/test/threads`)：智能體透過 IMAP 輪詢接收電子郵件，透過 SMTP 回覆。透過 In-Reply-To 標頭進行執行緒對應，保持對話連貫。寄件者白名單、本文大小限制和 HTML 過濾保護智能體管道免受惡意輸入。

**Discord 閘道機器人**：透過 `sidjua module install discord` 提供完整的斜線命令介面。智能體回應 Discord 訊息，維護對話執行緒，並發送主動通知。

**Telegram 整合**：透過 Telegram 機器人發送智能體警示和通知。多頻道配接器模式並行支援 Telegram、Discord、ntfy 和電子郵件。

### 維運

**單一 Docker 命令**即可投入生產：

```bash
docker run -p 4200:4200 sidjua/sidjua:latest
```

API 金鑰在首次啟動時自動產生並印至容器日誌。無需環境變數。無需設定。無需資料庫伺服器——SIDJUA 使用 SQLite，每個智能體一個資料庫檔案。

**CLI 管理** — 從單一二進位檔案完成完整生命週期：

```bash
sidjua init                      # 互動式工作區設定（3 步驟）
sidjua apply                     # 從 divisions.yaml 佈建
sidjua agent create/list/stop    # 智能體生命週期
sidjua run "任務..." --wait      # 提交帶治理執行的任務
sidjua audit report              # 合規報告
sidjua costs                     # 按部門/智能體劃分的成本明細
sidjua backup create/restore     # HMAC 簽署的備份管理
sidjua update                    # 帶自動預備份的版本更新
sidjua rollback                  # 一鍵回復到上一版本
sidjua email status/test         # 電子郵件頻道管理
sidjua secret set/get/rotate     # 加密機密管理
sidjua memory import/search      # 語義知識管道
sidjua selftest                  # 系統健康檢查（7 個類別，0-100 分）
```

**語義記憶** — 匯入對話和文件（`sidjua memory import ~/exports/claude-chats.zip`），使用向量 + BM25 混合排名搜尋。支援 Cloudflare Workers AI 嵌入（免費，零設定）和 OpenAI 大型嵌入（適用於大型知識庫的更高品質）。

**自適應分塊** — 記憶管道自動調整區塊大小，以保持在每個嵌入模型的令牌限制內。

**零設定嚮導** — `sidjua chat guide` 無需任何 API 金鑰即可啟動互動式 AI 助手，透過 SIDJUA 代理由 Cloudflare Workers AI 提供支援。詢問如何設定智能體、設定治理，或了解稽核日誌中發生了什麼。

**離網部署** — 使用 Ollama 或任何相容 OpenAI 的端點透過本地 LLM 在完全斷開網際網路的情況下執行。預設無遙測。選擇性的當機回報，完全去除 PII。

### 安全性

**沙箱隔離** — 智能體技能透過 bubblewrap（Linux 使用者命名空間）在作業系統層級的程序隔離中執行。零額外 RAM 負擔。可插拔的 `SandboxProvider` 介面：開發用 `none`，生產用 `bubblewrap`。

**機密管理** — 帶 RBAC 的加密機密存放區（`sidjua secret set/get/list/delete/rotate/namespaces`）。無需外部保險庫。

**安全優先建置** — 廣泛的內部測試套件，加上 2 名外部程式碼稽核師（DeepSeek V3 和 xAI Grok）的獨立驗證。每個 API 表面都有安全標頭、CSRF 保護、速率限制和輸入清理。全程使用參數化查詢防止 SQL 注入。

**備份完整性** — 帶有 zip 滑動保護、zip 炸彈防護和還原時清單校驗和驗證的 HMAC 簽署備份封存。

---

## 從其他框架匯入

```bash
# 預覽將匯入的內容——不做任何更改
sidjua import openclaw --dry-run

# 匯入設定 + 技能檔案
sidjua import openclaw --skills
```

你的現有智能體保留其身份、模型和技能。SIDJUA 自動新增治理、稽核追蹤和預算控制。

---

## 設定參考

一個最簡的入門 `divisions.yaml`：

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

`sidjua apply` 從此檔案佈建完整的基礎設施。更改後再次執行——它是冪等的。

有關所有 10 個佈建步驟的完整規格，請參閱 [docs/SIDJUA-APPLY-TECH-SPEC-V1.md](docs/SIDJUA-APPLY-TECH-SPEC-V1.md)。

---

## REST API

SIDJUA REST API 與儀表板在同一個連接埠上執行：

```bash
sidjua server start --port 4200 --api-key $SIDJUA_API_KEY
```

關鍵端點：

```
GET  /api/v1/health          # 公開健康檢查（無需認證）
GET  /api/v1/info            # 系統中繼資料（已認證）
POST /api/v1/execute/run     # 提交任務
GET  /api/v1/execute/:id/status  # 任務狀態
GET  /api/v1/execute/:id/result  # 任務結果
GET  /api/v1/events          # SSE 事件流
GET  /api/v1/audit/report    # 合規報告
```

除 `/health` 之外的所有端點都需要 Bearer 認證。產生金鑰：

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

或使用包含的 `docker-compose.yml`，它為設定、日誌和智能體工作區新增具名磁碟區，以及用於語義搜尋的選用 Qdrant 服務：

```bash
docker compose up -d
docker compose exec sidjua sidjua init
docker compose exec sidjua sidjua apply
```

---

## 提供商

SIDJUA 連接任何 LLM 提供商，無供應商鎖定：

| 提供商 | 模型 | API 金鑰 |
|--------|------|----------|
| Anthropic | Claude Sonnet 4.6, Haiku 4.5, Opus 4.6 | `ANTHROPIC_API_KEY` |
| Google | Gemini 2.0, Gemini 1.5 Pro | `GOOGLE_API_KEY` |
| Groq | Llama 3.x, Mixtral | `GROQ_API_KEY`（免費層） |
| Cloudflare Workers AI | Llama, Mistral, Phi | `CF_ACCOUNT_ID` + `CF_TOKEN` |
| Ollama | 任意本地模型 | 無需金鑰（本地） |
| OpenAI 相容 | 任意端點 | 自訂 URL + 金鑰 |

```bash
# 新增提供商金鑰
sidjua key set groq gsk_...

# 列出可用提供商和模型
sidjua provider list
```

---

## 藍圖

完整藍圖見 [sidjua.com/roadmap](https://sidjua.com/roadmap)。

近期計畫：
- 多智能體協作模式（V1.1）
- Webhook 輸入觸發器（V1.1）
- 智能體間通訊（V1.2）
- 企業 SSO 整合（V1.x）
- 雲端代管治理驗證服務（V1.x）

---

## 社群

- **Discord**：[sidjua.com/discord](https://sidjua.com/discord)
- **GitHub Issues**：[github.com/sidjua-dev/sidjua/issues](https://github.com/sidjua-dev/sidjua/issues)
- **電子郵件**：contact@sidjua.com
- **文件**：[sidjua.com/docs](https://sidjua.com/docs)

如果發現 bug，請提交 issue——我們回應迅速。

---

## 翻譯

SIDJUA 提供 26 種語言版本。英語和德語由核心團隊維護。所有其他翻譯為 AI 生成，由社群維護。

**文件：** 本 README 和[安裝指南](docs/INSTALLATION.md)提供全部 26 種語言版本。請參閱本頁頂部的語言選擇器。

| 地區 | 語言 |
|------|------|
| 美洲 | 英語、西班牙語、葡萄牙語（巴西） |
| 歐洲 | 德語、法語、義大利語、荷蘭語、波蘭語、捷克語、羅馬尼亞語、俄語、烏克蘭語、瑞典語、土耳其語 |
| 中東 | 阿拉伯語 |
| 亞洲 | 印地語、孟加拉語、菲律賓語、印度尼西亞語、馬來語、泰語、越南語、日語、韓語、中文（簡體）、中文（繁體） |

發現翻譯錯誤？請提交 GitHub Issue，包含：
- 語言和地區代碼（例如 `zh-TW`）
- 錯誤文字或地區檔案中的鍵（例如 `gui.nav.dashboard`）
- 正確的翻譯

想要維護某種語言？請參閱 [CONTRIBUTING.md](CONTRIBUTING.md#translations)——我們採用按語言指定維護者的模型。

---

## 授權條款

**AGPL-3.0** — 只要你在相同授權條款下共享修改，你可以自由使用、修改和散布 SIDJUA。代管部署的使用者始終可以取得原始碼。

對於需要專有部署且無 AGPL 義務的組織，提供企業授權條款。
[contact@sidjua.com](mailto:contact@sidjua.com)
