[English](../../README.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [Français](README.fr.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [中文 (简体)](README.zh-CN.md) | [中文 (繁體)](README.zh-TW.md) | [العربية](README.ar.md) | [বাংলা](README.bn.md) | [Čeština](README.cs.md) | [Filipino](README.fil.md) | [हिन्दी](README.hi.md) | [Bahasa Indonesia](README.id.md) | [Italiano](README.it.md) | [Bahasa Melayu](README.ms.md) | [Nederlands](README.nl.md) | [Polski](README.pl.md) | [Português (BR)](README.pt-BR.md) | [Română](README.ro.md) | [Русский](README.ru.md) | [Svenska](README.sv.md) | [ภาษาไทย](README.th.md) | [Türkçe](README.tr.md) | [Українська](README.uk.md) | [Tiếng Việt](README.vi.md)

> *本页面已从[英文原版](../../README.md)自动翻译。发现错误？[请报告](https://github.com/GoetzKohlberg/sidjua/issues)。*

# SIDJUA — AI 智能体治理平台

> 唯一一个通过架构强制执行治理的智能体平台，而不是寄希望于模型的自觉。

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Docker](https://img.shields.io/badge/Docker-sidjua%2Fsidjua-blue)](https://hub.docker.com/r/sidjua/sidjua)
[![Version](https://img.shields.io/badge/version-1.0.0-green)](https://github.com/sidjua-dev/sidjua/releases)

---

## 安装

### 前提条件

| 工具 | 是否必须 | 说明 |
|------|----------|------|
| **Node.js** | >= 22.0.0 | ES 模块、`fetch()`、`crypto.subtle`。[下载](https://nodejs.org) |
| **C/C++ 工具链** | 仅源码构建 | `better-sqlite3` 和 `argon2` 需要编译本地插件 |
| **Docker** | >= 24（可选） | 仅用于 Docker 部署 |

安装 Node.js 22：Ubuntu/Debian（`curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs`），macOS（`brew install node@22`），Windows（`winget install OpenJS.NodeJS.LTS`）。

安装 C/C++ 工具：Ubuntu（`sudo apt-get install -y python3 make g++ build-essential`），macOS（`xcode-select --install`），Windows（`npm install --global windows-build-tools`）。

### 选项 A — Docker（推荐）

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
docker compose up -d
```

```bash
# 查看自动生成的 API 密钥
docker compose exec sidjua cat /app/.system/api-key

# 初始化治理
docker compose exec sidjua sidjua apply --verbose

# 系统健康检查
docker compose exec sidjua sidjua selftest
```

支持 **linux/amd64** 和 **linux/arm64**（Raspberry Pi、Apple Silicon）。

### 选项 B — npm 全局安装

```bash
npm install -g sidjua
sidjua init          # 交互式三步设置
sidjua chat guide    # 零配置 AI 向导（无需 API 密钥）
```

### 选项 C — 源码构建

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
npm ci && npm run build
node dist/index.js --help
```

### 平台说明

| 功能 | Linux | macOS | Windows (WSL2) | Windows（原生） |
|------|-------|-------|----------------|-----------------|
| CLI + REST API | ✅ 完整 | ✅ 完整 | ✅ 完整 | ✅ 完整 |
| Docker | ✅ 完整 | ✅ 完整 (Desktop) | ✅ 完整 (Desktop) | ✅ 完整 (Desktop) |
| 沙箱隔离 (bubblewrap) | ✅ 完整 | ❌ 回退到 `none` | ✅ 完整（WSL2 内） | ❌ 回退到 `none` |
| Web Management Console | ✅ Full | ✅ Full | ✅ Full | ✅ Full |

无需外部数据库。SIDJUA 使用 SQLite。Qdrant 可选（仅用于语义搜索）。

有关目录结构、环境变量、各系统故障排除和 Docker 卷参考的完整指南，请参阅 [docs/INSTALLATION.md](docs/INSTALLATION.md)。

---

## 为什么选择 SIDJUA？

当今所有 AI 智能体框架都依赖同一个错误假设：可以信任 AI 遵循自己的规则。

**基于提示的治理问题：**

你给智能体一个系统提示，说"永远不要访问客户 PII"。智能体读取了这条指令。智能体同时也读取了用户要求拉取张三付款记录的消息。智能体自行决定是否遵守。那不是治理。那只是措辞强硬的建议。

**SIDJUA 与众不同。**

治理位于智能体**外部**。每个动作在执行**之前**都要通过一个五步预操作执行管道。你在 YAML 中定义规则。系统强制执行规则。智能体永远没有机会决定是否遵守，因为检查在智能体行动之前就已经发生了。

这是通过架构实现的治理——不是靠提示、不是靠微调、不是靠期望。

---

## 工作原理

SIDJUA 用外部治理层包裹你的智能体。在提议的动作通过五阶段执行管道之前，智能体的 LLM 调用永远不会发生：

**阶段 1 — 禁止：** 被封锁的动作立即被拒绝。无 LLM 调用、无标记为"已允许"的日志条目、无第二次机会。如果动作在禁止列表上，它就在这里停止。

**阶段 2 — 审批：** 需要人工签字的动作在执行前被挂起等待审批。智能体等待。人类决定。

**阶段 3 — 预算：** 每个任务都受实时成本限制约束。每任务和每智能体的预算被强制执行。当达到限制时，任务被取消——不是标记，不是记录待审查，而是*取消*。

**阶段 4 — 分类：** 跨部门边界的数据按分类规则进行检查。二级智能体无法访问 SECRET 数据。A 部门的智能体无法读取 B 部门的机密。

**阶段 5 — 策略：** 结构化执行的自定义组织规则。API 调用频率限制、输出令牌上限、时间窗口限制。

整个管道在任何动作执行之前运行。对于治理关键操作，不存在"记录后再审查"模式。

### 单一配置文件

你的整个智能体组织存储在一个 `divisions.yaml` 中：

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

`sidjua apply` 读取此文件并配置完整的智能体基础设施：智能体、部门、RBAC、路由、审计表、机密路径和治理规则——通过 10 个可重现的步骤。

### 智能体架构

智能体被组织为**部门**（职能组）和**层级**（信任级别）。一级智能体在其治理信封内具有完全自主权。二级智能体需要对敏感操作进行审批。三级智能体完全受监督。层级系统在结构上强制执行——智能体无法自我晋升。

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

## 架构约束

SIDJUA 在架构级别强制执行这些约束——它们无法被智能体禁用、绕过或覆盖：

1. **治理是外部的：** 治理层包裹智能体。智能体无法访问治理代码，无法修改规则，也无法检测治理是否存在。

2. **预操作，而非后操作：** 每个动作在执行之前都要经过检查。对于治理关键操作，不存在"记录后再审查"模式。

3. **结构化执行：** 规则由代码路径强制执行，而不是通过提示或模型指令。智能体无法从治理中"越狱"，因为治理不是作为对模型的指令实现的。

4. **审计不可变性：** Write-Ahead Log (WAL) 是带有完整性验证的仅追加日志。被篡改的条目会被检测并排除。

5. **部门隔离：** 不同部门的智能体无法访问彼此的数据、机密或通信渠道。

---

## 对比

| 功能 | SIDJUA | CrewAI | AutoGen | LangGraph | OpenClaw |
|------|--------|--------|---------|-----------|----------|
| 外部治理 | ✅ 架构级 | ❌ | ❌ | ❌ | ❌ |
| 预操作执行 | ✅ 五步管道 | ❌ | ❌ | ❌ | ❌ |
| EU AI 法案就绪 | ✅ | ❌ | ❌ | ❌ | ❌ |
| 自托管 | ✅ | ❌ 云端 | ❌ 云端 | ❌ 云端 | ✅ 插件 |
| 离网部署 | ✅ | ❌ | ❌ | ❌ | ❌ |
| 模型无关 | ✅ 任意 LLM | 部分 | 部分 | 部分 | ✅ |
| 双向邮件 | ✅ | ❌ | ❌ | ❌ | ❌ |
| Discord 网关 | ✅ | ❌ | ❌ | ❌ | ❌ |
| 层级化智能体 | ✅ 部门 + 层级 | 基础 | 基础 | 图 | ❌ |
| 预算执行 | ✅ 每智能体限额 | ❌ | ❌ | ❌ | ❌ |
| 沙箱隔离 | ✅ bubblewrap | ❌ | ❌ | ❌ | ❌ |
| 审计不可变性 | ✅ WAL + 完整性 | ❌ | ❌ | ❌ | ❌ |
| 许可证 | AGPL-3.0 | MIT | MIT | MIT | 混合 |
| 独立审计 | ✅ 2 家外部 | ❌ | ❌ | ❌ | ❌ |

---

## 功能特性

### 治理与合规

**预操作管道（第 0 阶段）** 在每个智能体动作之前运行：禁止检查 → 人工审批 → 预算执行 → 数据分类 → 自定义策略。全部五个阶段都是结构性的——它们在代码中执行，而不是在智能体的提示词中。

**强制基线规则** 随每次安装提供：10 条治理规则（`SYS-SEC-001` 到 `SYS-GOV-002`），不能通过用户配置删除或削弱。自定义规则扩展基线，但不能覆盖它。

**EU AI 法案合规** — 审计追踪、分类框架和审批工作流直接映射到第 9 条、第 12 条和第 17 条的要求。2026 年 8 月的合规截止日期已纳入产品路线图。

**合规报告** 通过 `sidjua audit report/violations/agents/export`：合规评分、每智能体信任评分、违规历史、面向外部审计师或 SIEM 集成的 CSV/JSON 导出。

**Write-Ahead Log (WAL)** 与完整性验证：每项治理决策在执行前都写入仅追加日志。被篡改的条目在读取时被检测到。`sidjua memory recover` 重新验证并修复。

### 通信

智能体不只是响应 API 调用——它们参与真实的通信渠道。

**双向邮件** (`sidjua email status/test/threads`)：智能体通过 IMAP 轮询接收邮件，通过 SMTP 回复。通过 In-Reply-To 标头进行线程映射，保持对话连贯。发件人白名单、正文大小限制和 HTML 过滤保护智能体管道免受恶意输入。

**Discord 网关机器人**：通过 `sidjua module install discord` 提供完整的斜杠命令界面。智能体响应 Discord 消息，维护对话线程，并发送主动通知。

**Telegram 集成**：通过 Telegram 机器人发送智能体警报和通知。多渠道适配器模式并行支持 Telegram、Discord、ntfy 和邮件。

### 运维

**单一 Docker 命令**即可投入生产：

```bash
docker run -p 4200:4200 sidjua/sidjua:latest
```

API 密钥在首次启动时自动生成并打印到容器日志。无需环境变量。无需配置。无需数据库服务器——SIDJUA 使用 SQLite，每个智能体一个数据库文件。

**CLI 管理** — 从单个二进制文件完成完整生命周期：

```bash
sidjua init                      # 交互式工作区设置（3 步）
sidjua apply                     # 从 divisions.yaml 配置
sidjua agent create/list/stop    # 智能体生命周期
sidjua run "任务..." --wait      # 提交带治理执行的任务
sidjua audit report              # 合规报告
sidjua costs                     # 按部门/智能体划分的成本明细
sidjua backup create/restore     # HMAC 签名的备份管理
sidjua update                    # 带自动预备份的版本更新
sidjua rollback                  # 一键回滚到上一版本
sidjua email status/test         # 邮件渠道管理
sidjua secret set/get/rotate     # 加密机密管理
sidjua memory import/search      # 语义知识管道
sidjua selftest                  # 系统健康检查（7 个类别，0-100 分）
```

**语义记忆** — 导入对话和文档（`sidjua memory import ~/exports/claude-chats.zip`），使用向量 + BM25 混合排名搜索。支持 Cloudflare Workers AI 嵌入（免费，零配置）和 OpenAI 大型嵌入（适用于大型知识库的更高质量）。

**自适应分块** — 记忆管道自动调整块大小，以保持在每个嵌入模型的令牌限制内。

**零配置向导** — `sidjua chat guide` 无需任何 API 密钥即可启动交互式 AI 助手，通过 SIDJUA 代理由 Cloudflare Workers AI 提供支持。询问如何设置智能体、配置治理，或了解审计日志中发生了什么。

**离网部署** — 使用 Ollama 或任何兼容 OpenAI 的端点通过本地 LLM 在完全断开互联网的情况下运行。默认无遥测。可选的崩溃报告，完全去除 PII。

### 安全

**沙箱隔离** — 智能体技能通过 bubblewrap（Linux 用户命名空间）在操作系统级别的进程隔离中运行。零额外 RAM 开销。可插拔的 `SandboxProvider` 接口：开发用 `none`，生产用 `bubblewrap`。

**机密管理** — 带 RBAC 的加密机密存储（`sidjua secret set/get/list/delete/rotate/namespaces`）。无需外部保险库。

**安全优先构建** — 广泛的内部测试套件，加上 2 名外部代码审计师（DeepSeek V3 和 xAI Grok）的独立验证。每个 API 表面都有安全标头、CSRF 保护、速率限制和输入清理。全程使用参数化查询防止 SQL 注入。

**备份完整性** — 带有 zip 跳跃保护、zip 炸弹防护和还原时清单校验和验证的 HMAC 签名备份归档。

---

## 从其他框架导入

```bash
# 预览将导入的内容——不做任何更改
sidjua import openclaw --dry-run

# 导入配置 + 技能文件
sidjua import openclaw --skills
```

你的现有智能体保留其身份、模型和技能。SIDJUA 自动添加治理、审计追踪和预算控制。

---

## 配置参考

一个最简的入门 `divisions.yaml`：

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

`sidjua apply` 从此文件配置完整的基础设施。更改后再次运行——它是幂等的。

有关所有 10 个配置步骤的完整规范，请参阅 [docs/SIDJUA-APPLY-TECH-SPEC-V1.md](docs/SIDJUA-APPLY-TECH-SPEC-V1.md)。

---

## REST API

SIDJUA REST API 与仪表板在同一端口运行：

```bash
sidjua server start --port 4200 --api-key $SIDJUA_API_KEY
```

关键端点：

```
GET  /api/v1/health          # 公开健康检查（无需认证）
GET  /api/v1/info            # 系统元数据（已认证）
POST /api/v1/execute/run     # 提交任务
GET  /api/v1/execute/:id/status  # 任务状态
GET  /api/v1/execute/:id/result  # 任务结果
GET  /api/v1/events          # SSE 事件流
GET  /api/v1/audit/report    # 合规报告
```

除 `/health` 之外的所有端点都需要 Bearer 认证。生成密钥：

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

或使用包含的 `docker-compose.yml`，它为配置、日志和智能体工作区添加命名卷，以及用于语义搜索的可选 Qdrant 服务：

```bash
docker compose up -d
docker compose exec sidjua sidjua init
docker compose exec sidjua sidjua apply
```

---

## 提供商

SIDJUA 连接任何 LLM 提供商，无供应商锁定：

| 提供商 | 模型 | API 密钥 |
|--------|------|----------|
| Anthropic | Claude Sonnet 4.6, Haiku 4.5, Opus 4.6 | `ANTHROPIC_API_KEY` |
| Google | Gemini 2.0, Gemini 1.5 Pro | `GOOGLE_API_KEY` |
| Groq | Llama 3.x, Mixtral | `GROQ_API_KEY`（免费层） |
| Cloudflare Workers AI | Llama, Mistral, Phi | `CF_ACCOUNT_ID` + `CF_TOKEN` |
| Ollama | 任意本地模型 | 无需密钥（本地） |
| OpenAI 兼容 | 任意端点 | 自定义 URL + 密钥 |

```bash
# 添加提供商密钥
sidjua key set groq gsk_...

# 列出可用提供商和模型
sidjua provider list
```

---

## 路线图

完整路线图见 [sidjua.com/roadmap](https://sidjua.com/roadmap)。

近期计划：
- 多智能体编排模式（V1.1）
- Webhook 入站触发器（V1.1）
- 智能体间通信（V1.2）
- 企业 SSO 集成（V1.x）
- 云托管治理验证服务（V1.x）

---

## 社区

- **Discord**：[sidjua.com/discord](https://sidjua.com/discord)
- **GitHub Issues**：[github.com/sidjua-dev/sidjua/issues](https://github.com/sidjua-dev/sidjua/issues)
- **邮件**：contact@sidjua.com
- **文档**：[sidjua.com/docs](https://sidjua.com/docs)

如果发现 bug，请提交 issue——我们响应迅速。

---

## 翻译

SIDJUA 提供 26 种语言版本。英语和德语由核心团队维护。所有其他翻译为 AI 生成，由社区维护。

**文档：** 本 README 和[安装指南](docs/INSTALLATION.md)提供全部 26 种语言版本。请参阅本页顶部的语言选择器。

| 地区 | 语言 |
|------|------|
| 美洲 | 英语、西班牙语、葡萄牙语（巴西） |
| 欧洲 | 德语、法语、意大利语、荷兰语、波兰语、捷克语、罗马尼亚语、俄语、乌克兰语、瑞典语、土耳其语 |
| 中东 | 阿拉伯语 |
| 亚洲 | 印地语、孟加拉语、菲律宾语、印度尼西亚语、马来语、泰语、越南语、日语、韩语、中文（简体）、中文（繁体） |

发现翻译错误？请提交 GitHub Issue，包含：
- 语言和区域代码（例如 `zh-CN`）
- 错误文本或区域文件中的键（例如 `gui.nav.dashboard`）
- 正确的翻译

想要维护某种语言？请参阅 [CONTRIBUTING.md](CONTRIBUTING.md#translations)——我们采用按语言指定维护者的模型。

---

## 许可证

**AGPL-3.0** — 只要你在相同许可证下共享修改，你可以自由使用、修改和分发 SIDJUA。托管部署的用户始终可以获取源代码。

对于需要专有部署且无 AGPL 义务的组织，提供企业许可证。
[contact@sidjua.com](mailto:contact@sidjua.com)
