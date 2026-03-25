> 이 문서는 [영어 원본](../INSTALLATION.md)에서 AI로 번역되었습니다. 오류를 발견했나요? [보고하기](https://github.com/GoetzKohlberg/sidjua/issues).

# SIDJUA 설치 가이드

SIDJUA 버전: 1.0.0 | 라이선스: AGPL-3.0-only | 업데이트: 2026-03-25

## 목차

1. [플랫폼 지원 매트릭스](#1-플랫폼-지원-매트릭스)
2. [사전 요구사항](#2-사전-요구사항)
3. [설치 방법](#3-설치-방법)
4. [디렉토리 구조](#4-디렉토리-구조)
5. [환경 변수](#5-환경-변수)
6. [프로바이더 설정](#6-프로바이더-설정)
7. [데스크톱 GUI (선택 사항)](#7-데스크톱-gui-선택-사항)
8. [에이전트 샌드박싱](#8-에이전트-샌드박싱)
9. [시맨틱 검색 (선택 사항)](#9-시맨틱-검색-선택-사항)
10. [문제 해결](#10-문제-해결)
11. [Docker 볼륨 참조](#11-docker-볼륨-참조)
12. [업그레이드](#12-업그레이드)
13. [다음 단계](#13-다음-단계)

---

## 1. 플랫폼 지원 매트릭스

| 기능 | Linux | macOS | Windows WSL2 | Windows (네이티브) |
|------|-------|-------|--------------|-------------------|
| CLI + REST API | ✅ 완전 | ✅ 완전 | ✅ 완전 | ✅ 완전 |
| Docker | ✅ 완전 | ✅ Docker Desktop | ✅ Docker Desktop | ✅ Docker Desktop |
| 샌드박싱 (bubblewrap) | ✅ 완전 | ❌ `none`으로 폴백 | ✅ 완전 (WSL2 내) | ❌ `none`으로 폴백 |
| Web Management Console | ✅ Full | ✅ Full | ✅ Full | ✅ Full |
| 시맨틱 검색 (Qdrant) | ✅ | ✅ | ✅ | ✅ |

**bubblewrap에 대한 참고:** Linux 사용자 네임스페이스 샌드박싱입니다. macOS 및 Windows 네이티브는 자동으로 샌드박스 모드 `none`으로 폴백됩니다. 설정이 필요 없습니다.

---

## 2. 사전 요구사항

### Node.js >= 22.0.0

**이유:** SIDJUA는 ES 모듈, 네이티브 `fetch()`, `crypto.subtle`을 사용하며, 이 모두 Node.js 22 이상이 필요합니다.

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

**macOS (.pkg 설치 프로그램):** [nodejs.org/en/download](https://nodejs.org/en/download)에서 다운로드하세요.

**Windows (winget):**
```powershell
winget install OpenJS.NodeJS.LTS
```

**Windows (.msi):** [nodejs.org/en/download](https://nodejs.org/en/download)에서 다운로드하세요.

**WSL2:** WSL2 터미널 내에서 Ubuntu/Debian 지침을 사용하세요.

확인:
```bash
node --version   # >= 22.0.0 이어야 함
npm --version    # >= 10.0.0 이어야 함
```

---

### C/C++ 툴체인 (소스 빌드 전용)

**이유:** `better-sqlite3`와 `argon2`는 `npm ci` 실행 중 네이티브 Node.js 애드온을 컴파일합니다. Docker 사용자는 이 단계를 건너뜁니다.

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

**Windows:** **C++를 사용한 데스크톱 개발** 워크로드와 함께 [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)를 설치한 후:
```powershell
npm install --global windows-build-tools
```

**Alpine Linux:**
```bash
apk add python3 make g++ build-base linux-headers
```

---

### Docker >= 24 (선택 사항)

Docker 설치 방법에만 필요합니다. Docker Compose V2 플러그인(`docker compose`)이 사용 가능해야 합니다.

**Linux:** [docs.docker.com/engine/install](https://docs.docker.com/engine/install/)의 지침을 따르세요.
Docker Compose V2는 Docker Engine >= 24에 포함되어 있습니다.

**macOS / Windows:** [Docker Desktop](https://www.docker.com/products/docker-desktop/)을 설치하세요 (Docker Compose V2 포함).

확인:
```bash
docker --version          # >= 24.0.0 이어야 함
docker compose version    # v2.x.x가 표시되어야 함
```

---

### Git

최신 버전을 사용하세요. OS 패키지 관리자 또는 [git-scm.com](https://git-scm.com)에서 설치하세요.

---

## 3. 설치 방법

### 방법 A — Docker (권장)

SIDJUA를 설치하는 가장 빠른 방법입니다. 모든 종속성이 이미지에 번들로 포함되어 있습니다.

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
docker compose up -d
```

서비스가 정상 상태가 될 때까지 기다립니다 (첫 번째 빌드 시 최대 약 60초):

```bash
docker compose ps
# NAME              STATUS
# sidjua            Up X seconds (healthy)
# sidjua-qdrant     Up X seconds (healthy)
```

자동 생성된 API 키를 가져옵니다:

```bash
docker compose exec sidjua cat /app/.system/api-key
```

`divisions.yaml`에서 거버넌스를 부트스트랩합니다:

```bash
docker compose exec sidjua sidjua apply --verbose
```

시스템 상태 확인을 실행합니다:

```bash
docker compose exec sidjua sidjua selftest
```

**ARM64 참고:** Docker 이미지는 `linux/amd64` 및 `linux/arm64`를 지원하는 `node:22-alpine`에 빌드됩니다. Raspberry Pi (64비트)와 Apple Silicon Mac (Docker Desktop 경유)이 기본적으로 지원됩니다.

**Docker의 Bubblewrap:** 컨테이너 내에서 에이전트 샌드박싱을 활성화하려면 Docker 실행 명령에 `--cap-add=SYS_ADMIN`을 추가하거나 `docker-compose.yml`에 설정합니다:
```yaml
cap_add:
  - SYS_ADMIN
```

---

### 방법 B — npm 글로벌 설치

```bash
npm install -g sidjua
```

대화형 설정 마법사를 실행합니다 (3단계: 워크스페이스 위치, 프로바이더, 첫 번째 에이전트):
```bash
sidjua init
```

비대화형 CI 또는 컨테이너 환경의 경우:
```bash
sidjua init --yes
```

제로 설정 AI 가이드를 시작합니다 (API 키 불필요):
```bash
sidjua chat guide
```

---

### 방법 C — 소스 빌드

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
npm ci
npm run build
```

빌드 프로세스는 `tsup`을 사용하여 `src/index.ts`를 다음으로 컴파일합니다:
- `dist/index.js` (ESM)
- `dist/index.cjs` (CommonJS)

빌드 후 단계에서 i18n 로케일 파일, 기본 역할, 디비전, 지식 베이스 템플릿을 `dist/`에 복사합니다.

소스에서 실행:
```bash
node dist/index.js --help
```

테스트 스위트 실행:
```bash
npm test                    # 모든 테스트
npm run test:coverage       # 커버리지 보고서 포함
npx tsc --noEmit            # 타입 검사만
```

---

## 4. 디렉토리 구조

### Docker 배포 경로

| 경로 | Docker 볼륨 | 목적 | 관리자 |
|------|------------|------|--------|
| `/app/dist/` | 이미지 레이어 | 컴파일된 애플리케이션 | SIDJUA |
| `/app/node_modules/` | 이미지 레이어 | Node.js 종속성 | SIDJUA |
| `/app/system/` | 이미지 레이어 | 내장 기본값 및 템플릿 | SIDJUA |
| `/app/defaults/` | 이미지 레이어 | 기본 설정 파일 | SIDJUA |
| `/app/docs/` | 이미지 레이어 | 번들된 문서 | SIDJUA |
| `/app/data/` | `sidjua-data` | SQLite 데이터베이스, 백업, 지식 컬렉션 | 사용자 |
| `/app/config/` | `sidjua-config` | `divisions.yaml` 및 사용자 정의 설정 | 사용자 |
| `/app/logs/` | `sidjua-logs` | 구조화된 로그 파일 | 사용자 |
| `/app/.system/` | `sidjua-system` | API 키, 업데이트 상태, 프로세스 잠금 | SIDJUA 관리 |
| `/app/agents/` | `sidjua-workspace` | 에이전트 정의, 스킬, 템플릿 | 사용자 |
| `/app/governance/` | `sidjua-governance` | 감사 추적, 거버넌스 스냅샷 | 사용자 |

---

### 수동 / npm 설치 경로

`sidjua init` 실행 후 워크스페이스가 다음과 같이 구성됩니다:

```
~/sidjua-workspace/           # 또는 SIDJUA_CONFIG_DIR
├── divisions.yaml            # 거버넌스 설정
├── .sidjua/                  # 내부 상태 (WAL, 텔레메트리 버퍼)
│   └── telemetry.db
├── data/
│   ├── sidjua.db             # 메인 데이터베이스 (에이전트, 작업, 감사, 비용)
│   ├── knowledge/            # 에이전트별 지식 데이터베이스
│   │   └── <agent-id>.db
│   └── backups/              # HMAC 서명된 백업 아카이브
├── agents/                   # 에이전트 스킬 디렉토리
├── governance/               # 감사 추적 (추가 전용)
├── logs/                     # 애플리케이션 로그
└── system/                   # 런타임 상태
```

---

### SQLite 데이터베이스

| 데이터베이스 | 경로 | 내용 |
|------------|------|------|
| 메인 | `data/sidjua.db` | 에이전트, 작업, 비용, 거버넌스 스냅샷, API 키, 감사 로그 |
| 텔레메트리 | `.sidjua/telemetry.db` | 선택적 옵트인 오류 보고서 (PII 제거됨) |
| 지식 | `data/knowledge/<agent-id>.db` | 에이전트별 벡터 임베딩 및 BM25 인덱스 |

SQLite 데이터베이스는 단일 파일, 크로스 플랫폼, 이식 가능합니다. `sidjua backup create`로 백업하세요.

---

## 5. 환경 변수

`.env.example`을 `.env`로 복사하고 사용자 정의하세요. 별도로 명시되지 않는 한 모든 변수는 선택 사항입니다.

### 서버

| 변수 | 기본값 | 설명 |
|------|-------|------|
| `SIDJUA_PORT` | `3000` | REST API 수신 포트 |
| `SIDJUA_HOST` | `127.0.0.1` | REST API 바인드 주소. 원격 액세스에는 `0.0.0.0` 사용 |
| `NODE_ENV` | `production` | 런타임 모드 (`production` 또는 `development`) |
| `SIDJUA_API_KEY` | 자동 생성 | REST API 베어러 토큰. 없으면 첫 번째 시작 시 자동 생성 |
| `SIDJUA_MAX_BODY_SIZE` | `2097152` (2 MiB) | 수신 요청 본문의 최대 크기 (바이트) |

### 디렉토리 재정의

| 변수 | 기본값 | 설명 |
|------|-------|------|
| `SIDJUA_DATA_DIR` | `<workspace>/data` | 데이터 디렉토리 위치 재정의 |
| `SIDJUA_CONFIG_DIR` | `<workspace>` | 설정 디렉토리 위치 재정의 |
| `SIDJUA_LOG_DIR` | `<workspace>/logs` | 로그 디렉토리 위치 재정의 |

### 시맨틱 검색

| 변수 | 기본값 | 설명 |
|------|-------|------|
| `SIDJUA_QDRANT_URL` | `http://localhost:6333` | Qdrant 벡터 데이터베이스 엔드포인트. Docker 기본값: `http://qdrant:6333` |
| `OPENAI_API_KEY` | — | OpenAI `text-embedding-3-large` 임베딩에 필요 |
| `SIDJUA_CF_ACCOUNT_ID` | — | 무료 임베딩을 위한 Cloudflare 계정 ID |
| `SIDJUA_CF_TOKEN` | — | 무료 임베딩을 위한 Cloudflare API 토큰 |

### LLM 프로바이더

| 변수 | 프로바이더 |
|------|----------|
| `ANTHROPIC_API_KEY` | Anthropic (Claude) |
| `OPENAI_API_KEY` | OpenAI (GPT-4, 임베딩) |
| `GOOGLE_AI_API_KEY` | Google AI (Gemini) |
| `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` | Cloudflare Workers AI (무료 티어) |
| `GROQ_API_KEY` | Groq (빠른 추론, 무료 티어 제공) |
| `DEEPSEEK_API_KEY` | DeepSeek |

---

## 6. 프로바이더 설정

### 제로 설정 옵션

`sidjua chat guide`는 API 키 없이 작동합니다. SIDJUA 프록시를 통해 Cloudflare Workers AI에 연결합니다. 속도 제한이 있지만 평가 및 온보딩에 적합합니다.

### 첫 번째 프로바이더 추가

**Groq (무료 티어, 신용카드 불필요):**
```bash
sidjua key set groq <your-groq-api-key>
sidjua provider list
```
[console.groq.com](https://console.groq.com)에서 무료 키를 받으세요.

**Anthropic (프로덕션 환경 권장):**
```bash
export ANTHROPIC_API_KEY=sk-ant-...
sidjua key set anthropic $ANTHROPIC_API_KEY
```

**Ollama (에어갭 / 로컬 배포):**
```bash
sidjua provider add-custom \
  --id ollama \
  --name "Ollama (local)" \
  --base-url http://localhost:11434/v1 \
  --model llama3.2
```

설정된 모든 프로바이더를 검증합니다:
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

## 8. 에이전트 샌드박싱

SIDJUA는 플러그형 `SandboxProvider` 인터페이스를 사용합니다. 샌드박스는 OS 수준 프로세스 격리로 에이전트 스킬 실행을 래핑합니다.

### 플랫폼별 샌드박스 지원

| 플랫폼 | 샌드박스 프로바이더 | 참고 |
|--------|-----------------|------|
| Linux (네이티브) | `bubblewrap` | 완전한 사용자 네임스페이스 격리 |
| Docker (Linux 컨테이너) | `bubblewrap` | `--cap-add=SYS_ADMIN` 필요 |
| macOS | `none` (자동 폴백) | macOS는 Linux 사용자 네임스페이스를 지원하지 않음 |
| Windows WSL2 | `bubblewrap` | WSL2 내에서 Linux와 동일하게 설치 |
| Windows (네이티브) | `none` (자동 폴백) | |

### bubblewrap 설치 (Linux)

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

### 설정

`divisions.yaml`에서:
```yaml
governance:
  sandbox: bubblewrap    # 또는: none
```

샌드박스 가용성을 확인합니다:
```bash
sidjua sandbox check
```

---

## 9. 시맨틱 검색 (선택 사항)

시맨틱 검색은 `sidjua memory search`와 에이전트 지식 검색을 지원합니다. Qdrant 벡터 데이터베이스와 임베딩 프로바이더가 필요합니다.

### Docker Compose 프로필

포함된 `docker-compose.yml`에는 `semantic-search` 프로필이 있습니다:
```bash
docker compose --profile semantic-search up -d
```
이렇게 하면 SIDJUA와 함께 Qdrant 컨테이너가 시작됩니다.

### 독립 실행형 Qdrant

```bash
docker run -d \
  --name sidjua-qdrant \
  -p 6333:6333 \
  -v qdrant-storage:/qdrant/storage \
  qdrant/qdrant:v1.13.2
```

엔드포인트를 설정합니다:
```bash
export SIDJUA_QDRANT_URL=http://localhost:6333
```

### Qdrant 없이 사용

Qdrant를 사용할 수 없는 경우 `sidjua memory import`와 `sidjua memory search`가 비활성화됩니다. 다른 모든 SIDJUA 기능 (CLI, REST API, 에이전트 실행, 거버넌스, 감사)은 정상적으로 작동합니다. 지식 쿼리에 BM25 키워드 검색으로 폴백합니다.

---

## 10. 문제 해결

### 모든 플랫폼

**`npm ci`가 `node-pre-gyp` 또는 `node-gyp` 오류로 실패:**
```
gyp ERR! build error
```
C/C++ 툴체인을 설치하세요 (사전 요구사항 섹션 참조). Ubuntu의 경우: `sudo apt-get install -y python3 make g++ build-essential`.

**`Cannot find divisions.yaml`:**
`SIDJUA_CONFIG_DIR`을 확인하세요. 파일은 `$SIDJUA_CONFIG_DIR/divisions.yaml`에 있어야 합니다. `sidjua init`을 실행하여 워크스페이스 구조를 생성하세요.

**REST API가 401 Unauthorized를 반환:**
`Authorization: Bearer <key>` 헤더를 확인하세요. 자동 생성된 키를 다음으로 검색하세요:
```bash
cat ~/.sidjua/.system/api-key          # 수동 설치
docker compose exec sidjua cat /app/.system/api-key  # Docker
```

**포트 3000이 이미 사용 중:**
```bash
SIDJUA_PORT=3001 sidjua server start
# 또는 .env에 설정: SIDJUA_PORT=3001
```

---

### Ubuntu / Debian

**`better-sqlite3`가 `futex.h`를 찾을 수 없다는 오류로 컴파일 실패:**
```bash
sudo apt-get install -y linux-headers-$(uname -r)
```

---

### Fedora / RHEL

**SELinux가 Docker 볼륨 마운트를 차단:**
```yaml
# SELinux 컨텍스트용 :Z 레이블 추가
volumes:
  - ./my-config:/app/config:Z
```
또는 SELinux 컨텍스트를 수동으로 설정합니다:
```bash
chcon -Rt svirt_sandbox_file_t ./my-config
```

---

### Arch Linux

**Node.js 버전이 너무 오래됨:**
`nvm`을 사용하여 Node.js 22를 설치합니다:
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

**Docker Desktop 메모리 부족:**
Docker Desktop → 설정 → 리소스 → 메모리를 엽니다. 최소 4 GB로 늘리세요.

**Apple Silicon — 아키텍처 불일치:**
Node.js 설치가 네이티브 ARM64인지 확인합니다 (Rosetta 아님):
```bash
node -e "console.log(process.arch)"
# 예상: arm64
```
`x64`가 표시되면 nodejs.org의 ARM64 설치 프로그램을 사용하여 Node.js를 재설치하세요.

---

### Windows (네이티브)

**`MSBuild` 또는 `cl.exe`를 찾을 수 없음:**
[Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)를 설치하고 **C++를 사용한 데스크톱 개발** 워크로드를 선택합니다. 그런 다음 실행합니다:
```powershell
npm install --global windows-build-tools
```

**긴 경로 오류 (`ENAMETOOLONG`):**
Windows 레지스트리에서 긴 경로 지원을 활성화합니다:
```powershell
# 관리자로 실행
Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" `
  -Name LongPathsEnabled -Value 1
```

**`npm install -g` 후 `sidjua` 명령을 찾을 수 없음:**
npm 글로벌 bin 디렉토리를 PATH에 추가합니다:
```powershell
npm config get prefix  # 예: C:\Users\you\AppData\Roaming\npm
# 해당 경로를 시스템 환경 변수 → Path에 추가
```

---

### Windows WSL2

**Docker가 WSL2 내에서 시작하지 않음:**
Docker Desktop → 설정 → 일반 → **WSL 2 기반 엔진 사용**을 활성화합니다.
그런 다음 Docker Desktop과 WSL2 터미널을 재시작합니다.

**`/mnt/c/` 아래 파일에 대한 권한 오류:**
WSL2에 마운트된 Windows NTFS 볼륨은 제한된 권한을 갖습니다. 워크스페이스를 Linux 네이티브 경로로 이동하세요:
```bash
mkdir ~/sidjua-workspace
cd ~/sidjua-workspace
sidjua init
```

---

### Raspberry Pi / ARM64

**`npm ci`가 매우 느림 (5~10분):**
정상입니다. ARM64에서 네이티브 애드온 컴파일에는 더 오래 걸립니다. 대신 Docker 이미지 사용을 고려하세요:
```bash
docker pull sidjua/sidjua:latest-arm64
```

**빌드 중 메모리 부족:**
스왑 공간을 추가합니다:
```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

---

## 11. Docker 볼륨 참조

### 명명된 볼륨

| 볼륨 이름 | 컨테이너 경로 | 목적 |
|----------|-------------|------|
| `sidjua-data` | `/app/data` | SQLite 데이터베이스, 백업 아카이브, 지식 컬렉션 |
| `sidjua-config` | `/app/config` | `divisions.yaml`, 사용자 정의 설정 |
| `sidjua-logs` | `/app/logs` | 구조화된 애플리케이션 로그 |
| `sidjua-system` | `/app/.system` | API 키, 업데이트 상태, 프로세스 잠금 파일 |
| `sidjua-workspace` | `/app/agents` | 에이전트 스킬 디렉토리, 정의, 템플릿 |
| `sidjua-governance` | `/app/governance` | 변경 불가능한 감사 추적, 거버넌스 스냅샷 |
| `qdrant-storage` | `/qdrant/storage` | Qdrant 벡터 인덱스 (시맨틱 검색 프로필만 해당) |

### 호스트 디렉토리 사용

컨테이너 내부에서 편집하는 대신 자신의 `divisions.yaml`을 마운트하려면:

```yaml
# docker-compose.override.yml
services:
  sidjua:
    volumes:
      - ./my-config:/app/config   # sidjua-config 명명된 볼륨을 대체
```

### 백업

```bash
sidjua backup create                    # 컨테이너 내부에서
# 또는
docker compose exec sidjua sidjua backup create
```

백업은 HMAC 서명된 아카이브로 `/app/data/backups/`에 저장됩니다.

---

## 12. 업그레이드

### Docker

```bash
git pull
docker compose build --no-cache
docker compose up -d
docker compose exec sidjua sidjua apply    # 스키마 마이그레이션 실행
```

`sidjua apply`는 멱등성이 있습니다. 업그레이드 후 다시 실행해도 항상 안전합니다.

### npm 글로벌 설치

```bash
npm update -g sidjua
sidjua apply    # 스키마 마이그레이션 실행
```

### 소스 빌드

```bash
git pull
npm ci
npm run build
node dist/index.js apply    # 스키마 마이그레이션 실행
```

### 롤백

SIDJUA는 각 `sidjua apply` 전에 거버넌스 스냅샷을 생성합니다. 되돌리려면:

```bash
sidjua rollback list
sidjua rollback <version>
```

---

## 13. 다음 단계

| 리소스 | 명령어 / 링크 |
|--------|-------------|
| 빠른 시작 | [docs/QUICK-START.md](QUICK-START.md) |
| CLI 참조 | [docs/CLI-REFERENCE.md](CLI-REFERENCE.md) |
| 거버넌스 예제 | [docs/GOVERNANCE-EXAMPLES.md](GOVERNANCE-EXAMPLES.md) |
| 무료 LLM 프로바이더 가이드 | [docs/FREE-LLM-PROVIDER-GUIDE.md](FREE-LLM-PROVIDER-GUIDE.md) |
| 문제 해결 | [docs/TROUBLESHOOTING.md](TROUBLESHOOTING.md) |

설치 후 처음 실행할 명령어:

```bash
sidjua chat guide    # 제로 설정 AI 가이드 — API 키 불필요
sidjua selftest      # 시스템 상태 확인 (7개 카테고리, 0~100점)
sidjua apply         # divisions.yaml에서 에이전트 프로비저닝
```
