> このドキュメントは[英語オリジナル](../INSTALLATION.md)からAI翻訳されています。誤りを見つけましたか？[報告する](https://github.com/GoetzKohlberg/sidjua/issues)。

# SIDJUAインストールガイド

SIDJUAバージョン：1.0.0 | ライセンス：AGPL-3.0-only | 更新日：2026-03-25

## 目次

1. [プラットフォームサポートマトリクス](#1-プラットフォームサポートマトリクス)
2. [前提条件](#2-前提条件)
3. [インストール方法](#3-インストール方法)
4. [ディレクトリ構成](#4-ディレクトリ構成)
5. [環境変数](#5-環境変数)
6. [プロバイダー設定](#6-プロバイダー設定)
7. [デスクトップGUI（オプション）](#7-デスクトップguiオプション)
8. [エージェントサンドボックス](#8-エージェントサンドボックス)
9. [セマンティック検索（オプション）](#9-セマンティック検索オプション)
10. [トラブルシューティング](#10-トラブルシューティング)
11. [Dockerボリュームリファレンス](#11-dockerボリュームリファレンス)
12. [アップグレード](#12-アップグレード)
13. [次のステップ](#13-次のステップ)

---

## 1. プラットフォームサポートマトリクス

| 機能 | Linux | macOS | Windows WSL2 | Windows（ネイティブ） |
|------|-------|-------|--------------|----------------------|
| CLI + REST API | ✅ 完全 | ✅ 完全 | ✅ 完全 | ✅ 完全 |
| Docker | ✅ 完全 | ✅ Docker Desktop | ✅ Docker Desktop | ✅ Docker Desktop |
| サンドボックス（bubblewrap） | ✅ 完全 | ❌ `none`にフォールバック | ✅ 完全（WSL2内） | ❌ `none`にフォールバック |
| Web Management Console | ✅ Full | ✅ Full | ✅ Full | ✅ Full |
| セマンティック検索（Qdrant） | ✅ | ✅ | ✅ | ✅ |

**bubblewrapについての注意：** Linuxユーザー名前空間サンドボックス。macOSおよびWindowsネイティブは自動的にサンドボックスモード`none`にフォールバックします。設定は不要です。

---

## 2. 前提条件

### Node.js >= 22.0.0

**理由：** SIDJUAはESモジュール、ネイティブ`fetch()`、および`crypto.subtle`を使用しており、これらはすべてNode.js 22以上が必要です。

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

**macOS（.pkgインストーラー）：** [nodejs.org/en/download](https://nodejs.org/en/download)からダウンロードしてください。

**Windows（winget）:**
```powershell
winget install OpenJS.NodeJS.LTS
```

**Windows（.msi）：** [nodejs.org/en/download](https://nodejs.org/en/download)からダウンロードしてください。

**WSL2：** WSL2ターミナル内でUbuntu/Debianの手順を使用してください。

確認:
```bash
node --version   # >= 22.0.0 であること
npm --version    # >= 10.0.0 であること
```

---

### C/C++ツールチェーン（ソースビルドのみ）

**理由：** `better-sqlite3`と`argon2`は`npm ci`の実行中にネイティブNode.jsアドオンをコンパイルします。Dockerユーザーはこの手順を省略できます。

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

**Windows：** [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)を**C++によるデスクトップ開発**ワークロードとともにインストールし、次を実行します：
```powershell
npm install --global windows-build-tools
```

**Alpine Linux:**
```bash
apk add python3 make g++ build-base linux-headers
```

---

### Docker >= 24（オプション）

Docker Compose V2プラグイン（`docker compose`）が利用可能である必要があります。Dockerインストール方法の場合のみ必要です。

**Linux：** [docs.docker.com/engine/install](https://docs.docker.com/engine/install/)の手順に従ってください。
Docker Compose V2はDocker Engine >= 24に含まれています。

**macOS / Windows：** [Docker Desktop](https://www.docker.com/products/docker-desktop/)をインストールしてください（Docker Compose V2を含む）。

確認:
```bash
docker --version          # >= 24.0.0 であること
docker compose version    # v2.x.x が表示されること
```

---

### Git

最新バージョンを使用してください。OSのパッケージマネージャーまたは[git-scm.com](https://git-scm.com)からインストールしてください。

---

## 3. インストール方法

### 方法A — Docker（推奨）

SIDJUAを動作させるための最速の方法です。すべての依存関係がイメージにバンドルされています。

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
docker compose up -d
```

サービスが正常になるまで待ちます（初回ビルド時は最大約60秒）：

```bash
docker compose ps
# NAME              STATUS
# sidjua            Up X seconds (healthy)
# sidjua-qdrant     Up X seconds (healthy)
```

自動生成されたAPIキーを取得します：

```bash
docker compose exec sidjua cat /app/.system/api-key
```

`divisions.yaml`からガバナンスをブートストラップします：

```bash
docker compose exec sidjua sidjua apply --verbose
```

システムヘルスチェックを実行します：

```bash
docker compose exec sidjua sidjua selftest
```

**ARM64の注意：** DockerイメージはNode.js 22-alpineをベースに構築されており、`linux/amd64`と`linux/arm64`をサポートしています。Raspberry Pi（64ビット）およびApple Silicon Mac（Docker Desktop経由）はそのままサポートされています。

**DockerでのBubblewrap：** コンテナ内でエージェントサンドボックスを有効にするには、Dockerの実行コマンドに`--cap-add=SYS_ADMIN`を追加するか、`docker-compose.yml`に設定します：
```yaml
cap_add:
  - SYS_ADMIN
```

---

### 方法B — npm グローバルインストール

```bash
npm install -g sidjua
```

インタラクティブなセットアップウィザードを実行します（3つのステップ：ワークスペースの場所、プロバイダー、最初のエージェント）：
```bash
sidjua init
```

非インタラクティブなCIまたはコンテナ環境の場合：
```bash
sidjua init --yes
```

ゼロ設定AIガイドを起動します（APIキー不要）：
```bash
sidjua chat guide
```

---

### 方法C — ソースビルド

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
npm ci
npm run build
```

ビルドプロセスは`tsup`を使用して`src/index.ts`を以下にコンパイルします：
- `dist/index.js`（ESM）
- `dist/index.cjs`（CommonJS）

ビルド後のステップでは、i18nロケールファイル、デフォルトロール、ディビジョン、ナレッジベーステンプレートが`dist/`にコピーされます。

ソースから実行：
```bash
node dist/index.js --help
```

テストスイートを実行：
```bash
npm test                    # 全テスト
npm run test:coverage       # カバレッジレポートつき
npx tsc --noEmit            # 型チェックのみ
```

---

## 4. ディレクトリ構成

### Dockerデプロイメントパス

| パス | Dockerボリューム | 目的 | 管理者 |
|------|-----------------|------|--------|
| `/app/dist/` | イメージレイヤー | コンパイル済みアプリケーション | SIDJUA |
| `/app/node_modules/` | イメージレイヤー | Node.js依存関係 | SIDJUA |
| `/app/system/` | イメージレイヤー | 組み込みデフォルトとテンプレート | SIDJUA |
| `/app/defaults/` | イメージレイヤー | デフォルト設定ファイル | SIDJUA |
| `/app/docs/` | イメージレイヤー | バンドルされたドキュメント | SIDJUA |
| `/app/data/` | `sidjua-data` | SQLiteデータベース、バックアップ、ナレッジコレクション | ユーザー |
| `/app/config/` | `sidjua-config` | `divisions.yaml`とカスタム設定 | ユーザー |
| `/app/logs/` | `sidjua-logs` | 構造化ログファイル | ユーザー |
| `/app/.system/` | `sidjua-system` | APIキー、更新状態、プロセスロック | SIDJUA管理 |
| `/app/agents/` | `sidjua-workspace` | エージェント定義、スキル、テンプレート | ユーザー |
| `/app/governance/` | `sidjua-governance` | 監査証跡、ガバナンススナップショット | ユーザー |

---

### 手動 / npmインストールパス

`sidjua init`の実行後、ワークスペースは以下のように構成されます：

```
~/sidjua-workspace/           # または SIDJUA_CONFIG_DIR
├── divisions.yaml            # ガバナンス設定
├── .sidjua/                  # 内部状態（WAL、テレメトリバッファ）
│   └── telemetry.db
├── data/
│   ├── sidjua.db             # メインデータベース（エージェント、タスク、監査、コスト）
│   ├── knowledge/            # エージェントごとのナレッジデータベース
│   │   └── <agent-id>.db
│   └── backups/              # HMAC署名付きバックアップアーカイブ
├── agents/                   # エージェントスキルディレクトリ
├── governance/               # 監査証跡（追記専用）
├── logs/                     # アプリケーションログ
└── system/                   # ランタイム状態
```

---

### SQLiteデータベース

| データベース | パス | 内容 |
|------------|------|------|
| メイン | `data/sidjua.db` | エージェント、タスク、コスト、ガバナンススナップショット、APIキー、監査ログ |
| テレメトリ | `.sidjua/telemetry.db` | オプションのオプトインエラーレポート（PII削除済み） |
| ナレッジ | `data/knowledge/<agent-id>.db` | エージェントごとのベクター埋め込みとBM25インデックス |

SQLiteデータベースはシングルファイル、クロスプラットフォーム、ポータブルです。`sidjua backup create`でバックアップしてください。

---

## 5. 環境変数

`.env.example`を`.env`にコピーしてカスタマイズしてください。すべての変数は特に記載がない限りオプションです。

### サーバー

| 変数 | デフォルト | 説明 |
|------|----------|------|
| `SIDJUA_PORT` | `3000` | REST APIリッスンポート |
| `SIDJUA_HOST` | `127.0.0.1` | REST APIバインドアドレス。リモートアクセスには`0.0.0.0`を使用 |
| `NODE_ENV` | `production` | ランタイムモード（`production`または`development`） |
| `SIDJUA_API_KEY` | 自動生成 | REST API ベアラートークン。初回起動時に存在しない場合は自動作成 |
| `SIDJUA_MAX_BODY_SIZE` | `2097152`（2 MiB） | 受信リクエストボディの最大サイズ（バイト） |

### ディレクトリオーバーライド

| 変数 | デフォルト | 説明 |
|------|----------|------|
| `SIDJUA_DATA_DIR` | `<workspace>/data` | データディレクトリの場所を上書き |
| `SIDJUA_CONFIG_DIR` | `<workspace>` | 設定ディレクトリの場所を上書き |
| `SIDJUA_LOG_DIR` | `<workspace>/logs` | ログディレクトリの場所を上書き |

### セマンティック検索

| 変数 | デフォルト | 説明 |
|------|----------|------|
| `SIDJUA_QDRANT_URL` | `http://localhost:6333` | Qdrantベクターデータベースエンドポイント。Dockerデフォルト：`http://qdrant:6333` |
| `OPENAI_API_KEY` | — | OpenAI `text-embedding-3-large`埋め込みに必要 |
| `SIDJUA_CF_ACCOUNT_ID` | — | 無料埋め込み用CloudflareアカウントID |
| `SIDJUA_CF_TOKEN` | — | 無料埋め込み用Cloudflare APIトークン |

### LLMプロバイダー

| 変数 | プロバイダー |
|------|------------|
| `ANTHROPIC_API_KEY` | Anthropic（Claude） |
| `OPENAI_API_KEY` | OpenAI（GPT-4、埋め込み） |
| `GOOGLE_AI_API_KEY` | Google AI（Gemini） |
| `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` | Cloudflare Workers AI（無料ティア） |
| `GROQ_API_KEY` | Groq（高速推論、無料ティアあり） |
| `DEEPSEEK_API_KEY` | DeepSeek |

---

## 6. プロバイダー設定

### ゼロ設定オプション

`sidjua chat guide`はAPIキーなしで動作します。SIDJUAプロキシを通じてCloudflare Workers AIに接続します。レート制限がありますが、評価とオンボーディングに適しています。

### 最初のプロバイダーを追加する

**Groq（無料ティア、クレジットカード不要）：**
```bash
sidjua key set groq <your-groq-api-key>
sidjua provider list
```
[console.groq.com](https://console.groq.com)で無料キーを取得してください。

**Anthropic（本番環境に推奨）：**
```bash
export ANTHROPIC_API_KEY=sk-ant-...
sidjua key set anthropic $ANTHROPIC_API_KEY
```

**Ollama（エアギャップ / ローカルデプロイメント）：**
```bash
sidjua provider add-custom \
  --id ollama \
  --name "Ollama (local)" \
  --base-url http://localhost:11434/v1 \
  --model llama3.2
```

設定済みのすべてのプロバイダーを検証します：
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

## 8. エージェントサンドボックス

SIDJUAはプラグイン可能な`SandboxProvider`インターフェースを使用します。サンドボックスはOSレベルのプロセス分離でエージェントスキルの実行をラップします。

### プラットフォーム別サンドボックスサポート

| プラットフォーム | サンドボックスプロバイダー | 備考 |
|---------------|------------------------|------|
| Linux（ネイティブ） | `bubblewrap` | 完全なユーザー名前空間分離 |
| Docker（Linuxコンテナ） | `bubblewrap` | `--cap-add=SYS_ADMIN`が必要 |
| macOS | `none`（自動フォールバック） | macOSはLinuxユーザー名前空間をサポートしません |
| Windows WSL2 | `bubblewrap` | WSL2内でLinuxと同様にインストール |
| Windows（ネイティブ） | `none`（自動フォールバック） | |

### bubblewrapのインストール（Linux）

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

`divisions.yaml`内：
```yaml
governance:
  sandbox: bubblewrap    # または: none
```

サンドボックスの可用性を確認します：
```bash
sidjua sandbox check
```

---

## 9. セマンティック検索（オプション）

セマンティック検索は`sidjua memory search`とエージェントナレッジ検索を強化します。Qdrantベクターデータベースと埋め込みプロバイダーが必要です。

### Docker Composeプロファイル

含まれている`docker-compose.yml`には`semantic-search`プロファイルがあります：
```bash
docker compose --profile semantic-search up -d
```
これによりQdrantコンテナがSIDJUAと並行して起動します。

### スタンドアロンQdrant

```bash
docker run -d \
  --name sidjua-qdrant \
  -p 6333:6333 \
  -v qdrant-storage:/qdrant/storage \
  qdrant/qdrant:v1.13.2
```

エンドポイントを設定します：
```bash
export SIDJUA_QDRANT_URL=http://localhost:6333
```

### Qdrantなしの場合

Qdrantが利用できない場合、`sidjua memory import`と`sidjua memory search`は無効になります。SIDJUA（CLI、REST API、エージェント実行、ガバナンス、監査）の他のすべての機能は通常どおり動作します。システムはナレッジクエリにBM25キーワード検索にフォールバックします。

---

## 10. トラブルシューティング

### すべてのプラットフォーム

**`npm ci`が`node-pre-gyp`または`node-gyp`エラーで失敗する：**
```
gyp ERR! build error
```
C/C++ツールチェーンをインストールしてください（前提条件のセクションを参照）。Ubuntuの場合：`sudo apt-get install -y python3 make g++ build-essential`。

**`Cannot find divisions.yaml`：**
`SIDJUA_CONFIG_DIR`を確認してください。ファイルは`$SIDJUA_CONFIG_DIR/divisions.yaml`に存在する必要があります。`sidjua init`を実行してワークスペース構造を作成してください。

**REST APIが401 Unauthorizedを返す：**
`Authorization: Bearer <key>`ヘッダーを確認してください。自動生成されたキーを次のコマンドで取得してください：
```bash
cat ~/.sidjua/.system/api-key          # 手動インストール
docker compose exec sidjua cat /app/.system/api-key  # Docker
```

**ポート3000がすでに使用中：**
```bash
SIDJUA_PORT=3001 sidjua server start
# または .env に設定: SIDJUA_PORT=3001
```

---

### Ubuntu / Debian

**`better-sqlite3`が`futex.h`が見つからないというエラーでコンパイルに失敗する：**
```bash
sudo apt-get install -y linux-headers-$(uname -r)
```

---

### Fedora / RHEL

**SELinuxがDockerボリュームマウントをブロックする：**
```yaml
# SELinuxコンテキスト用に:Zラベルを追加
volumes:
  - ./my-config:/app/config:Z
```
またはSELinuxコンテキストを手動で設定します：
```bash
chcon -Rt svirt_sandbox_file_t ./my-config
```

---

### Arch Linux

**Node.jsのバージョンが古すぎる：**
`nvm`を使用してNode.js 22をインストールします：
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

**Docker Desktopがメモリ不足になる：**
Docker Desktop → 設定 → リソース → メモリを開きます。少なくとも4 GBに増やしてください。

**Apple Silicon — アーキテクチャの不一致：**
Node.jsのインストールがネイティブARM64であることを確認します（Rosettaではない）：
```bash
node -e "console.log(process.arch)"
# 期待値: arm64
```
`x64`と表示された場合、nodejs.orgからARM64インストーラーを使用してNode.jsを再インストールしてください。

---

### Windows（ネイティブ）

**`MSBuild`または`cl.exe`が見つからない：**
[Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)をインストールし、**C++によるデスクトップ開発**ワークロードを選択します。次を実行します：
```powershell
npm install --global windows-build-tools
```

**長いパスエラー（`ENAMETOOLONG`）：**
Windowsレジストリで長いパスのサポートを有効にします：
```powershell
# 管理者として実行
Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" `
  -Name LongPathsEnabled -Value 1
```

**`npm install -g`後に`sidjua`コマンドが見つからない：**
npmグローバルbinディレクトリをPATHに追加します：
```powershell
npm config get prefix  # 例: C:\Users\you\AppData\Roaming\npm
# そのパスをシステム環境変数 → Pathに追加
```

---

### Windows WSL2

**DockerがWSL2内で起動しない：**
Docker Desktop → 設定 → 全般 → **WSL 2ベースのエンジンを使用する**を有効にします。
その後、Docker Desktopと WSL2ターミナルを再起動します。

**`/mnt/c/`下のファイルのパーミッションエラー：**
WSL2にマウントされたWindows NTFSボリュームにはアクセス権限が制限されています。ワークスペースをLinuxネイティブパスに移動してください：
```bash
mkdir ~/sidjua-workspace
cd ~/sidjua-workspace
sidjua init
```

---

### Raspberry Pi / ARM64

**`npm ci`が非常に遅い（5〜10分）：**
これは正常です。ARM64でのネイティブアドオンのコンパイルには時間がかかります。代わりにDockerイメージの使用を検討してください：
```bash
docker pull sidjua/sidjua:latest-arm64
```

**ビルド中のメモリ不足：**
スワップスペースを追加します：
```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

---

## 11. Dockerボリュームリファレンス

### 名前付きボリューム

| ボリューム名 | コンテナパス | 目的 |
|------------|------------|------|
| `sidjua-data` | `/app/data` | SQLiteデータベース、バックアップアーカイブ、ナレッジコレクション |
| `sidjua-config` | `/app/config` | `divisions.yaml`、カスタム設定 |
| `sidjua-logs` | `/app/logs` | 構造化アプリケーションログ |
| `sidjua-system` | `/app/.system` | APIキー、更新状態、プロセスロックファイル |
| `sidjua-workspace` | `/app/agents` | エージェントスキルディレクトリ、定義、テンプレート |
| `sidjua-governance` | `/app/governance` | 不変の監査証跡、ガバナンススナップショット |
| `qdrant-storage` | `/qdrant/storage` | Qdrantベクターインデックス（セマンティック検索プロファイルのみ） |

### ホストディレクトリの使用

コンテナ内で編集する代わりに独自の`divisions.yaml`をマウントするには：

```yaml
# docker-compose.override.yml
services:
  sidjua:
    volumes:
      - ./my-config:/app/config   # sidjua-config名前付きボリュームを置き換え
```

### バックアップ

```bash
sidjua backup create                    # コンテナ内から
# または
docker compose exec sidjua sidjua backup create
```

バックアップはHMAC署名付きアーカイブとして`/app/data/backups/`に保存されます。

---

## 12. アップグレード

### Docker

```bash
git pull
docker compose build --no-cache
docker compose up -d
docker compose exec sidjua sidjua apply    # スキーママイグレーションを実行
```

`sidjua apply`は冪等です。アップグレード後に再実行しても常に安全です。

### npm グローバルインストール

```bash
npm update -g sidjua
sidjua apply    # スキーママイグレーションを実行
```

### ソースビルド

```bash
git pull
npm ci
npm run build
node dist/index.js apply    # スキーママイグレーションを実行
```

### ロールバック

SIDJUAは各`sidjua apply`の前にガバナンススナップショットを作成します。元に戻すには：

```bash
sidjua rollback list
sidjua rollback <version>
```

---

## 13. 次のステップ

| リソース | コマンド / リンク |
|---------|----------------|
| クイックスタート | [docs/QUICK-START.md](QUICK-START.md) |
| CLIリファレンス | [docs/CLI-REFERENCE.md](CLI-REFERENCE.md) |
| ガバナンスの例 | [docs/GOVERNANCE-EXAMPLES.md](GOVERNANCE-EXAMPLES.md) |
| 無料LLMプロバイダーガイド | [docs/FREE-LLM-PROVIDER-GUIDE.md](FREE-LLM-PROVIDER-GUIDE.md) |
| トラブルシューティング | [docs/TROUBLESHOOTING.md](TROUBLESHOOTING.md) |

インストール後に最初に実行するコマンド：

```bash
sidjua chat guide    # ゼロ設定AIガイド — APIキー不要
sidjua selftest      # システムヘルスチェック（7カテゴリ、0〜100スコア）
sidjua apply         # divisions.yamlからエージェントをプロビジョニング
```
