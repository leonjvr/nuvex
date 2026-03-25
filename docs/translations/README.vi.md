[English](../../README.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [Français](README.fr.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [中文 (简体)](README.zh-CN.md) | [中文 (繁體)](README.zh-TW.md) | [العربية](README.ar.md) | [বাংলা](README.bn.md) | [Čeština](README.cs.md) | [Filipino](README.fil.md) | [हिन्दी](README.hi.md) | [Bahasa Indonesia](README.id.md) | [Italiano](README.it.md) | [Bahasa Melayu](README.ms.md) | [Nederlands](README.nl.md) | [Polski](README.pl.md) | [Português (BR)](README.pt-BR.md) | [Română](README.ro.md) | [Русский](README.ru.md) | [Svenska](README.sv.md) | [ภาษาไทย](README.th.md) | [Türkçe](README.tr.md) | [Українська](README.uk.md) | [Tiếng Việt](README.vi.md)

---

> *Trang này được dịch tự động từ [bản gốc tiếng Anh](../../README.md). Tìm thấy lỗi? [Báo cáo](https://github.com/GoetzKohlberg/sidjua/issues).*

# SIDJUA — Nền Tảng Quản Trị AI Agent

> Nền tảng agent duy nhất nơi quản trị được thực thi bởi kiến trúc, không phải bởi hy vọng rằng mô hình sẽ hoạt động đúng.

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Docker](https://img.shields.io/badge/Docker-sidjua%2Fsidjua-blue)](https://hub.docker.com/r/sidjua/sidjua)
[![Version](https://img.shields.io/badge/version-1.0.0-green)](https://github.com/sidjua-dev/sidjua/releases)

---

## Cài Đặt

### Yêu Cầu Tiên Quyết

| Công cụ | Bắt buộc | Ghi chú |
|---------|----------|---------|
| **Node.js** | >= 22.0.0 | Các module ES, `fetch()`, `crypto.subtle`. [Tải xuống](https://nodejs.org) |
| **Bộ công cụ C/C++** | Chỉ cho bản dựng từ nguồn | `better-sqlite3` và `argon2` biên dịch các add-on native |
| **Docker** | >= 24 (tùy chọn) | Chỉ cho triển khai Docker |

Cài đặt Node.js 22: Ubuntu/Debian (`curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs`), macOS (`brew install node@22`), Windows (`winget install OpenJS.NodeJS.LTS`).

Cài đặt công cụ C/C++: Ubuntu (`sudo apt-get install -y python3 make g++ build-essential`), macOS (`xcode-select --install`), Windows (`npm install --global windows-build-tools`).

### Tùy Chọn A — Docker (Được Khuyến Nghị)

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
docker compose up -d
```

```bash
# Xem khóa API được tạo tự động
docker compose exec sidjua cat /app/.system/api-key

# Khởi động quản trị
docker compose exec sidjua sidjua apply --verbose

# Kiểm tra sức khỏe hệ thống
docker compose exec sidjua sidjua selftest
```

Hỗ trợ **linux/amd64** và **linux/arm64** (Raspberry Pi, Apple Silicon).

### Tùy Chọn B — Cài Đặt npm Toàn Cục

```bash
npm install -g sidjua
sidjua init          # Thiết lập tương tác 3 bước
sidjua chat guide    # Hướng dẫn AI không cần cấu hình (không cần khóa API)
```

### Tùy Chọn C — Xây Dựng Từ Nguồn

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
npm ci && npm run build
node dist/index.js --help
```

### Lưu Ý Về Nền Tảng

| Tính năng | Linux | macOS | Windows (WSL2) | Windows (gốc) |
|-----------|-------|-------|----------------|---------------|
| CLI + REST API | ✅ Đầy đủ | ✅ Đầy đủ | ✅ Đầy đủ | ✅ Đầy đủ |
| Docker | ✅ Đầy đủ | ✅ Đầy đủ (Desktop) | ✅ Đầy đủ (Desktop) | ✅ Đầy đủ (Desktop) |
| Sandbox (bubblewrap) | ✅ Đầy đủ | ❌ Trở về `none` | ✅ Đầy đủ (trong WSL2) | ❌ Trở về `none` |
| Web Management Console | ✅ Full | ✅ Full | ✅ Full | ✅ Full |

Không cần cơ sở dữ liệu bên ngoài. SIDJUA sử dụng SQLite. Qdrant là tùy chọn (chỉ cho tìm kiếm ngữ nghĩa).

Xem [docs/INSTALLATION.md](docs/INSTALLATION.md) để có hướng dẫn đầy đủ với cấu trúc thư mục, biến môi trường, khắc phục sự cố cho từng hệ điều hành và tài liệu tham khảo Docker volume.

---

## Tại Sao Chọn SIDJUA?

Mọi framework AI agent hiện nay đều dựa trên cùng một giả định sai lầm: rằng bạn
có thể tin tưởng AI tuân theo các quy tắc của chính nó.

**Vấn đề với quản trị dựa trên prompt:**

Bạn cung cấp cho một agent một prompt hệ thống nói rằng "không bao giờ truy cập PII của khách hàng". Agent
đọc hướng dẫn. Agent cũng đọc tin nhắn của người dùng yêu cầu lấy lịch sử thanh toán
của Nguyễn Văn A. Agent tự quyết định — một mình — có tuân thủ hay không. Đó không phải là
quản trị. Đó là một đề xuất được diễn đạt mạnh mẽ.

**SIDJUA thì khác.**

Quản trị nằm **bên ngoài** agent. Mọi hành động đều đi qua pipeline thực thi 5 bước
**trước khi** thực thi. Bạn định nghĩa các quy tắc trong YAML. Hệ thống thực thi chúng.
Agent không bao giờ được quyết định có tuân theo chúng hay không, vì việc kiểm tra xảy ra
trước khi agent hành động.

Đây là quản trị bằng kiến trúc — không phải bằng prompt, không phải bằng tinh chỉnh,
không phải bằng hy vọng.

---

## Cách Thức Hoạt Động

SIDJUA bọc các agent của bạn trong một lớp quản trị bên ngoài. Lời gọi LLM của agent
không bao giờ xảy ra cho đến khi hành động được đề xuất vượt qua pipeline thực thi 5 giai đoạn:

**Giai đoạn 1 — Bị cấm:** Các hành động bị chặn bị từ chối ngay lập tức. Không có lời gọi LLM,
không có mục nhập nhật ký được đánh dấu "được phép", không có cơ hội thứ hai. Nếu hành động nằm trong
danh sách cấm, nó dừng lại ở đây.

**Giai đoạn 2 — Phê duyệt:** Các hành động yêu cầu sự đồng ý của con người bị giữ lại để
phê duyệt trước khi thực thi. Agent chờ đợi. Con người quyết định.

**Giai đoạn 3 — Ngân sách:** Mọi nhiệm vụ đều chạy dựa trên giới hạn chi phí thời gian thực. Ngân sách
mỗi nhiệm vụ và mỗi agent được thực thi. Khi đạt đến giới hạn, nhiệm vụ bị
hủy — không được đánh dấu, không được ghi nhật ký để xem xét, *hủy bỏ*.

**Giai đoạn 4 — Phân loại:** Dữ liệu vượt qua ranh giới phòng ban được kiểm tra
dựa trên các quy tắc phân loại. Agent Tier-2 không thể truy cập dữ liệu SECRET. Agent
ở Phòng ban A không thể đọc bí mật của Phòng ban B.

**Giai đoạn 5 — Chính sách:** Các quy tắc tổ chức tùy chỉnh, được thực thi có cấu trúc. Giới hạn
tần suất gọi API, giới hạn token đầu ra, hạn chế cửa sổ thời gian.

Toàn bộ pipeline chạy trước khi bất kỳ hành động nào được thực thi. Không có chế độ "ghi nhật ký và
xem xét sau" cho các hoạt động quan trọng về quản trị.

### Tệp Cấu Hình Duy Nhất

Toàn bộ tổ chức agent của bạn nằm trong một tệp `divisions.yaml` duy nhất:

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

`sidjua apply` đọc tệp này và cung cấp cơ sở hạ tầng agent hoàn chỉnh:
các agent, phòng ban, RBAC, định tuyến, bảng kiểm toán, đường dẫn bí mật và các quy tắc
quản trị — trong 10 bước có thể tái tạo.

### Kiến Trúc Agent

Các agent được tổ chức thành **phòng ban** (nhóm chức năng) và **cấp bậc**
(mức độ tin cậy). Agent Tier 1 có quyền tự chủ đầy đủ trong phạm vi quản trị của họ.
Agent Tier 2 yêu cầu phê duyệt cho các hoạt động nhạy cảm. Agent Tier 3
được giám sát hoàn toàn. Hệ thống cấp bậc được thực thi có cấu trúc — một
agent không thể tự thăng cấp.

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

## Các Ràng Buộc Kiến Trúc

SIDJUA thực thi các ràng buộc này ở cấp độ kiến trúc — chúng không thể bị
vô hiệu hóa, bỏ qua hoặc ghi đè bởi các agent:

1. **Quản trị là bên ngoài**: Lớp quản trị bọc agent. Agent
   không có quyền truy cập vào mã quản trị, không thể sửa đổi các quy tắc và không thể phát hiện
   liệu quản trị có hiện diện hay không.

2. **Trước hành động, không phải sau hành động**: Mọi hành động đều được kiểm tra TRƯỚC KHI thực thi.
   Không có chế độ "ghi nhật ký và xem xét sau" cho các hoạt động quan trọng về quản trị.

3. **Thực thi có cấu trúc**: Các quy tắc được thực thi bởi các đường dẫn mã, không phải bởi
   các prompt hoặc hướng dẫn mô hình. Một agent không thể "jailbreak" khỏi
   quản trị vì quản trị không được triển khai như các hướng dẫn cho mô hình.

4. **Tính bất biến của kiểm toán**: Write-Ahead Log (WAL) chỉ được thêm vào với
   xác minh tính toàn vẹn. Các mục bị giả mạo được phát hiện và loại trừ.

5. **Cách ly phòng ban**: Các agent ở các phòng ban khác nhau không thể truy cập
   dữ liệu, bí mật hoặc kênh liên lạc của nhau.

---

## So Sánh

| Tính năng | SIDJUA | CrewAI | AutoGen | LangGraph | OpenClaw |
|-----------|--------|--------|---------|-----------|----------|
| Quản trị bên ngoài | ✅ Kiến trúc | ❌ | ❌ | ❌ | ❌ |
| Thực thi trước hành động | ✅ Pipeline 5 bước | ❌ | ❌ | ❌ | ❌ |
| Sẵn sàng EU AI Act | ✅ | ❌ | ❌ | ❌ | ❌ |
| Tự lưu trữ | ✅ | ❌ Đám mây | ❌ Đám mây | ❌ Đám mây | ✅ Plugin |
| Có khả năng air-gap | ✅ | ❌ | ❌ | ❌ | ❌ |
| Không phụ thuộc mô hình | ✅ Bất kỳ LLM nào | Một phần | Một phần | Một phần | ✅ |
| Email hai chiều | ✅ | ❌ | ❌ | ❌ | ❌ |
| Gateway Discord | ✅ | ❌ | ❌ | ❌ | ❌ |
| Agent phân cấp | ✅ Phòng ban + Cấp bậc | Cơ bản | Cơ bản | Đồ thị | ❌ |
| Thực thi ngân sách | ✅ Giới hạn mỗi agent | ❌ | ❌ | ❌ | ❌ |
| Cách ly sandbox | ✅ bubblewrap | ❌ | ❌ | ❌ | ❌ |
| Tính bất biến kiểm toán | ✅ WAL + tính toàn vẹn | ❌ | ❌ | ❌ | ❌ |
| Giấy phép | AGPL-3.0 | MIT | MIT | MIT | Hỗn hợp |
| Kiểm toán độc lập | ✅ 2 bên ngoài | ❌ | ❌ | ❌ | ❌ |

---

## Tính Năng

### Quản Trị và Tuân Thủ

**Pipeline trước hành động (Giai đoạn 0)** chạy trước mọi hành động của agent: Kiểm tra bị cấm
→ Phê duyệt của con người → Thực thi ngân sách → Phân loại dữ liệu → Chính sách
tùy chỉnh. Cả năm giai đoạn đều có cấu trúc — chúng thực thi trong mã, không phải trong
prompt của agent.

**Các quy tắc cơ sở bắt buộc** đi kèm với mọi lần cài đặt: 10 quy tắc quản trị
(`SYS-SEC-001` đến `SYS-GOV-002`) không thể bị xóa hoặc làm yếu đi bởi
cấu hình người dùng. Các quy tắc tùy chỉnh mở rộng cơ sở; chúng không thể ghi đè nó.

**Tuân thủ EU AI Act** — đường kiểm toán, khung phân loại và quy trình công việc
phê duyệt ánh xạ trực tiếp đến các yêu cầu Điều 9, 12 và 17. Thời hạn
tuân thủ tháng 8 năm 2026 được tích hợp vào lộ trình sản phẩm.

**Báo cáo tuân thủ** qua `sidjua audit report/violations/agents/export`:
điểm tuân thủ, điểm tin cậy mỗi agent, lịch sử vi phạm, xuất CSV/JSON
cho kiểm toán viên bên ngoài hoặc tích hợp SIEM.

**Write-Ahead Log (WAL)** với xác minh tính toàn vẹn: mọi quyết định quản trị
được ghi vào nhật ký chỉ thêm trước khi thực thi. Các mục bị giả mạo
được phát hiện khi đọc. `sidjua memory recover` xác thực và sửa chữa lại.

### Giao Tiếp

Các agent không chỉ phản hồi các lời gọi API — họ tham gia vào các kênh liên lạc thực sự.

**Email hai chiều** (`sidjua email status/test/threads`): các agent nhận
email qua thăm dò IMAP và trả lời qua SMTP. Ánh xạ luồng qua các tiêu đề
In-Reply-To giữ cho các cuộc trò chuyện mạch lạc. Danh sách trắng người gửi, giới hạn kích thước
nội dung và loại bỏ HTML bảo vệ pipeline agent khỏi đầu vào độc hại.

**Bot Discord Gateway**: giao diện lệnh slash đầy đủ qua `sidjua module install
discord`. Các agent phản hồi tin nhắn Discord, duy trì luồng trò chuyện
và gửi thông báo chủ động.

**Tích hợp Telegram**: cảnh báo và thông báo của agent qua bot Telegram.
Mô hình adapter đa kênh hỗ trợ Telegram, Discord, ntfy và Email
song song.

### Vận Hành

**Một lệnh Docker duy nhất** cho môi trường sản xuất:

```bash
docker run -p 4200:4200 sidjua/sidjua:latest
```

Khóa API được tạo tự động khi khởi động lần đầu và in vào nhật ký container.
Không cần biến môi trường. Không cần cấu hình. Không cần máy chủ
cơ sở dữ liệu — SIDJUA sử dụng SQLite, một tệp cơ sở dữ liệu mỗi agent.

**Quản lý CLI** — vòng đời đầy đủ từ một tệp nhị phân duy nhất:

```bash
sidjua init                      # Thiết lập không gian làm việc tương tác (3 bước)
sidjua apply                     # Cung cấp từ divisions.yaml
sidjua agent create/list/stop    # Vòng đời agent
sidjua run "task..." --wait      # Gửi nhiệm vụ với thực thi quản trị
sidjua audit report              # Báo cáo tuân thủ
sidjua costs                     # Phân tích chi phí theo phòng ban/agent
sidjua backup create/restore     # Quản lý sao lưu được ký HMAC
sidjua update                    # Cập nhật phiên bản với sao lưu tự động trước đó
sidjua rollback                  # Khôi phục 1 nhấp về phiên bản trước
sidjua email status/test         # Quản lý kênh email
sidjua secret set/get/rotate     # Quản lý bí mật được mã hóa
sidjua memory import/search      # Pipeline kiến thức ngữ nghĩa
sidjua selftest                  # Kiểm tra sức khỏe hệ thống (7 danh mục, điểm 0-100)
```

**Bộ nhớ ngữ nghĩa** — nhập các cuộc trò chuyện và tài liệu (`sidjua memory import
~/exports/claude-chats.zip`), tìm kiếm với xếp hạng hỗn hợp vector + BM25. Hỗ trợ
nhúng Cloudflare Workers AI (miễn phí, không cần cấu hình) và nhúng lớn OpenAI
(chất lượng cao hơn cho cơ sở kiến thức lớn).

**Phân khúc thích ứng** — pipeline bộ nhớ tự động điều chỉnh kích thước phân khúc để ở trong
giới hạn token của mỗi mô hình nhúng.

**Hướng dẫn không cần cấu hình** — `sidjua chat guide` khởi chạy một trợ lý AI tương tác
mà không cần bất kỳ khóa API nào, được hỗ trợ bởi Cloudflare Workers AI qua proxy SIDJUA.
Hỏi cách thiết lập agent, cấu hình quản trị hoặc hiểu những gì đã xảy ra
trong nhật ký kiểm toán.

**Triển khai air-gap** — chạy hoàn toàn không có kết nối internet bằng cách sử dụng
LLM cục bộ qua Ollama hoặc bất kỳ endpoint tương thích OpenAI nào. Không có telemetry theo mặc định.
Báo cáo lỗi tùy chọn với biên tập PII đầy đủ.

### Bảo Mật

**Cách ly sandbox** — các kỹ năng agent chạy bên trong cách ly quy trình cấp độ OS qua
bubblewrap (không gian tên người dùng Linux). Không có chi phí RAM bổ sung. Giao diện
`SandboxProvider` có thể cắm được: `none` cho phát triển, `bubblewrap` cho sản xuất.

**Quản lý bí mật** — kho bí mật được mã hóa với RBAC (`sidjua secret
set/get/list/delete/rotate/namespaces`). Không cần kho lưu trữ bên ngoài.

**Xây dựng ưu tiên bảo mật** — bộ kiểm thử nội bộ rộng rãi cộng với xác nhận độc lập
bởi 2 kiểm toán viên mã bên ngoài (DeepSeek V3 và xAI Grok). Tiêu đề
bảo mật, bảo vệ CSRF, giới hạn tốc độ và vệ sinh đầu vào trên mọi bề mặt API.
Ngăn chặn SQL injection với các truy vấn tham số hóa xuyên suốt.

**Tính toàn vẹn sao lưu** — kho lưu trữ sao lưu được ký HMAC với bảo vệ zip-slip,
ngăn chặn zip bomb và xác minh tổng kiểm tra manifest khi khôi phục.

---

## Nhập Từ Các Framework Khác

```bash
# Xem trước những gì sẽ được nhập — không có thay đổi nào được thực hiện
sidjua import openclaw --dry-run

# Nhập cấu hình + tệp kỹ năng
sidjua import openclaw --skills
```

Các agent hiện có của bạn giữ nguyên danh tính, mô hình và kỹ năng. SIDJUA tự động thêm
quản trị, đường kiểm toán và kiểm soát ngân sách.

---

## Tài Liệu Tham Khảo Cấu Hình

Một `divisions.yaml` tối giản để bắt đầu:

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

`sidjua apply` cung cấp cơ sở hạ tầng hoàn chỉnh từ tệp này. Chạy lại
sau khi thay đổi — nó là idempotent.

Xem [docs/SIDJUA-APPLY-TECH-SPEC-V1.md](docs/SIDJUA-APPLY-TECH-SPEC-V1.md)
để biết đặc tả đầy đủ của tất cả 10 bước cung cấp.

---

## REST API

SIDJUA REST API chạy trên cùng cổng với bảng điều khiển:

```bash
sidjua server start --port 4200 --api-key $SIDJUA_API_KEY
```

Các endpoint chính:

```
GET  /api/v1/health          # Kiểm tra sức khỏe công khai (không cần xác thực)
GET  /api/v1/info            # Siêu dữ liệu hệ thống (đã xác thực)
POST /api/v1/execute/run     # Gửi một nhiệm vụ
GET  /api/v1/execute/:id/status  # Trạng thái nhiệm vụ
GET  /api/v1/execute/:id/result  # Kết quả nhiệm vụ
GET  /api/v1/events          # Luồng sự kiện SSE
GET  /api/v1/audit/report    # Báo cáo tuân thủ
```

Tất cả các endpoint ngoại trừ `/health` đều yêu cầu xác thực Bearer. Tạo một khóa:

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

Hoặc sử dụng `docker-compose.yml` đi kèm thêm các volume được đặt tên cho cấu hình,
nhật ký và không gian làm việc agent, cộng với dịch vụ Qdrant tùy chọn cho tìm kiếm ngữ nghĩa:

```bash
docker compose up -d
docker compose exec sidjua sidjua init
docker compose exec sidjua sidjua apply
```

---

## Nhà Cung Cấp

SIDJUA kết nối với bất kỳ nhà cung cấp LLM nào mà không bị ràng buộc:

| Nhà cung cấp | Mô hình | Khóa API |
|-------------|---------|----------|
| Anthropic | Claude Sonnet 4.6, Haiku 4.5, Opus 4.6 | `ANTHROPIC_API_KEY` |
| Google | Gemini 2.0, Gemini 1.5 Pro | `GOOGLE_API_KEY` |
| Groq | Llama 3.x, Mixtral | `GROQ_API_KEY` (gói miễn phí) |
| Cloudflare Workers AI | Llama, Mistral, Phi | `CF_ACCOUNT_ID` + `CF_TOKEN` |
| Ollama | Bất kỳ mô hình cục bộ nào | Không cần khóa (cục bộ) |
| Tương thích OpenAI | Bất kỳ endpoint nào | URL tùy chỉnh + khóa |

```bash
# Thêm khóa nhà cung cấp
sidjua key set groq gsk_...

# Liệt kê các nhà cung cấp và mô hình có sẵn
sidjua provider list
```

---

## Lộ Trình

Lộ trình đầy đủ tại [sidjua.com/roadmap](https://sidjua.com/roadmap).

Ngắn hạn:
- Mô hình điều phối đa agent (V1.1)
- Kích hoạt webhook inbound (V1.1)
- Giao tiếp agent-sang-agent (V1.2)
- Tích hợp Enterprise SSO (V1.x)
- Dịch vụ xác thực quản trị được lưu trữ trên đám mây (V1.x)

---

## Cộng Đồng

- **Discord**: [sidjua.com/discord](https://sidjua.com/discord)
- **GitHub Issues**: [github.com/sidjua-dev/sidjua/issues](https://github.com/sidjua-dev/sidjua/issues)
- **Email**: contact@sidjua.com
- **Tài liệu**: [sidjua.com/docs](https://sidjua.com/docs)

Nếu bạn tìm thấy lỗi, hãy mở một issue — chúng tôi hành động nhanh chóng.

---

## Bản Dịch

SIDJUA có sẵn bằng 26 ngôn ngữ. Tiếng Anh và tiếng Đức được duy trì bởi đội ngũ cốt lõi. Tất cả các bản dịch khác được tạo bởi AI và duy trì bởi cộng đồng.

**Tài liệu:** README này và [Hướng dẫn Cài đặt](docs/INSTALLATION.md) có sẵn bằng tất cả 26 ngôn ngữ. Xem bộ chọn ngôn ngữ ở đầu trang này.

| Khu vực | Ngôn ngữ |
|---------|---------|
| Châu Mỹ | Tiếng Anh, Tiếng Tây Ban Nha, Tiếng Bồ Đào Nha (Brazil) |
| Châu Âu | Tiếng Đức, Tiếng Pháp, Tiếng Ý, Tiếng Hà Lan, Tiếng Ba Lan, Tiếng Séc, Tiếng Romania, Tiếng Nga, Tiếng Ukraina, Tiếng Thụy Điển, Tiếng Thổ Nhĩ Kỳ |
| Trung Đông | Tiếng Ả Rập |
| Châu Á | Tiếng Hindi, Tiếng Bengal, Tiếng Filipino, Tiếng Indonesia, Tiếng Mã Lai, Tiếng Thái, Tiếng Việt, Tiếng Nhật, Tiếng Hàn, Tiếng Trung (giản thể), Tiếng Trung (phồn thể) |

Tìm thấy lỗi dịch? Vui lòng mở một GitHub Issue với:
- Ngôn ngữ và mã locale (ví dụ: `fil`)
- Văn bản không chính xác hoặc khóa từ tệp locale (ví dụ: `gui.nav.dashboard`)
- Bản dịch chính xác

Muốn duy trì một ngôn ngữ? Xem [CONTRIBUTING.md](CONTRIBUTING.md#translations) — chúng tôi sử dụng mô hình người bảo trì theo ngôn ngữ.

---

## Giấy Phép

**AGPL-3.0** — bạn có thể tự do sử dụng, sửa đổi và phân phối SIDJUA miễn là
bạn chia sẻ các sửa đổi theo cùng giấy phép. Mã nguồn luôn có sẵn
cho người dùng của một triển khai được lưu trữ.

Giấy phép Enterprise có sẵn cho các tổ chức yêu cầu triển khai
độc quyền mà không có nghĩa vụ AGPL.
[contact@sidjua.com](mailto:contact@sidjua.com)
