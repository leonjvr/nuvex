[English](../../README.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [Français](README.fr.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [中文 (简体)](README.zh-CN.md) | [中文 (繁體)](README.zh-TW.md) | [العربية](README.ar.md) | [বাংলা](README.bn.md) | [Čeština](README.cs.md) | [Filipino](README.fil.md) | [हिन्दी](README.hi.md) | [Bahasa Indonesia](README.id.md) | [Italiano](README.it.md) | [Bahasa Melayu](README.ms.md) | [Nederlands](README.nl.md) | [Polski](README.pl.md) | [Português (BR)](README.pt-BR.md) | [Română](README.ro.md) | [Русский](README.ru.md) | [Svenska](README.sv.md) | [ภาษาไทย](README.th.md) | [Türkçe](README.tr.md) | [Українська](README.uk.md) | [Tiếng Việt](README.vi.md)

> *이 페이지는 [영어 원본](../../README.md)에서 자동 번역되었습니다. 오류를 발견했나요? [보고하기](https://github.com/GoetzKohlberg/sidjua/issues).*

# SIDJUA — AI 에이전트 거버넌스 플랫폼

> 모델이 알아서 잘 행동하기를 바라는 것이 아니라, 아키텍처에 의해 거버넌스가 강제되는 유일한 에이전트 플랫폼.

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Docker](https://img.shields.io/badge/Docker-ghcr.io%2Fgoetzkohlberg%2Fsidjua-blue)](https://ghcr.io/goetzkohlberg/sidjua)
[![Version](https://img.shields.io/badge/version-1.0.0-green)](https://github.com/GoetzKohlberg/sidjua/releases)

---

## 설치

### 사전 요구 사항

| 도구 | 필수 | 비고 |
|------|------|------|
| **Node.js** | >= 22.0.0 | ES 모듈, `fetch()`, `crypto.subtle`. [다운로드](https://nodejs.org) |
| **C/C++ 툴체인** | 소스 빌드 전용 | `better-sqlite3`와 `argon2`가 네이티브 애드온 컴파일 |
| **Docker** | >= 24 (선택 사항) | Docker 배포 전용 |

Node.js 22 설치: Ubuntu/Debian (`curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs`), macOS (`brew install node@22`), Windows (`winget install OpenJS.NodeJS.LTS`).

C/C++ 도구 설치: Ubuntu (`sudo apt-get install -y python3 make g++ build-essential`), macOS (`xcode-select --install`), Windows (`npm install --global windows-build-tools`).

### 옵션 A — Docker (권장)

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
docker compose up -d
```

```bash
# 자동 생성된 API 키 확인
docker compose exec sidjua cat /app/.system/api-key

# 거버넌스 부트스트랩
docker compose exec sidjua sidjua apply --verbose

# 시스템 상태 확인
docker compose exec sidjua sidjua selftest
```

**linux/amd64** 및 **linux/arm64** (Raspberry Pi, Apple Silicon) 지원.

### 옵션 B — npm 전역 설치

```bash
npm install -g sidjua
sidjua init          # 인터랙티브 3단계 설정
sidjua chat guide    # 제로 구성 AI 가이드 (API 키 불필요)
```

### 옵션 C — 소스 빌드

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
npm ci && npm run build
node dist/index.js --help
```

### 플랫폼 참고 사항

| 기능 | Linux | macOS | Windows (WSL2) | Windows (네이티브) |
|------|-------|-------|----------------|-------------------|
| CLI + REST API | ✅ 전체 | ✅ 전체 | ✅ 전체 | ✅ 전체 |
| Docker | ✅ 전체 | ✅ 전체 (Desktop) | ✅ 전체 (Desktop) | ✅ 전체 (Desktop) |
| 샌드박싱 (bubblewrap) | ✅ 전체 | ❌ `none`으로 대체 | ✅ 전체 (WSL2 내부) | ❌ `none`으로 대체 |
| Web Management Console | ✅ Full | ✅ Full | ✅ Full | ✅ Full |

외부 데이터베이스가 필요 없습니다. SIDJUA는 SQLite를 사용합니다. Qdrant는 선택 사항(의미 검색 전용).

디렉토리 구조, 환경 변수, OS별 문제 해결 및 Docker 볼륨 참조를 포함한 전체 가이드는 [docs/INSTALLATION.md](docs/INSTALLATION.md)를 참조하세요.

---

## 왜 SIDJUA인가?

오늘날 모든 AI 에이전트 프레임워크는 동일한 잘못된 가정에 의존합니다: AI가 자체 규칙을 따를 것을 신뢰할 수 있다는 가정.

**프롬프트 기반 거버넌스의 문제:**

에이전트에게 "고객 PII에 절대 접근하지 말라"는 시스템 프롬프트를 제공합니다. 에이전트는 이 지침을 읽습니다. 에이전트는 또한 존 스미스의 결제 내역을 가져오도록 요청하는 사용자 메시지도 읽습니다. 에이전트는 스스로 준수 여부를 결정합니다. 그것은 거버넌스가 아닙니다. 그것은 강하게 표현된 제안에 불과합니다.

**SIDJUA는 다릅니다.**

거버넌스는 에이전트 **외부**에 위치합니다. 모든 작업은 실행되기 **전에** 5단계 사전 조치 실행 파이프라인을 통과합니다. YAML로 규칙을 정의합니다. 시스템이 그것을 실행합니다. 에이전트가 규칙을 따를지 결정하지 않습니다. 에이전트가 행동하기 전에 검사가 이루어지기 때문입니다.

이것은 아키텍처에 의한 거버넌스입니다 — 프롬프트로도, 파인튜닝으로도, 기대로도 아닙니다.

---

## 작동 방식

SIDJUA는 에이전트를 외부 거버넌스 레이어로 감쌉니다. 제안된 작업이 5단계 실행 파이프라인을 통과할 때까지 에이전트의 LLM 호출은 이루어지지 않습니다:

**1단계 — 금지:** 차단된 작업은 즉시 거부됩니다. LLM 호출 없음, "허용됨"으로 표시된 로그 항목 없음, 두 번째 기회 없음. 작업이 금지 목록에 있으면 여기서 중단됩니다.

**2단계 — 승인:** 인간의 승인이 필요한 작업은 실행 전에 대기 상태로 유지됩니다. 에이전트는 대기합니다. 인간이 결정합니다.

**3단계 — 예산:** 모든 작업은 실시간 비용 한도에 따라 실행됩니다. 작업당 및 에이전트당 예산이 적용됩니다. 한도에 도달하면 작업은 취소됩니다 — 플래그가 표시되거나 검토를 위해 기록되는 것이 아니라 *취소*됩니다.

**4단계 — 분류:** 부서 경계를 넘는 데이터는 분류 규칙에 따라 확인됩니다. 티어 2 에이전트는 SECRET 데이터에 접근할 수 없습니다. 부서 A의 에이전트는 부서 B의 비밀을 읽을 수 없습니다.

**5단계 — 정책:** 구조적으로 실행되는 맞춤형 조직 규칙. API 호출 빈도 제한, 출력 토큰 상한, 시간 창 제한.

파이프라인 전체는 모든 작업이 실행되기 전에 실행됩니다. 거버넌스에 중요한 작업에는 "나중에 로그 기록 및 검토" 모드가 없습니다.

### 단일 구성 파일

전체 에이전트 조직은 하나의 `divisions.yaml`에 저장됩니다:

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

`sidjua apply`는 이 파일을 읽고 완전한 에이전트 인프라를 프로비저닝합니다: 에이전트, 부서, RBAC, 라우팅, 감사 테이블, 비밀 경로, 거버넌스 규칙 — 10가지 재현 가능한 단계로.

### 에이전트 아키텍처

에이전트는 **부서**(기능 그룹)와 **티어**(신뢰 수준)로 구성됩니다. 티어 1 에이전트는 거버넌스 봉투 내에서 완전한 자율성을 갖습니다. 티어 2 에이전트는 민감한 작업에 승인이 필요합니다. 티어 3 에이전트는 완전히 감독됩니다. 티어 시스템은 구조적으로 적용됩니다 — 에이전트는 스스로 승격할 수 없습니다.

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

## 아키텍처 제약

SIDJUA는 이러한 제약을 아키텍처 수준에서 실행합니다 — 에이전트에 의해 비활성화, 우회 또는 재정의될 수 없습니다:

1. **거버넌스는 외부적:** 거버넌스 레이어가 에이전트를 감쌉니다. 에이전트는 거버넌스 코드에 접근할 수 없고, 규칙을 수정할 수 없으며, 거버넌스가 존재하는지 감지할 수 없습니다.

2. **사전 조치, 사후 조치 아님:** 모든 작업은 실행 전에 확인됩니다. 거버넌스에 중요한 작업에는 "나중에 로그 기록 및 검토" 모드가 없습니다.

3. **구조적 실행:** 규칙은 프롬프트나 모델 지침이 아닌 코드 경로에 의해 실행됩니다. 에이전트는 거버넌스를 "탈옥"할 수 없습니다. 거버넌스가 모델에 대한 지침으로 구현되지 않기 때문입니다.

4. **감사 불변성:** Write-Ahead Log (WAL)는 무결성 검증이 있는 추가 전용입니다. 변조된 항목은 감지되어 제외됩니다.

5. **부서 격리:** 서로 다른 부서의 에이전트는 서로의 데이터, 비밀 또는 통신 채널에 접근할 수 없습니다.

---

## 비교

| 기능 | SIDJUA | CrewAI | AutoGen | LangGraph | OpenClaw |
|------|--------|--------|---------|-----------|----------|
| 외부 거버넌스 | ✅ 아키텍처 | ❌ | ❌ | ❌ | ❌ |
| 사전 조치 실행 | ✅ 5단계 파이프라인 | ❌ | ❌ | ❌ | ❌ |
| EU AI 법 준비 | ✅ | ❌ | ❌ | ❌ | ❌ |
| 자체 호스팅 | ✅ | ❌ 클라우드 | ❌ 클라우드 | ❌ 클라우드 | ✅ 플러그인 |
| 에어 갭 가능 | ✅ | ❌ | ❌ | ❌ | ❌ |
| 모델 독립적 | ✅ 모든 LLM | 부분적 | 부분적 | 부분적 | ✅ |
| 양방향 이메일 | ✅ | ❌ | ❌ | ❌ | ❌ |
| Discord 게이트웨이 | ✅ | ❌ | ❌ | ❌ | ❌ |
| 계층적 에이전트 | ✅ 부서 + 티어 | 기본 | 기본 | 그래프 | ❌ |
| 예산 실행 | ✅ 에이전트별 한도 | ❌ | ❌ | ❌ | ❌ |
| 샌드박스 격리 | ✅ bubblewrap | ❌ | ❌ | ❌ | ❌ |
| 감사 불변성 | ✅ WAL + 무결성 | ❌ | ❌ | ❌ | ❌ |
| 라이선스 | AGPL-3.0 | MIT | MIT | MIT | 혼합 |
| 독립 감사 | ✅ 외부 2건 | ❌ | ❌ | ❌ | ❌ |

---

## 기능

### 거버넌스 및 컴플라이언스

**사전 조치 파이프라인 (0단계)**은 모든 에이전트 작업 전에 실행됩니다: 금지 확인 → 인간 승인 → 예산 실행 → 데이터 분류 → 맞춤형 정책. 다섯 단계 모두 구조적입니다 — 에이전트의 프롬프트가 아닌 코드로 실행됩니다.

**필수 기본 규칙**은 모든 설치에 포함됩니다: 사용자 구성으로 제거하거나 약화시킬 수 없는 10개의 거버넌스 규칙(`SYS-SEC-001`부터 `SYS-GOV-002`). 맞춤형 규칙은 기본을 확장합니다. 재정의는 불가합니다.

**EU AI 법 준수** — 감사 추적, 분류 프레임워크, 승인 워크플로우는 제9조, 12조, 17조 요구 사항에 직접 매핑됩니다. 2026년 8월 준수 기한은 제품 로드맵에 포함되어 있습니다.

**컴플라이언스 보고** `sidjua audit report/violations/agents/export`를 통해: 컴플라이언스 점수, 에이전트별 신뢰 점수, 위반 이력, 외부 감사자 또는 SIEM 통합을 위한 CSV/JSON 내보내기.

**Write-Ahead Log (WAL)**과 무결성 검증: 모든 거버넌스 결정은 실행 전에 추가 전용 로그에 기록됩니다. 변조된 항목은 읽기 시 감지됩니다. `sidjua memory recover`가 재검증 및 복구를 수행합니다.

### 커뮤니케이션

에이전트는 단순히 API 호출에 응답하는 것이 아니라 실제 커뮤니케이션 채널에 참여합니다.

**양방향 이메일** (`sidjua email status/test/threads`): 에이전트는 IMAP 폴링을 통해 이메일을 수신하고 SMTP를 통해 답장합니다. In-Reply-To 헤더를 통한 스레드 매핑으로 대화의 일관성을 유지합니다. 발신자 화이트리스트, 본문 크기 제한, HTML 제거로 에이전트 파이프라인을 악의적인 입력으로부터 보호합니다.

**Discord 게이트웨이 봇**: `sidjua module install discord`를 통한 완전한 슬래시 명령 인터페이스. 에이전트는 Discord 메시지에 응답하고, 대화 스레드를 유지하며, 능동적 알림을 보냅니다.

**Telegram 연동**: Telegram 봇을 통한 에이전트 알림. 멀티 채널 어댑터 패턴은 Telegram, Discord, ntfy, 이메일을 병렬로 지원합니다.

### 운영

**단일 Docker 명령**으로 프로덕션:

```bash
docker run -p 4200:4200 ghcr.io/goetzkohlberg/sidjua:latest
```

API 키는 첫 시작 시 자동 생성되어 컨테이너 로그에 출력됩니다. 환경 변수 불필요. 구성 불필요. 데이터베이스 서버 불필요 — SIDJUA는 SQLite를 사용하며, 에이전트당 하나의 데이터베이스 파일.

**CLI 관리** — 단일 바이너리에서 완전한 라이프사이클:

```bash
sidjua init                      # 인터랙티브 워크스페이스 설정 (3단계)
sidjua apply                     # divisions.yaml에서 프로비저닝
sidjua agent create/list/stop    # 에이전트 라이프사이클
sidjua run "작업..." --wait      # 거버넌스 실행으로 작업 제출
sidjua audit report              # 컴플라이언스 보고서
sidjua costs                     # 부서/에이전트별 비용 내역
sidjua backup create/restore     # HMAC 서명 백업 관리
sidjua update                    # 자동 사전 백업으로 버전 업데이트
sidjua rollback                  # 이전 버전으로 1클릭 복원
sidjua email status/test         # 이메일 채널 관리
sidjua secret set/get/rotate     # 암호화된 비밀 관리
sidjua memory import/search      # 의미론적 지식 파이프라인
sidjua selftest                  # 시스템 상태 확인 (7개 카테고리, 0-100 점수)
```

**의미론적 메모리** — 대화와 문서를 가져오고(`sidjua memory import ~/exports/claude-chats.zip`), 벡터 + BM25 하이브리드 랭킹으로 검색합니다. Cloudflare Workers AI 임베딩(무료, 제로 구성)과 OpenAI 대규모 임베딩(대용량 지식 베이스에 적합한 고품질)을 지원합니다.

**적응형 청킹** — 메모리 파이프라인은 각 임베딩 모델의 토큰 한도 내에 맞도록 청크 크기를 자동 조정합니다.

**제로 구성 가이드** — `sidjua chat guide`는 API 키 없이 인터랙티브 AI 어시스턴트를 실행하며, SIDJUA 프록시를 통한 Cloudflare Workers AI로 구동됩니다. 에이전트 설정 방법, 거버넌스 구성, 또는 감사 로그에서 발생한 일에 대해 물어볼 수 있습니다.

**에어 갭 배포** — Ollama 또는 OpenAI 호환 엔드포인트를 통한 로컬 LLM을 사용하여 인터넷에서 완전히 분리된 상태로 실행. 기본적으로 원격 측정 없음. 완전한 PII 리다이렉션을 통한 선택적 크래시 보고.

### 보안

**샌드박스 격리** — 에이전트 스킬은 bubblewrap(Linux 사용자 네임스페이스)을 통한 OS 수준 프로세스 격리 내에서 실행됩니다. 추가 RAM 오버헤드 없음. 플러그 가능한 `SandboxProvider` 인터페이스: 개발용 `none`, 프로덕션용 `bubblewrap`.

**비밀 관리** — RBAC가 있는 암호화된 비밀 저장소(`sidjua secret set/get/list/delete/rotate/namespaces`). 외부 볼트 불필요.

**보안 우선 빌드** — 광범위한 내부 테스트 스위트와 2명의 외부 코드 감사자(DeepSeek V3 및 xAI Grok)의 독립 검증. 모든 API 서피스에 보안 헤더, CSRF 보호, 속도 제한, 입력 위생 처리. 전체적으로 매개변수화된 쿼리를 통한 SQL 주입 방지.

**백업 무결성** — zip 슬립 보호, zip 폭탄 방지, 복원 시 매니페스트 체크섬 검증이 있는 HMAC 서명 백업 아카이브.

---

## 다른 프레임워크에서 가져오기

```bash
# 가져올 항목 미리 보기 — 변경 없음
sidjua import openclaw --dry-run

# 구성 + 스킬 파일 가져오기
sidjua import openclaw --skills
```

기존 에이전트는 자신의 정체성, 모델, 스킬을 유지합니다. SIDJUA는 거버넌스, 감사 추적, 예산 컨트롤을 자동으로 추가합니다.

---

## 구성 참조

시작을 위한 최소한의 `divisions.yaml`:

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

`sidjua apply`는 이 파일에서 완전한 인프라를 프로비저닝합니다. 변경 후 다시 실행하세요 — 멱등성이 있습니다.

모든 10가지 프로비저닝 단계의 전체 사양은 [docs/SIDJUA-APPLY-TECH-SPEC-V1.md](docs/SIDJUA-APPLY-TECH-SPEC-V1.md)를 참조하세요.

---

## REST API

SIDJUA REST API는 대시보드와 동일한 포트에서 실행됩니다:

```bash
sidjua server start --port 4200 --api-key $SIDJUA_API_KEY
```

주요 엔드포인트:

```
GET  /api/v1/health          # 공개 상태 확인 (인증 없음)
GET  /api/v1/info            # 시스템 메타데이터 (인증됨)
POST /api/v1/execute/run     # 작업 제출
GET  /api/v1/execute/:id/status  # 작업 상태
GET  /api/v1/execute/:id/result  # 작업 결과
GET  /api/v1/events          # SSE 이벤트 스트림
GET  /api/v1/audit/report    # 컴플라이언스 보고서
```

`/health`를 제외한 모든 엔드포인트에는 Bearer 인증이 필요합니다. 키 생성:

```bash
sidjua api-key generate
```

---

## Docker Compose

```yaml
services:
  sidjua:
    image: ghcr.io/goetzkohlberg/sidjua:latest
    ports:
      - "4200:4200"
    volumes:
      - sidjua-data:/data
    restart: unless-stopped

volumes:
  sidjua-data:
```

또는 구성, 로그, 에이전트 워크스페이스를 위한 명명된 볼륨과 의미 검색을 위한 선택적 Qdrant 서비스를 추가하는 포함된 `docker-compose.yml`을 사용하세요:

```bash
docker compose up -d
docker compose exec sidjua sidjua init
docker compose exec sidjua sidjua apply
```

---

## 제공자

SIDJUA는 잠금 없이 모든 LLM 제공자에 연결합니다:

| 제공자 | 모델 | API 키 |
|--------|------|--------|
| Anthropic | Claude Sonnet 4.6, Haiku 4.5, Opus 4.6 | `ANTHROPIC_API_KEY` |
| Google | Gemini 2.0, Gemini 1.5 Pro | `GOOGLE_API_KEY` |
| Groq | Llama 3.x, Mixtral | `GROQ_API_KEY` (무료 티어) |
| Cloudflare Workers AI | Llama, Mistral, Phi | `CF_ACCOUNT_ID` + `CF_TOKEN` |
| Ollama | 모든 로컬 모델 | 키 없음 (로컬) |
| OpenAI 호환 | 모든 엔드포인트 | 맞춤 URL + 키 |

```bash
# 제공자 키 추가
sidjua key set groq gsk_...

# 사용 가능한 제공자 및 모델 목록
sidjua provider list
```

---

## 로드맵

전체 로드맵은 [sidjua.com/roadmap](https://sidjua.com/roadmap)에서 확인하세요.

단기 계획:
- 멀티 에이전트 오케스트레이션 패턴 (V1.1)
- Webhook 인바운드 트리거 (V1.1)
- 에이전트 간 통신 (V1.2)
- 엔터프라이즈 SSO 통합 (V1.x)
- 클라우드 호스팅 거버넌스 검증 서비스 (V1.x)

---

## 커뮤니티

- **Discord**: [sidjua.com/discord](https://sidjua.com/discord)
- **GitHub Issues**: [github.com/GoetzKohlberg/sidjua/issues](https://github.com/GoetzKohlberg/sidjua/issues)
- **이메일**: contact@sidjua.com
- **문서**: [sidjua.com/docs](https://sidjua.com/docs)

버그를 발견하면 이슈를 열어주세요 — 신속하게 대응합니다.

---

## 번역

SIDJUA는 26개 언어로 제공됩니다. 영어와 독일어는 핵심 팀이 관리합니다. 다른 모든 번역은 AI 생성이며 커뮤니티가 관리합니다.

**문서:** 이 README와 [설치 가이드](docs/INSTALLATION.md)는 모두 26개 언어로 제공됩니다. 이 페이지 상단의 언어 선택기를 참조하세요.

| 지역 | 언어 |
|------|------|
| 아메리카 | 영어, 스페인어, 포르투갈어(브라질) |
| 유럽 | 독일어, 프랑스어, 이탈리아어, 네덜란드어, 폴란드어, 체코어, 루마니아어, 러시아어, 우크라이나어, 스웨덴어, 터키어 |
| 중동 | 아랍어 |
| 아시아 | 힌디어, 벵골어, 필리핀어, 인도네시아어, 말레이어, 태국어, 베트남어, 일본어, 한국어, 중국어(간체), 중국어(번체) |

번역 오류를 발견했나요? 다음 정보를 포함하여 GitHub 이슈를 열어주세요:
- 언어 및 로케일 코드 (예: `ko`)
- 잘못된 텍스트 또는 로케일 파일의 키 (예: `gui.nav.dashboard`)
- 올바른 번역

언어를 관리하고 싶으신가요? [CONTRIBUTING.md](CONTRIBUTING.md#translations)를 참조하세요 — 언어별 관리자 모델을 사용합니다.

---

## 라이선스

**AGPL-3.0** — 동일한 라이선스 하에 수정 사항을 공유하는 한 SIDJUA를 자유롭게 사용, 수정, 배포할 수 있습니다. 소스 코드는 항상 호스팅된 배포의 사용자에게 제공됩니다.

AGPL 의무 없이 독점 배포가 필요한 조직을 위한 엔터프라이즈 라이선스도 제공됩니다.
[contact@sidjua.com](mailto:contact@sidjua.com)
