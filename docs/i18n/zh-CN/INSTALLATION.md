> 本文档已从[英文原版](../INSTALLATION.md)经AI翻译。发现错误？[请报告](https://github.com/GoetzKohlberg/sidjua/issues)。

# SIDJUA 安装指南

SIDJUA 版本：1.0.0 | 许可证：AGPL-3.0-only | 更新日期：2026-03-25

## 目录

1. [平台支持矩阵](#1-平台支持矩阵)
2. [前提条件](#2-前提条件)
3. [安装方法](#3-安装方法)
4. [目录结构](#4-目录结构)
5. [环境变量](#5-环境变量)
6. [提供商配置](#6-提供商配置)
7. [桌面 GUI（可选）](#7-桌面-gui可选)
8. [代理沙箱](#8-代理沙箱)
9. [语义搜索（可选）](#9-语义搜索可选)
10. [故障排除](#10-故障排除)
11. [Docker 卷参考](#11-docker-卷参考)
12. [升级](#12-升级)
13. [后续步骤](#13-后续步骤)

---

## 1. 平台支持矩阵

| 功能 | Linux | macOS | Windows WSL2 | Windows（原生） |
|------|-------|-------|--------------|----------------|
| CLI + REST API | ✅ 完全 | ✅ 完全 | ✅ 完全 | ✅ 完全 |
| Docker | ✅ 完全 | ✅ Docker Desktop | ✅ Docker Desktop | ✅ Docker Desktop |
| 沙箱（bubblewrap） | ✅ 完全 | ❌ 回退到 `none` | ✅ 完全（WSL2 内） | ❌ 回退到 `none` |
| Web Management Console | ✅ Full | ✅ Full | ✅ Full | ✅ Full |
| 语义搜索（Qdrant） | ✅ | ✅ | ✅ | ✅ |

**关于 bubblewrap 的说明：** Linux 用户命名空间沙箱。macOS 和 Windows 原生会自动回退到沙箱模式 `none`，无需配置。

---

## 2. 前提条件

### Node.js >= 22.0.0

**原因：** SIDJUA 使用 ES 模块、原生 `fetch()` 和 `crypto.subtle`，这些都需要 Node.js 22 以上版本。

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

**macOS（.pkg 安装程序）：** 从 [nodejs.org/en/download](https://nodejs.org/en/download) 下载。

**Windows（winget）:**
```powershell
winget install OpenJS.NodeJS.LTS
```

**Windows（.msi）：** 从 [nodejs.org/en/download](https://nodejs.org/en/download) 下载。

**WSL2：** 在 WSL2 终端内使用 Ubuntu/Debian 说明。

验证：
```bash
node --version   # 必须 >= 22.0.0
npm --version    # 必须 >= 10.0.0
```

---

### C/C++ 工具链（仅源代码构建）

**原因：** `better-sqlite3` 和 `argon2` 在 `npm ci` 期间编译原生 Node.js 插件。Docker 用户可跳过此步骤。

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

**Windows：** 安装带有 **使用 C++ 的桌面开发** 工作负载的 [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)，然后：
```powershell
npm install --global windows-build-tools
```

**Alpine Linux:**
```bash
apk add python3 make g++ build-base linux-headers
```

---

### Docker >= 24（可选）

仅 Docker 安装方法需要。必须提供 Docker Compose V2 插件（`docker compose`）。

**Linux：** 按照 [docs.docker.com/engine/install](https://docs.docker.com/engine/install/) 上的说明操作。
Docker Compose V2 已包含在 Docker Engine >= 24 中。

**macOS / Windows：** 安装 [Docker Desktop](https://www.docker.com/products/docker-desktop/)（包含 Docker Compose V2）。

验证：
```bash
docker --version          # 必须 >= 24.0.0
docker compose version    # 必须显示 v2.x.x
```

---

### Git

任何最新版本。通过 OS 包管理器或 [git-scm.com](https://git-scm.com) 安装。

---

## 3. 安装方法

### 方法 A — Docker（推荐）

获得可用 SIDJUA 安装的最快途径。所有依赖项都打包在镜像中。

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
docker compose up -d
```

等待服务变为健康状态（首次构建最多约 60 秒）：

```bash
docker compose ps
# NAME              STATUS
# sidjua            Up X seconds (healthy)
# sidjua-qdrant     Up X seconds (healthy)
```

获取自动生成的 API 密钥：

```bash
docker compose exec sidjua cat /app/.system/api-key
```

从您的 `divisions.yaml` 引导治理：

```bash
docker compose exec sidjua sidjua apply --verbose
```

运行系统健康检查：

```bash
docker compose exec sidjua sidjua selftest
```

**ARM64 说明：** Docker 镜像基于 `node:22-alpine` 构建，支持 `linux/amd64` 和 `linux/arm64`。Raspberry Pi（64 位）和 Apple Silicon Mac（通过 Docker Desktop）开箱即用。

**Docker 中的 Bubblewrap：** 要在容器内启用代理沙箱，请在 Docker 运行命令中添加 `--cap-add=SYS_ADMIN`，或在 `docker-compose.yml` 中设置：
```yaml
cap_add:
  - SYS_ADMIN
```

---

### 方法 B — npm 全局安装

```bash
npm install -g sidjua
```

运行交互式设置向导（3 个步骤：工作区位置、提供商、第一个代理）：
```bash
sidjua init
```

对于非交互式 CI 或容器环境：
```bash
sidjua init --yes
```

启动零配置 AI 指南（无需 API 密钥）：
```bash
sidjua chat guide
```

---

### 方法 C — 源代码构建

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
npm ci
npm run build
```

构建过程使用 `tsup` 将 `src/index.ts` 编译为：
- `dist/index.js`（ESM）
- `dist/index.cjs`（CommonJS）

构建后步骤将 i18n 区域设置文件、默认角色、分部和知识库模板复制到 `dist/`。

从源代码运行：
```bash
node dist/index.js --help
```

运行测试套件：
```bash
npm test                    # 所有测试
npm run test:coverage       # 含覆盖率报告
npx tsc --noEmit            # 仅类型检查
```

---

## 4. 目录结构

### Docker 部署路径

| 路径 | Docker 卷 | 用途 | 管理者 |
|------|----------|------|--------|
| `/app/dist/` | 镜像层 | 编译后的应用程序 | SIDJUA |
| `/app/node_modules/` | 镜像层 | Node.js 依赖项 | SIDJUA |
| `/app/system/` | 镜像层 | 内置默认值和模板 | SIDJUA |
| `/app/defaults/` | 镜像层 | 默认配置文件 | SIDJUA |
| `/app/docs/` | 镜像层 | 捆绑的文档 | SIDJUA |
| `/app/data/` | `sidjua-data` | SQLite 数据库、备份、知识集合 | 用户 |
| `/app/config/` | `sidjua-config` | `divisions.yaml` 和自定义配置 | 用户 |
| `/app/logs/` | `sidjua-logs` | 结构化日志文件 | 用户 |
| `/app/.system/` | `sidjua-system` | API 密钥、更新状态、进程锁 | SIDJUA 管理 |
| `/app/agents/` | `sidjua-workspace` | 代理定义、技能、模板 | 用户 |
| `/app/governance/` | `sidjua-governance` | 审计跟踪、治理快照 | 用户 |

---

### 手动 / npm 安装路径

`sidjua init` 后，您的工作区组织如下：

```
~/sidjua-workspace/           # 或 SIDJUA_CONFIG_DIR
├── divisions.yaml            # 您的治理配置
├── .sidjua/                  # 内部状态（WAL、遥测缓冲区）
│   └── telemetry.db
├── data/
│   ├── sidjua.db             # 主数据库（代理、任务、审计、成本）
│   ├── knowledge/            # 每个代理的知识数据库
│   │   └── <agent-id>.db
│   └── backups/              # HMAC 签名的备份存档
├── agents/                   # 代理技能目录
├── governance/               # 审计跟踪（仅追加）
├── logs/                     # 应用程序日志
└── system/                   # 运行时状态
```

---

### SQLite 数据库

| 数据库 | 路径 | 内容 |
|--------|------|------|
| 主数据库 | `data/sidjua.db` | 代理、任务、成本、治理快照、API 密钥、审计日志 |
| 遥测 | `.sidjua/telemetry.db` | 可选的选择加入错误报告（PII 已删除） |
| 知识 | `data/knowledge/<agent-id>.db` | 每个代理的向量嵌入和 BM25 索引 |

SQLite 数据库是单文件、跨平台、可移植的。使用 `sidjua backup create` 进行备份。

---

## 5. 环境变量

将 `.env.example` 复制到 `.env` 并自定义。除非另有说明，所有变量都是可选的。

### 服务器

| 变量 | 默认值 | 描述 |
|------|-------|------|
| `SIDJUA_PORT` | `3000` | REST API 监听端口 |
| `SIDJUA_HOST` | `127.0.0.1` | REST API 绑定地址。远程访问使用 `0.0.0.0` |
| `NODE_ENV` | `production` | 运行时模式（`production` 或 `development`） |
| `SIDJUA_API_KEY` | 自动生成 | REST API 持有者令牌。首次启动时如不存在则自动创建 |
| `SIDJUA_MAX_BODY_SIZE` | `2097152`（2 MiB） | 入站请求体的最大大小（字节） |

### 目录覆盖

| 变量 | 默认值 | 描述 |
|------|-------|------|
| `SIDJUA_DATA_DIR` | `<workspace>/data` | 覆盖数据目录位置 |
| `SIDJUA_CONFIG_DIR` | `<workspace>` | 覆盖配置目录位置 |
| `SIDJUA_LOG_DIR` | `<workspace>/logs` | 覆盖日志目录位置 |

### 语义搜索

| 变量 | 默认值 | 描述 |
|------|-------|------|
| `SIDJUA_QDRANT_URL` | `http://localhost:6333` | Qdrant 向量数据库端点。Docker 默认：`http://qdrant:6333` |
| `OPENAI_API_KEY` | — | OpenAI `text-embedding-3-large` 嵌入所需 |
| `SIDJUA_CF_ACCOUNT_ID` | — | 免费嵌入的 Cloudflare 账户 ID |
| `SIDJUA_CF_TOKEN` | — | 免费嵌入的 Cloudflare API 令牌 |

### LLM 提供商

| 变量 | 提供商 |
|------|-------|
| `ANTHROPIC_API_KEY` | Anthropic（Claude） |
| `OPENAI_API_KEY` | OpenAI（GPT-4、嵌入） |
| `GOOGLE_AI_API_KEY` | Google AI（Gemini） |
| `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` | Cloudflare Workers AI（免费套餐） |
| `GROQ_API_KEY` | Groq（快速推理，提供免费套餐） |
| `DEEPSEEK_API_KEY` | DeepSeek |

---

## 6. 提供商配置

### 零配置选项

`sidjua chat guide` 无需 API 密钥即可工作。它通过 SIDJUA 代理连接到 Cloudflare Workers AI。有速率限制，但适合评估和入门。

### 添加您的第一个提供商

**Groq（免费套餐，无需信用卡）：**
```bash
sidjua key set groq <your-groq-api-key>
sidjua provider list
```
在 [console.groq.com](https://console.groq.com) 获取免费密钥。

**Anthropic（推荐用于生产环境）：**
```bash
export ANTHROPIC_API_KEY=sk-ant-...
sidjua key set anthropic $ANTHROPIC_API_KEY
```

**Ollama（隔离网络 / 本地部署）：**
```bash
sidjua provider add-custom \
  --id ollama \
  --name "Ollama (local)" \
  --base-url http://localhost:11434/v1 \
  --model llama3.2
```

验证所有已配置的提供商：
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

## 8. 代理沙箱

SIDJUA 使用可插拔的 `SandboxProvider` 接口。沙箱将代理技能执行包装在 OS 级别的进程隔离中。

### 按平台的沙箱支持

| 平台 | 沙箱提供商 | 备注 |
|------|----------|------|
| Linux（原生） | `bubblewrap` | 完整的用户命名空间隔离 |
| Docker（Linux 容器） | `bubblewrap` | 需要 `--cap-add=SYS_ADMIN` |
| macOS | `none`（自动回退） | macOS 不支持 Linux 用户命名空间 |
| Windows WSL2 | `bubblewrap` | 在 WSL2 内像在 Linux 上一样安装 |
| Windows（原生） | `none`（自动回退） | |

### 安装 bubblewrap（Linux）

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

### 配置

在 `divisions.yaml` 中：
```yaml
governance:
  sandbox: bubblewrap    # 或：none
```

验证沙箱可用性：
```bash
sidjua sandbox check
```

---

## 9. 语义搜索（可选）

语义搜索为 `sidjua memory search` 和代理知识检索提供支持。需要 Qdrant 向量数据库和嵌入提供商。

### Docker Compose 配置文件

包含的 `docker-compose.yml` 有一个 `semantic-search` 配置文件：
```bash
docker compose --profile semantic-search up -d
```
这会在 SIDJUA 旁边启动一个 Qdrant 容器。

### 独立 Qdrant

```bash
docker run -d \
  --name sidjua-qdrant \
  -p 6333:6333 \
  -v qdrant-storage:/qdrant/storage \
  qdrant/qdrant:v1.13.2
```

设置端点：
```bash
export SIDJUA_QDRANT_URL=http://localhost:6333
```

### 不使用 Qdrant

如果 Qdrant 不可用，`sidjua memory import` 和 `sidjua memory search` 将被禁用。所有其他 SIDJUA 功能（CLI、REST API、代理执行、治理、审计）正常工作。系统将回退到 BM25 关键词搜索处理知识查询。

---

## 10. 故障排除

### 所有平台

**`npm ci` 因 `node-pre-gyp` 或 `node-gyp` 错误失败：**
```
gyp ERR! build error
```
安装 C/C++ 工具链（参见前提条件部分）。Ubuntu 上：`sudo apt-get install -y python3 make g++ build-essential`。

**`Cannot find divisions.yaml`：**
检查 `SIDJUA_CONFIG_DIR`。文件必须位于 `$SIDJUA_CONFIG_DIR/divisions.yaml`。运行 `sidjua init` 创建工作区结构。

**REST API 返回 401 Unauthorized：**
验证 `Authorization: Bearer <key>` 请求头。使用以下命令获取自动生成的密钥：
```bash
cat ~/.sidjua/.system/api-key          # 手动安装
docker compose exec sidjua cat /app/.system/api-key  # Docker
```

**端口 3000 已被占用：**
```bash
SIDJUA_PORT=3001 sidjua server start
# 或在 .env 中设置：SIDJUA_PORT=3001
```

---

### Ubuntu / Debian

**`better-sqlite3` 因找不到 `futex.h` 而编译失败：**
```bash
sudo apt-get install -y linux-headers-$(uname -r)
```

---

### Fedora / RHEL

**SELinux 阻止 Docker 卷挂载：**
```yaml
# 为 SELinux 上下文添加 :Z 标签
volumes:
  - ./my-config:/app/config:Z
```
或手动设置 SELinux 上下文：
```bash
chcon -Rt svirt_sandbox_file_t ./my-config
```

---

### Arch Linux

**Node.js 版本太旧：**
使用 `nvm` 安装 Node.js 22：
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

**Docker Desktop 内存不足：**
打开 Docker Desktop → 设置 → 资源 → 内存。增加到至少 4 GB。

**Apple Silicon — 架构不匹配：**
验证您的 Node.js 安装是原生 ARM64（而非 Rosetta）：
```bash
node -e "console.log(process.arch)"
# 预期：arm64
```
如果显示 `x64`，请使用 nodejs.org 的 ARM64 安装程序重新安装 Node.js。

---

### Windows（原生）

**找不到 `MSBuild` 或 `cl.exe`：**
安装 [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) 并选择**使用 C++ 的桌面开发**工作负载。然后运行：
```powershell
npm install --global windows-build-tools
```

**长路径错误（`ENAMETOOLONG`）：**
在 Windows 注册表中启用长路径支持：
```powershell
# 以管理员身份运行
Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" `
  -Name LongPathsEnabled -Value 1
```

**`npm install -g` 后找不到 `sidjua` 命令：**
将 npm 全局 bin 目录添加到 PATH：
```powershell
npm config get prefix  # 例如 C:\Users\you\AppData\Roaming\npm
# 将该路径添加到系统环境变量 → Path
```

---

### Windows WSL2

**Docker 无法在 WSL2 内启动：**
打开 Docker Desktop → 设置 → 常规 → 启用**使用 WSL 2 基础引擎**。
然后重启 Docker Desktop 和 WSL2 终端。

**`/mnt/c/` 下文件的权限错误：**
在 WSL2 中挂载的 Windows NTFS 卷具有受限权限。将工作区移动到 Linux 原生路径：
```bash
mkdir ~/sidjua-workspace
cd ~/sidjua-workspace
sidjua init
```

---

### Raspberry Pi / ARM64

**`npm ci` 非常慢（5-10 分钟）：**
这是正常的。ARM64 上的原生插件编译需要更长时间。考虑改用 Docker 镜像：
```bash
docker pull sidjua/sidjua:latest-arm64
```

**构建期间内存不足：**
添加交换空间：
```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

---

## 11. Docker 卷参考

### 命名卷

| 卷名称 | 容器路径 | 用途 |
|--------|---------|------|
| `sidjua-data` | `/app/data` | SQLite 数据库、备份存档、知识集合 |
| `sidjua-config` | `/app/config` | `divisions.yaml`、自定义配置 |
| `sidjua-logs` | `/app/logs` | 结构化应用程序日志 |
| `sidjua-system` | `/app/.system` | API 密钥、更新状态、进程锁文件 |
| `sidjua-workspace` | `/app/agents` | 代理技能目录、定义、模板 |
| `sidjua-governance` | `/app/governance` | 不可变审计跟踪、治理快照 |
| `qdrant-storage` | `/qdrant/storage` | Qdrant 向量索引（仅限语义搜索配置文件） |

### 使用主机目录

要挂载您自己的 `divisions.yaml` 而不是在容器内编辑：

```yaml
# docker-compose.override.yml
services:
  sidjua:
    volumes:
      - ./my-config:/app/config   # 替换 sidjua-config 命名卷
```

### 备份

```bash
sidjua backup create                    # 从容器内部
# 或
docker compose exec sidjua sidjua backup create
```

备份是存储在 `/app/data/backups/` 中的 HMAC 签名存档。

---

## 12. 升级

### Docker

```bash
git pull
docker compose build --no-cache
docker compose up -d
docker compose exec sidjua sidjua apply    # 运行架构迁移
```

`sidjua apply` 是幂等的——升级后重新运行总是安全的。

### npm 全局安装

```bash
npm update -g sidjua
sidjua apply    # 运行架构迁移
```

### 源代码构建

```bash
git pull
npm ci
npm run build
node dist/index.js apply    # 运行架构迁移
```

### 回滚

SIDJUA 在每次 `sidjua apply` 之前创建治理快照。要回滚：

```bash
sidjua rollback list
sidjua rollback <version>
```

---

## 13. 后续步骤

| 资源 | 命令 / 链接 |
|------|-----------|
| 快速入门 | [docs/QUICK-START.md](QUICK-START.md) |
| CLI 参考 | [docs/CLI-REFERENCE.md](CLI-REFERENCE.md) |
| 治理示例 | [docs/GOVERNANCE-EXAMPLES.md](GOVERNANCE-EXAMPLES.md) |
| 免费 LLM 提供商指南 | [docs/FREE-LLM-PROVIDER-GUIDE.md](FREE-LLM-PROVIDER-GUIDE.md) |
| 故障排除 | [docs/TROUBLESHOOTING.md](TROUBLESHOOTING.md) |

安装后首先运行的命令：

```bash
sidjua chat guide    # 零配置 AI 指南——无需 API 密钥
sidjua selftest      # 系统健康检查（7 个类别，0-100 分）
sidjua apply         # 从 divisions.yaml 配置代理
```
