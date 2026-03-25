[English](../../README.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [Français](README.fr.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [中文 (简体)](README.zh-CN.md) | [中文 (繁體)](README.zh-TW.md) | [العربية](README.ar.md) | [বাংলা](README.bn.md) | [Čeština](README.cs.md) | [Filipino](README.fil.md) | [हिन्दी](README.hi.md) | [Bahasa Indonesia](README.id.md) | [Italiano](README.it.md) | [Bahasa Melayu](README.ms.md) | [Nederlands](README.nl.md) | [Polski](README.pl.md) | [Português (BR)](README.pt-BR.md) | [Română](README.ro.md) | [Русский](README.ru.md) | [Svenska](README.sv.md) | [ภาษาไทย](README.th.md) | [Türkçe](README.tr.md) | [Українська](README.uk.md) | [Tiếng Việt](README.vi.md)

> *このページは[英語オリジナル](../../README.md)から自動翻訳されました。誤りを見つけましたか？[報告する](https://github.com/GoetzKohlberg/sidjua/issues)。*

# SIDJUA — AI エージェント ガバナンス プラットフォーム

> モデルが適切に振る舞うことを期待するのではなく、アーキテクチャによってガバナンスが強制される唯一のエージェント プラットフォーム。

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Docker](https://img.shields.io/badge/Docker-sidjua%2Fsidjua-blue)](https://hub.docker.com/r/sidjua/sidjua)
[![Version](https://img.shields.io/badge/version-1.0.0-green)](https://github.com/sidjua-dev/sidjua/releases)

---

## インストール

### 前提条件

| ツール | 必須 | 備考 |
|--------|------|------|
| **Node.js** | >= 22.0.0 | ES モジュール、`fetch()`、`crypto.subtle`。[ダウンロード](https://nodejs.org) |
| **C/C++ ツールチェーン** | ソースビルドのみ | `better-sqlite3` と `argon2` がネイティブアドオンをコンパイル |
| **Docker** | >= 24 (オプション) | Docker デプロイメントのみ |

Node.js 22 のインストール: Ubuntu/Debian (`curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs`)、macOS (`brew install node@22`)、Windows (`winget install OpenJS.NodeJS.LTS`)。

C/C++ ツールのインストール: Ubuntu (`sudo apt-get install -y python3 make g++ build-essential`)、macOS (`xcode-select --install`)、Windows (`npm install --global windows-build-tools`)。

### オプション A — Docker（推奨）

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
docker compose up -d
```

```bash
# 自動生成された API キーを表示
docker compose exec sidjua cat /app/.system/api-key

# ガバナンスをブートストラップ
docker compose exec sidjua sidjua apply --verbose

# システムヘルスチェック
docker compose exec sidjua sidjua selftest
```

**linux/amd64** および **linux/arm64**（Raspberry Pi、Apple Silicon）をサポート。

### オプション B — npm グローバルインストール

```bash
npm install -g sidjua
sidjua init          # インタラクティブな 3 ステップセットアップ
sidjua chat guide    # ゼロ設定 AI ガイド（API キー不要）
```

### オプション C — ソースビルド

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
npm ci && npm run build
node dist/index.js --help
```

### プラットフォームに関する注意事項

| 機能 | Linux | macOS | Windows (WSL2) | Windows (ネイティブ) |
|------|-------|-------|----------------|----------------------|
| CLI + REST API | ✅ フル | ✅ フル | ✅ フル | ✅ フル |
| Docker | ✅ フル | ✅ フル (Desktop) | ✅ フル (Desktop) | ✅ フル (Desktop) |
| サンドボックス (bubblewrap) | ✅ フル | ❌ `none` にフォールバック | ✅ フル (WSL2 内) | ❌ `none` にフォールバック |
| Web Management Console | ✅ Full | ✅ Full | ✅ Full | ✅ Full |

外部データベースは不要です。SIDJUA は SQLite を使用します。Qdrant はオプション（セマンティック検索のみ）。

ディレクトリ構造、環境変数、OS 別のトラブルシューティング、Docker ボリュームリファレンスを含む完全ガイドは [docs/INSTALLATION.md](docs/INSTALLATION.md) を参照してください。

---

## なぜ SIDJUA なのか？

今日のすべての AI エージェント フレームワークは、同じ誤った前提に依存しています：AI が自分自身のルールに従うことを信頼できるという前提です。

**プロンプトベースのガバナンスの問題:**

エージェントに「顧客の PII には絶対にアクセスしない」というシステムプロンプトを与えます。エージェントはその指示を読みます。エージェントはまた、ジョン・スミスの支払い履歴を取得するよう依頼するユーザーのメッセージも読みます。エージェントは自分自身で従うかどうかを決定します。それはガバナンスではありません。それは強い言葉による提案に過ぎません。

**SIDJUA は違います。**

ガバナンスはエージェントの**外側**にあります。すべてのアクションは実行される**前**に 5 ステップの事前アクション実施パイプラインを通過します。YAML でルールを定義します。システムがそれを実施します。エージェントがそれに従うかどうかを決定することはありません。なぜなら、エージェントが行動する前にチェックが行われるからです。

これはアーキテクチャによるガバナンスです — プロンプトによるでも、ファインチューニングによるでも、期待によるでもありません。

---

## 仕組み

SIDJUA はエージェントを外部ガバナンス レイヤーでラップします。エージェントの LLM 呼び出しは、提案されたアクションが 5 段階の実施パイプラインをクリアするまで行われません：

**ステージ 1 — 禁止:** ブロックされたアクションは即座に拒否されます。LLM 呼び出しなし、「許可済み」とマークされたログエントリなし、二度目のチャンスなし。アクションが禁止リストにある場合、ここで停止します。

**ステージ 2 — 承認:** 人間の承認が必要なアクションは実行前に保留されます。エージェントは待機します。人間が決定します。

**ステージ 3 — 予算:** すべてのタスクはリアルタイムのコスト制限に照らして実行されます。タスクごとおよびエージェントごとの予算が適用されます。制限に達すると、タスクはキャンセルされます — フラグが立てられるのでも、レビューのためにログに記録されるのでもなく、*キャンセル*されます。

**ステージ 4 — 分類:** 部門の境界を越えるデータは分類ルールに照らしてチェックされます。ティア 2 エージェントは SECRET データにアクセスできません。部門 A のエージェントは部門 B のシークレットを読み取れません。

**ステージ 5 — ポリシー:** カスタム組織ルールを構造的に実施。API 呼び出し頻度制限、出力トークン上限、時間ウィンドウ制限。

パイプライン全体は、アクションが実行される前に実行されます。ガバナンスが重要な操作には「後でログに記録してレビュー」モードはありません。

### 単一設定ファイル

エージェント組織全体が 1 つの `divisions.yaml` に収まります：

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

`sidjua apply` はこのファイルを読み込み、完全なエージェントインフラストラクチャをプロビジョニングします：エージェント、部門、RBAC、ルーティング、監査テーブル、シークレットパス、ガバナンスルール — 10 の再現可能なステップで。

### エージェントアーキテクチャ

エージェントは**部門**（機能グループ）と**ティア**（信頼レベル）に編成されます。ティア 1 エージェントはガバナンス エンベロープ内で完全な自律性を持ちます。ティア 2 エージェントは機密性の高い操作に承認が必要です。ティア 3 エージェントは完全に監督されます。ティアシステムは構造的に適用されます — エージェントは自己昇格できません。

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

## アーキテクチャの制約

SIDJUA はこれらの制約をアーキテクチャレベルで実施します — エージェントによって無効化、回避、または上書きすることはできません：

1. **ガバナンスは外部:** ガバナンスレイヤーがエージェントをラップします。エージェントはガバナンスコードにアクセスできず、ルールを変更できず、ガバナンスが存在するかどうかを検出できません。

2. **事前アクション、事後アクションではない:** すべてのアクションは実行前にチェックされます。ガバナンスが重要な操作には「後でログに記録してレビュー」モードはありません。

3. **構造的実施:** ルールはプロンプトやモデルの指示によってではなく、コードパスによって実施されます。エージェントはガバナンスから「ジェイルブレイク」できません。なぜなら、ガバナンスはモデルへの指示として実装されていないからです。

4. **監査の不変性:** Write-Ahead Log (WAL) は整合性検証を持つ追記専用です。改ざんされたエントリは検出され、除外されます。

5. **部門の分離:** 異なる部門のエージェントは、互いのデータ、シークレット、または通信チャネルにアクセスできません。

---

## 比較

| 機能 | SIDJUA | CrewAI | AutoGen | LangGraph | OpenClaw |
|------|--------|--------|---------|-----------|----------|
| 外部ガバナンス | ✅ アーキテクチャ | ❌ | ❌ | ❌ | ❌ |
| 事前アクション実施 | ✅ 5 ステップパイプライン | ❌ | ❌ | ❌ | ❌ |
| EU AI 法対応 | ✅ | ❌ | ❌ | ❌ | ❌ |
| セルフホスト | ✅ | ❌ クラウド | ❌ クラウド | ❌ クラウド | ✅ プラグイン |
| エアギャップ対応 | ✅ | ❌ | ❌ | ❌ | ❌ |
| モデル非依存 | ✅ 任意の LLM | 部分的 | 部分的 | 部分的 | ✅ |
| 双方向メール | ✅ | ❌ | ❌ | ❌ | ❌ |
| Discord ゲートウェイ | ✅ | ❌ | ❌ | ❌ | ❌ |
| 階層的エージェント | ✅ 部門 + ティア | 基本的 | 基本的 | グラフ | ❌ |
| 予算実施 | ✅ エージェントごとの制限 | ❌ | ❌ | ❌ | ❌ |
| サンドボックス分離 | ✅ bubblewrap | ❌ | ❌ | ❌ | ❌ |
| 監査の不変性 | ✅ WAL + 整合性 | ❌ | ❌ | ❌ | ❌ |
| ライセンス | AGPL-3.0 | MIT | MIT | MIT | 混合 |
| 独立監査 | ✅ 外部 2 件 | ❌ | ❌ | ❌ | ❌ |

---

## 機能

### ガバナンスとコンプライアンス

**事前アクション パイプライン（ステージ 0）** はすべてのエージェントアクションの前に実行されます：禁止チェック → 人間の承認 → 予算実施 → データ分類 → カスタムポリシー。5 つのステージはすべて構造的です — エージェントのプロンプトではなく、コードで実行されます。

**必須ベースラインルール** はすべてのインストールに同梱されます：ユーザー設定では削除または弱体化できない 10 のガバナンスルール（`SYS-SEC-001` から `SYS-GOV-002`）。カスタムルールはベースラインを拡張します。上書きはできません。

**EU AI 法コンプライアンス** — 監査証跡、分類フレームワーク、承認ワークフローは第 9 条、第 12 条、第 17 条の要件に直接マッピングされます。2026 年 8 月のコンプライアンス期限は製品ロードマップに組み込まれています。

**コンプライアンスレポート** `sidjua audit report/violations/agents/export` 経由：コンプライアンススコア、エージェントごとの信頼スコア、違反履歴、外部監査人または SIEM 統合のための CSV/JSON エクスポート。

**Write-Ahead Log (WAL)** と整合性検証：すべてのガバナンス決定は実行前に追記専用ログに書き込まれます。改ざんされたエントリは読み取り時に検出されます。`sidjua memory recover` が再検証と修復を行います。

### コミュニケーション

エージェントは API 呼び出しに応答するだけでなく、実際のコミュニケーションチャネルに参加します。

**双方向メール** (`sidjua email status/test/threads`)：エージェントは IMAP ポーリング経由でメールを受信し、SMTP 経由で返信します。In-Reply-To ヘッダーによるスレッドマッピングで会話の一貫性を保ちます。送信者ホワイトリスト、本文サイズ制限、HTML 除去でエージェント パイプラインを悪意ある入力から保護します。

**Discord ゲートウェイ Bot**: `sidjua module install discord` 経由の完全なスラッシュコマンドインターフェース。エージェントは Discord メッセージに応答し、会話スレッドを維持し、プロアクティブな通知を送信します。

**Telegram 連携**: Telegram ボット経由のエージェントアラートと通知。マルチチャネルアダプターパターンは Telegram、Discord、ntfy、メールを並行してサポートします。

### 運用

**単一の Docker コマンド**で本番環境へ：

```bash
docker run -p 4200:4200 sidjua/sidjua:latest
```

API キーは初回起動時に自動生成され、コンテナログに出力されます。環境変数は不要。設定は不要。データベースサーバーは不要 — SIDJUA は SQLite を使用し、エージェントごとに 1 つのデータベースファイル。

**CLI 管理** — 単一のバイナリから完全なライフサイクル：

```bash
sidjua init                      # インタラクティブなワークスペースセットアップ（3 ステップ）
sidjua apply                     # divisions.yaml からプロビジョニング
sidjua agent create/list/stop    # エージェントライフサイクル
sidjua run "タスク..." --wait    # ガバナンス実施付きタスク送信
sidjua audit report              # コンプライアンスレポート
sidjua costs                     # 部門/エージェント別コスト内訳
sidjua backup create/restore     # HMAC 署名付きバックアップ管理
sidjua update                    # 自動事前バックアップ付きバージョン更新
sidjua rollback                  # 前のバージョンへの 1 クリック復元
sidjua email status/test         # メールチャネル管理
sidjua secret set/get/rotate     # 暗号化シークレット管理
sidjua memory import/search      # セマンティック知識パイプライン
sidjua selftest                  # システムヘルスチェック（7 カテゴリ、0-100 スコア）
```

**セマンティックメモリ** — 会話とドキュメントをインポート（`sidjua memory import ~/exports/claude-chats.zip`）し、ベクター + BM25 ハイブリッドランキングで検索。Cloudflare Workers AI エンベディング（無料、ゼロ設定）と OpenAI 大規模エンベディング（大規模知識ベース向けの高品質）をサポート。

**アダプティブ チャンキング** — メモリパイプラインは各エンベディングモデルのトークン制限内に収まるよう、チャンクサイズを自動調整します。

**ゼロ設定ガイド** — `sidjua chat guide` は API キーなしでインタラクティブな AI アシスタントを起動し、SIDJUA プロキシを通じた Cloudflare Workers AI を利用します。エージェントの設定方法、ガバナンスの設定、または監査ログで何が起きたかを尋ねることができます。

**エアギャップ デプロイメント** — Ollama または任意の OpenAI 互換エンドポイントを使用したローカル LLM でインターネットから完全に切り離して実行。デフォルトでテレメトリなし。完全な PII リダクション付きのオプトイン クラッシュレポート。

### セキュリティ

**サンドボックス分離** — エージェントスキルは bubblewrap（Linux ユーザーネームスペース）を通じた OS レベルのプロセス分離内で実行されます。追加の RAM オーバーヘッドはゼロ。プラグ可能な `SandboxProvider` インターフェース：開発用の `none`、本番用の `bubblewrap`。

**シークレット管理** — RBAC 付き暗号化シークレットストア（`sidjua secret set/get/list/delete/rotate/namespaces`）。外部ボルトは不要。

**セキュリティファースト ビルド** — 広範な内部テストスイートと 2 名の外部コード監査人（DeepSeek V3 と xAI Grok）による独立した検証。すべての API サーフェスにセキュリティヘッダー、CSRF 保護、レート制限、入力サニタイズ。全体を通じたパラメータ化クエリによる SQL インジェクション防止。

**バックアップ整合性** — zip スリップ保護、zip 爆弾防止、および復元時のマニフェスト チェックサム検証を備えた HMAC 署名付きバックアップアーカイブ。

---

## 他のフレームワークからのインポート

```bash
# インポートされるものをプレビュー — 変更なし
sidjua import openclaw --dry-run

# 設定 + スキルファイルをインポート
sidjua import openclaw --skills
```

既存のエージェントはアイデンティティ、モデル、スキルを維持します。SIDJUA はガバナンス、監査証跡、予算コントロールを自動的に追加します。

---

## 設定リファレンス

始めるための最小限の `divisions.yaml`：

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

`sidjua apply` はこのファイルから完全なインフラストラクチャをプロビジョニングします。変更後に再度実行してください — 冪等です。

すべての 10 のプロビジョニングステップの完全な仕様は [docs/SIDJUA-APPLY-TECH-SPEC-V1.md](docs/SIDJUA-APPLY-TECH-SPEC-V1.md) を参照してください。

---

## REST API

SIDJUA の REST API はダッシュボードと同じポートで実行されます：

```bash
sidjua server start --port 4200 --api-key $SIDJUA_API_KEY
```

主要エンドポイント：

```
GET  /api/v1/health          # パブリックヘルスチェック（認証なし）
GET  /api/v1/info            # システムメタデータ（認証済み）
POST /api/v1/execute/run     # タスクを送信
GET  /api/v1/execute/:id/status  # タスクステータス
GET  /api/v1/execute/:id/result  # タスク結果
GET  /api/v1/events          # SSE イベントストリーム
GET  /api/v1/audit/report    # コンプライアンスレポート
```

`/health` 以外のすべてのエンドポイントには Bearer 認証が必要です。キーを生成する：

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

または、設定、ログ、エージェントワークスペース用の名前付きボリュームと、セマンティック検索用のオプションの Qdrant サービスを追加する同梱の `docker-compose.yml` を使用してください：

```bash
docker compose up -d
docker compose exec sidjua sidjua init
docker compose exec sidjua sidjua apply
```

---

## プロバイダー

SIDJUA はロックインなしで任意の LLM プロバイダーに接続します：

| プロバイダー | モデル | API キー |
|-------------|--------|----------|
| Anthropic | Claude Sonnet 4.6, Haiku 4.5, Opus 4.6 | `ANTHROPIC_API_KEY` |
| Google | Gemini 2.0, Gemini 1.5 Pro | `GOOGLE_API_KEY` |
| Groq | Llama 3.x, Mixtral | `GROQ_API_KEY` (無料ティア) |
| Cloudflare Workers AI | Llama, Mistral, Phi | `CF_ACCOUNT_ID` + `CF_TOKEN` |
| Ollama | 任意のローカルモデル | キー不要（ローカル） |
| OpenAI 互換 | 任意のエンドポイント | カスタム URL + キー |

```bash
# プロバイダーキーを追加
sidjua key set groq gsk_...

# 利用可能なプロバイダーとモデルを一覧表示
sidjua provider list
```

---

## ロードマップ

完全なロードマップは [sidjua.com/roadmap](https://sidjua.com/roadmap) にあります。

近期予定：
- マルチエージェントオーケストレーション パターン（V1.1）
- Webhook インバウンドトリガー（V1.1）
- エージェント間通信（V1.2）
- エンタープライズ SSO 統合（V1.x）
- クラウドホスト型ガバナンス検証サービス（V1.x）

---

## コミュニティ

- **Discord**: [sidjua.com/discord](https://sidjua.com/discord)
- **GitHub Issues**: [github.com/sidjua-dev/sidjua/issues](https://github.com/sidjua-dev/sidjua/issues)
- **メール**: contact@sidjua.com
- **ドキュメント**: [sidjua.com/docs](https://sidjua.com/docs)

バグを見つけた場合は、Issue を開いてください — 迅速に対応します。

---

## 翻訳

SIDJUA は 26 の言語で利用可能です。英語とドイツ語はコアチームが管理しています。他のすべての翻訳は AI 生成でコミュニティが管理しています。

**ドキュメント:** この README と[インストールガイド](docs/INSTALLATION.md)はすべての 26 の言語で利用可能です。このページ上部の言語セレクターを参照してください。

| 地域 | 言語 |
|------|------|
| 南北アメリカ | 英語、スペイン語、ポルトガル語（ブラジル） |
| ヨーロッパ | ドイツ語、フランス語、イタリア語、オランダ語、ポーランド語、チェコ語、ルーマニア語、ロシア語、ウクライナ語、スウェーデン語、トルコ語 |
| 中東 | アラビア語 |
| アジア | ヒンディー語、ベンガル語、フィリピン語、インドネシア語、マレー語、タイ語、ベトナム語、日本語、韓国語、中国語（簡体字）、中国語（繁体字） |

翻訳エラーを見つけた場合は、以下の情報を含めて GitHub Issue を開いてください：
- 言語とロケールコード（例：`ja`）
- 誤ったテキストまたはロケールファイルのキー（例：`gui.nav.dashboard`）
- 正しい翻訳

言語のメンテナーになりたい場合は [CONTRIBUTING.md](CONTRIBUTING.md#translations) を参照してください — 言語ごとのメンテナーモデルを採用しています。

---

## ライセンス

**AGPL-3.0** — 同じライセンスの下で変更を共有する限り、SIDJUA を自由に使用、変更、配布できます。ソースコードはホスト型デプロイメントのユーザーに常に利用可能です。

AGPL の義務なしに独自のデプロイメントを必要とする組織向けのエンタープライズライセンスも利用可能です。
[contact@sidjua.com](mailto:contact@sidjua.com)
