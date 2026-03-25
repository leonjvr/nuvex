> เอกสารนี้แปลด้วย AI จาก[ต้นฉบับภาษาอังกฤษ](../INSTALLATION.md) พบข้อผิดพลาด? [รายงาน](https://github.com/GoetzKohlberg/sidjua/issues)

# คู่มือการติดตั้ง SIDJUA

SIDJUA เวอร์ชัน: 1.0.0 | ใบอนุญาต: AGPL-3.0-only | อัปเดต: 2026-03-25

## สารบัญ

1. [เมตริกซ์การรองรับแพลตฟอร์ม](#1-เมตริกซ์การรองรับแพลตฟอร์ม)
2. [ข้อกำหนดเบื้องต้น](#2-ข้อกำหนดเบื้องต้น)
3. [วิธีการติดตั้ง](#3-วิธีการติดตั้ง)
4. [โครงสร้างไดเรกทอรี](#4-โครงสร้างไดเรกทอรี)
5. [ตัวแปรสภาพแวดล้อม](#5-ตัวแปรสภาพแวดล้อม)
6. [การกำหนดค่าผู้ให้บริการ](#6-การกำหนดค่าผู้ให้บริการ)
7. [อินเทอร์เฟซกราฟิกบนเดสก์ท็อป (ไม่บังคับ)](#7-อินเทอร์เฟซกราฟิกบนเดสก์ท็อป-ไม่บังคับ)
8. [การแซนด์บ็อกซ์ของเอเจนต์](#8-การแซนด์บ็อกซ์ของเอเจนต์)
9. [การค้นหาเชิงความหมาย (ไม่บังคับ)](#9-การค้นหาเชิงความหมาย-ไม่บังคับ)
10. [การแก้ไขปัญหา](#10-การแก้ไขปัญหา)
11. [ข้อมูลอ้างอิงโวลุ่ม Docker](#11-ข้อมูลอ้างอิงโวลุ่ม-docker)
12. [การอัปเกรด](#12-การอัปเกรด)
13. [ขั้นตอนถัดไป](#13-ขั้นตอนถัดไป)

---

## 1. เมตริกซ์การรองรับแพลตฟอร์ม

| ฟีเจอร์ | Linux | macOS | Windows WSL2 | Windows (เนทีฟ) |
|---------|-------|-------|--------------|----------------|
| CLI + REST API | ✅ เต็มรูปแบบ | ✅ เต็มรูปแบบ | ✅ เต็มรูปแบบ | ✅ เต็มรูปแบบ |
| Docker | ✅ เต็มรูปแบบ | ✅ Docker Desktop | ✅ Docker Desktop | ✅ Docker Desktop |
| การแซนด์บ็อกซ์ (bubblewrap) | ✅ เต็มรูปแบบ | ❌ สำรองเป็น `none` | ✅ เต็มรูปแบบ (ภายใน WSL2) | ❌ สำรองเป็น `none` |
| Web Management Console | ✅ Full | ✅ Full | ✅ Full | ✅ Full |
| การค้นหาเชิงความหมาย (Qdrant) | ✅ | ✅ | ✅ | ✅ |

**หมายเหตุเกี่ยวกับ bubblewrap:** การแซนด์บ็อกซ์ด้วย Linux user-namespace macOS และ Windows เนทีฟจะสำรองไปยังโหมดแซนด์บ็อกซ์ `none` โดยอัตโนมัติ — ไม่จำเป็นต้องกำหนดค่าใดๆ

---

## 2. ข้อกำหนดเบื้องต้น

### Node.js >= 22.0.0

**เหตุผล:** SIDJUA ใช้ ES modules, `fetch()` เนทีฟ และ `crypto.subtle` — ทั้งหมดต้องการ Node.js 22+

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

**macOS (ตัวติดตั้ง .pkg):** ดาวน์โหลดจาก [nodejs.org/en/download](https://nodejs.org/en/download)

**Windows (winget):**
```powershell
winget install OpenJS.NodeJS.LTS
```

**Windows (.msi):** ดาวน์โหลดจาก [nodejs.org/en/download](https://nodejs.org/en/download)

**WSL2:** ใช้คำแนะนำสำหรับ Ubuntu/Debian ด้านบนในเทอร์มินัล WSL2 ของคุณ

ตรวจสอบ:
```bash
node --version   # ต้องเป็น >= 22.0.0
npm --version    # ต้องเป็น >= 10.0.0
```

---

### ชุดเครื่องมือ C/C++ (สำหรับการคอมไพล์จากซอร์สโค้ดเท่านั้น)

**เหตุผล:** `better-sqlite3` และ `argon2` คอมไพล์ Node.js addons เนทีฟระหว่าง `npm ci` ผู้ใช้ Docker ข้ามขั้นตอนนี้ได้

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

**Windows:** ติดตั้ง [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) พร้อมชุดงาน **Desktop development with C++** จากนั้น:
```powershell
npm install --global windows-build-tools
```

**Alpine Linux:**
```bash
apk add python3 make g++ build-base linux-headers
```

---

### Docker >= 24 (ไม่บังคับ)

ต้องการเฉพาะสำหรับวิธีการติดตั้งผ่าน Docker ปลั๊กอิน Docker Compose V2 (`docker compose`) ต้องพร้อมใช้งาน

**Linux:** ทำตามคำแนะนำที่ [docs.docker.com/engine/install](https://docs.docker.com/engine/install/)
Docker Compose V2 รวมอยู่กับ Docker Engine >= 24

**macOS / Windows:** ติดตั้ง [Docker Desktop](https://www.docker.com/products/docker-desktop/) (รวม Docker Compose V2)

ตรวจสอบ:
```bash
docker --version          # ต้องเป็น >= 24.0.0
docker compose version    # ต้องแสดง v2.x.x
```

---

### Git

เวอร์ชันล่าสุดใดก็ได้ ติดตั้งผ่านตัวจัดการแพ็คเกจของระบบปฏิบัติการหรือจาก [git-scm.com](https://git-scm.com)

---

## 3. วิธีการติดตั้ง

### วิธีที่ A — Docker (แนะนำ)

วิธีที่เร็วที่สุดในการได้รับการติดตั้ง SIDJUA ที่ใช้งานได้ ดีเพนเดนซีทั้งหมดรวมอยู่ในอิมเมจ

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
docker compose up -d
```

รอให้บริการต่างๆ มีสุขภาพที่ดี (ใช้เวลาถึง ~60 วินาทีในการบิลด์ครั้งแรก):

```bash
docker compose ps
# NAME              STATUS
# sidjua            Up X seconds (healthy)
# sidjua-qdrant     Up X seconds (healthy)
```

ดึง API key ที่สร้างขึ้นอัตโนมัติ:

```bash
docker compose exec sidjua cat /app/.system/api-key
```

บูตสแตรปการกำกับดูแลจากไฟล์ `divisions.yaml` ของคุณ:

```bash
docker compose exec sidjua sidjua apply --verbose
```

เรียกใช้การตรวจสอบสุขภาพของระบบ:

```bash
docker compose exec sidjua sidjua selftest
```

**หมายเหตุ ARM64:** อิมเมจ Docker ถูกสร้างบน `node:22-alpine` ซึ่งรองรับ `linux/amd64` และ `linux/arm64` Raspberry Pi (64 บิต) และ Mac Apple Silicon (ผ่าน Docker Desktop) รองรับได้ทันที

**Bubblewrap ใน Docker:** เพื่อเปิดใช้งานการแซนด์บ็อกซ์ของเอเจนต์ภายในคอนเทนเนอร์ ให้เพิ่ม `--cap-add=SYS_ADMIN` ในคำสั่ง Docker run หรือตั้งค่าใน `docker-compose.yml`:
```yaml
cap_add:
  - SYS_ADMIN
```

---

### วิธีที่ B — การติดตั้ง npm แบบ global

```bash
npm install -g sidjua
```

เรียกใช้วิซาร์ดการตั้งค่าแบบโต้ตอบ (3 ขั้นตอน: ตำแหน่งพื้นที่ทำงาน, ผู้ให้บริการ, เอเจนต์แรก):
```bash
sidjua init
```

สำหรับสภาพแวดล้อม CI หรือคอนเทนเนอร์แบบไม่โต้ตอบ:
```bash
sidjua init --yes
```

เริ่มต้นคู่มือ AI แบบไม่ต้องกำหนดค่า (ไม่ต้องใช้ API key):
```bash
sidjua chat guide
```

---

### วิธีที่ C — การบิลด์จากซอร์สโค้ด

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
npm ci
npm run build
```

กระบวนการบิลด์ใช้ `tsup` เพื่อคอมไพล์ `src/index.ts` เป็น:
- `dist/index.js` (ESM)
- `dist/index.cjs` (CommonJS)

ขั้นตอนหลังการบิลด์จะคัดลอกไฟล์ locale i18n, บทบาทเริ่มต้น, ดิวิชัน และเทมเพลตฐานความรู้ไปยัง `dist/`

เรียกใช้จากซอร์สโค้ด:
```bash
node dist/index.js --help
```

เรียกใช้ชุดทดสอบ:
```bash
npm test                    # ทดสอบทั้งหมด
npm run test:coverage       # พร้อมรายงานความครอบคลุม
npx tsc --noEmit            # ตรวจสอบชนิดข้อมูลเท่านั้น
```

---

## 4. โครงสร้างไดเรกทอรี

### เส้นทางการปรับใช้ Docker

| เส้นทาง | Docker Volume | วัตถุประสงค์ | จัดการโดย |
|---------|--------------|------------|-----------|
| `/app/dist/` | ชั้นอิมเมจ | แอปพลิเคชันที่คอมไพล์แล้ว | SIDJUA |
| `/app/node_modules/` | ชั้นอิมเมจ | ดีเพนเดนซี Node.js | SIDJUA |
| `/app/system/` | ชั้นอิมเมจ | ค่าเริ่มต้นและเทมเพลตในตัว | SIDJUA |
| `/app/defaults/` | ชั้นอิมเมจ | ไฟล์กำหนดค่าเริ่มต้น | SIDJUA |
| `/app/docs/` | ชั้นอิมเมจ | เอกสารที่รวมมา | SIDJUA |
| `/app/data/` | `sidjua-data` | ฐานข้อมูล SQLite, การสำรองข้อมูล, คอลเลกชันความรู้ | ผู้ใช้ |
| `/app/config/` | `sidjua-config` | `divisions.yaml` และการกำหนดค่าแบบกำหนดเอง | ผู้ใช้ |
| `/app/logs/` | `sidjua-logs` | ไฟล์บันทึกที่มีโครงสร้าง | ผู้ใช้ |
| `/app/.system/` | `sidjua-system` | API key, สถานะการอัปเดต, การล็อคกระบวนการ | จัดการโดย SIDJUA |
| `/app/agents/` | `sidjua-workspace` | คำนิยามเอเจนต์, ทักษะ, เทมเพลต | ผู้ใช้ |
| `/app/governance/` | `sidjua-governance` | เส้นทางการตรวจสอบ, สแนปช็อตการกำกับดูแล | ผู้ใช้ |

---

### เส้นทางการติดตั้งแบบ manual / npm

หลังจาก `sidjua init` พื้นที่ทำงานของคุณจะถูกจัดระเบียบดังนี้:

```
~/sidjua-workspace/           # หรือ SIDJUA_CONFIG_DIR
├── divisions.yaml            # การกำหนดค่าการกำกับดูแลของคุณ
├── .sidjua/                  # สถานะภายใน (WAL, บัฟเฟอร์ telemetry)
│   └── telemetry.db
├── data/
│   ├── sidjua.db             # ฐานข้อมูลหลัก (เอเจนต์, งาน, การตรวจสอบ, ต้นทุน)
│   ├── knowledge/            # ฐานข้อมูลความรู้ต่อเอเจนต์
│   │   └── <agent-id>.db
│   └── backups/              # ไฟล์เก็บถาวรการสำรองข้อมูลที่เซ็น HMAC
├── agents/                   # ไดเรกทอรีทักษะเอเจนต์
├── governance/               # เส้นทางการตรวจสอบ (เพิ่มได้อย่างเดียว)
├── logs/                     # บันทึกแอปพลิเคชัน
└── system/                   # สถานะรันไทม์
```

---

### ฐานข้อมูล SQLite

| ฐานข้อมูล | เส้นทาง | เนื้อหา |
|-----------|--------|---------|
| หลัก | `data/sidjua.db` | เอเจนต์, งาน, ต้นทุน, สแนปช็อตการกำกับดูแล, API keys, บันทึกการตรวจสอบ |
| Telemetry | `.sidjua/telemetry.db` | รายงานข้อผิดพลาดแบบสมัครใจ (ลบ PII แล้ว) |
| ความรู้ | `data/knowledge/<agent-id>.db` | การฝัง vector ต่อเอเจนต์และดัชนี BM25 |

ฐานข้อมูล SQLite เป็นไฟล์เดี่ยว ข้ามแพลตฟอร์ม และพกพาได้ สำรองข้อมูลด้วย `sidjua backup create`

---

## 5. ตัวแปรสภาพแวดล้อม

คัดลอก `.env.example` ไปยัง `.env` และปรับแต่ง ตัวแปรทั้งหมดเป็นไม่บังคับ ยกเว้นที่ระบุไว้

### เซิร์ฟเวอร์

| ตัวแปร | ค่าเริ่มต้น | คำอธิบาย |
|--------|-----------|----------|
| `SIDJUA_PORT` | `3000` | พอร์ตรับฟัง REST API |
| `SIDJUA_HOST` | `127.0.0.1` | ที่อยู่การผูก REST API ใช้ `0.0.0.0` สำหรับการเข้าถึงระยะไกล |
| `NODE_ENV` | `production` | โหมดรันไทม์ (`production` หรือ `development`) |
| `SIDJUA_API_KEY` | สร้างอัตโนมัติ | โทเค็นผู้ถือ REST API สร้างอัตโนมัติเมื่อเริ่มต้นครั้งแรกหากไม่มี |
| `SIDJUA_MAX_BODY_SIZE` | `2097152` (2 MiB) | ขนาดสูงสุดของ body คำขอขาเข้าเป็นไบต์ |

### การแทนที่ไดเรกทอรี

| ตัวแปร | ค่าเริ่มต้น | คำอธิบาย |
|--------|-----------|----------|
| `SIDJUA_DATA_DIR` | `<workspace>/data` | แทนที่ตำแหน่งไดเรกทอรีข้อมูล |
| `SIDJUA_CONFIG_DIR` | `<workspace>` | แทนที่ตำแหน่งไดเรกทอรีกำหนดค่า |
| `SIDJUA_LOG_DIR` | `<workspace>/logs` | แทนที่ตำแหน่งไดเรกทอรีบันทึก |

### การค้นหาเชิงความหมาย

| ตัวแปร | ค่าเริ่มต้น | คำอธิบาย |
|--------|-----------|----------|
| `SIDJUA_QDRANT_URL` | `http://localhost:6333` | endpoint ฐานข้อมูล vector Qdrant ค่าเริ่มต้น Docker: `http://qdrant:6333` |
| `OPENAI_API_KEY` | — | ต้องการสำหรับการฝัง OpenAI `text-embedding-3-large` |
| `SIDJUA_CF_ACCOUNT_ID` | — | ID บัญชี Cloudflare สำหรับการฝังฟรี |
| `SIDJUA_CF_TOKEN` | — | โทเค็น API Cloudflare สำหรับการฝังฟรี |

### ผู้ให้บริการ LLM

| ตัวแปร | ผู้ให้บริการ |
|--------|------------|
| `ANTHROPIC_API_KEY` | Anthropic (Claude) |
| `OPENAI_API_KEY` | OpenAI (GPT-4, การฝัง) |
| `GOOGLE_AI_API_KEY` | Google AI (Gemini) |
| `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` | Cloudflare Workers AI (ระดับฟรี) |
| `GROQ_API_KEY` | Groq (การอนุมานที่รวดเร็ว, มีระดับฟรี) |
| `DEEPSEEK_API_KEY` | DeepSeek |

---

## 6. การกำหนดค่าผู้ให้บริการ

### ตัวเลือกแบบไม่ต้องกำหนดค่า

`sidjua chat guide` ทำงานโดยไม่ต้องใช้ API key ใดๆ เชื่อมต่อกับ Cloudflare Workers AI ผ่าน proxy SIDJUA จำกัดอัตรา แต่เหมาะสำหรับการประเมินและการเริ่มต้นใช้งาน

### การเพิ่มผู้ให้บริการรายแรก

**Groq (ระดับฟรี, ไม่ต้องใช้บัตรเครดิต):**
```bash
sidjua key set groq <your-groq-api-key>
sidjua provider list
```
รับ key ฟรีที่ [console.groq.com](https://console.groq.com)

**Anthropic (แนะนำสำหรับการผลิต):**
```bash
export ANTHROPIC_API_KEY=sk-ant-...
sidjua key set anthropic $ANTHROPIC_API_KEY
```

**Ollama (การปรับใช้แบบ air-gap / local):**
```bash
sidjua provider add-custom \
  --id ollama \
  --name "Ollama (local)" \
  --base-url http://localhost:11434/v1 \
  --model llama3.2
```

ตรวจสอบผู้ให้บริการที่กำหนดค่าทั้งหมด:
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

## 8. การแซนด์บ็อกซ์ของเอเจนต์

SIDJUA ใช้อินเทอร์เฟซ `SandboxProvider` แบบเสียบได้ แซนด์บ็อกซ์ห่อหุ้มการดำเนินการทักษะของเอเจนต์ในการแยกกระบวนการระดับ OS

### การรองรับแซนด์บ็อกซ์ตามแพลตฟอร์ม

| แพลตฟอร์ม | ผู้ให้บริการแซนด์บ็อกซ์ | หมายเหตุ |
|-----------|----------------------|---------|
| Linux (เนทีฟ) | `bubblewrap` | การแยก user-namespace แบบเต็มรูปแบบ |
| Docker (คอนเทนเนอร์ Linux) | `bubblewrap` | ต้องการ `--cap-add=SYS_ADMIN` |
| macOS | `none` (สำรองอัตโนมัติ) | macOS ไม่รองรับ Linux user namespaces |
| Windows WSL2 | `bubblewrap` | ติดตั้งเหมือน Linux ภายใน WSL2 |
| Windows (เนทีฟ) | `none` (สำรองอัตโนมัติ) | |

### การติดตั้ง bubblewrap (Linux)

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

### การกำหนดค่า

ใน `divisions.yaml`:
```yaml
governance:
  sandbox: bubblewrap    # หรือ: none
```

ตรวจสอบความพร้อมใช้งานของแซนด์บ็อกซ์:
```bash
sidjua sandbox check
```

---

## 9. การค้นหาเชิงความหมาย (ไม่บังคับ)

การค้นหาเชิงความหมายขับเคลื่อน `sidjua memory search` และการดึงความรู้ของเอเจนต์ ต้องการฐานข้อมูล vector Qdrant และผู้ให้บริการการฝัง

### Docker Compose Profile

`docker-compose.yml` ที่รวมมามี profile `semantic-search`:
```bash
docker compose --profile semantic-search up -d
```
นี่จะเริ่มต้นคอนเทนเนอร์ Qdrant ควบคู่กับ SIDJUA

### Qdrant แบบ standalone

```bash
docker run -d \
  --name sidjua-qdrant \
  -p 6333:6333 \
  -v qdrant-storage:/qdrant/storage \
  qdrant/qdrant:v1.13.2
```

ตั้งค่า endpoint:
```bash
export SIDJUA_QDRANT_URL=http://localhost:6333
```

### โดยไม่มี Qdrant

หาก Qdrant ไม่พร้อมใช้งาน `sidjua memory import` และ `sidjua memory search` จะถูกปิดใช้งาน ฟีเจอร์อื่นๆ ทั้งหมดของ SIDJUA (CLI, REST API, การดำเนินการเอเจนต์, การกำกับดูแล, การตรวจสอบ) ทำงานตามปกติ ระบบจะสำรองไปยังการค้นหาคำสำคัญ BM25 สำหรับการสืบค้นความรู้ใดๆ

---

## 10. การแก้ไขปัญหา

### ทุกแพลตฟอร์ม

**`npm ci` ล้มเหลวพร้อมข้อผิดพลาด `node-pre-gyp` หรือ `node-gyp`:**
```
gyp ERR! build error
```
ติดตั้งชุดเครื่องมือ C/C++ (ดูส่วนข้อกำหนดเบื้องต้น) บน Ubuntu: `sudo apt-get install -y python3 make g++ build-essential`

**`Cannot find divisions.yaml`:**
ตรวจสอบ `SIDJUA_CONFIG_DIR` ไฟล์ต้องอยู่ที่ `$SIDJUA_CONFIG_DIR/divisions.yaml` เรียกใช้ `sidjua init` เพื่อสร้างโครงสร้างพื้นที่ทำงาน

**REST API ส่งคืน 401 Unauthorized:**
ตรวจสอบส่วนหัว `Authorization: Bearer <key>` ดึง key ที่สร้างอัตโนมัติด้วย:
```bash
cat ~/.sidjua/.system/api-key          # การติดตั้งแบบ manual
docker compose exec sidjua cat /app/.system/api-key  # Docker
```

**พอร์ต 3000 ถูกใช้งานอยู่แล้ว:**
```bash
SIDJUA_PORT=3001 sidjua server start
# หรือตั้งค่าใน .env: SIDJUA_PORT=3001
```

---

### Ubuntu / Debian

**`better-sqlite3` คอมไพล์ล้มเหลวเนื่องจากไม่พบ `futex.h`:**
```bash
sudo apt-get install -y linux-headers-$(uname -r)
```

---

### Fedora / RHEL

**SELinux บล็อกการ mount volume Docker:**
```yaml
# เพิ่มป้ายกำกับ :Z สำหรับบริบท SELinux
volumes:
  - ./my-config:/app/config:Z
```
หรือตั้งค่าบริบท SELinux ด้วยตนเอง:
```bash
chcon -Rt svirt_sandbox_file_t ./my-config
```

---

### Arch Linux

**เวอร์ชัน Node.js เก่าเกินไป:**
ใช้ `nvm` เพื่อติดตั้ง Node.js 22:
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

**Docker Desktop หมดหน่วยความจำ:**
เปิด Docker Desktop → การตั้งค่า → ทรัพยากร → หน่วยความจำ เพิ่มเป็นอย่างน้อย 4 GB

**Apple Silicon — สถาปัตยกรรมไม่ตรงกัน:**
ตรวจสอบว่าการติดตั้ง Node.js ของคุณเป็น ARM64 เนทีฟ (ไม่ใช่ผ่าน Rosetta):
```bash
node -e "console.log(process.arch)"
# ที่คาดหวัง: arm64
```
หากพิมพ์ `x64` ให้ติดตั้ง Node.js ใหม่โดยใช้ตัวติดตั้ง ARM64 จาก nodejs.org

---

### Windows (เนทีฟ)

**ไม่พบ `MSBuild` หรือ `cl.exe`:**
ติดตั้ง [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) และเลือกชุดงาน **Desktop development with C++** จากนั้นเรียกใช้:
```powershell
npm install --global windows-build-tools
```

**ข้อผิดพลาดเส้นทางยาว (`ENAMETOOLONG`):**
เปิดใช้งานการรองรับเส้นทางยาวใน Windows registry:
```powershell
# เรียกใช้ในฐานะผู้ดูแลระบบ
Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" `
  -Name LongPathsEnabled -Value 1
```

**ไม่พบคำสั่ง `sidjua` หลังจาก `npm install -g`:**
เพิ่มไดเรกทอรี bin global ของ npm ไปยัง PATH ของคุณ:
```powershell
npm config get prefix  # แสดง เช่น C:\Users\you\AppData\Roaming\npm
# เพิ่มเส้นทางนั้นไปยัง System Environment Variables → Path
```

---

### Windows WSL2

**Docker ไม่เริ่มต้นภายใน WSL2:**
เปิด Docker Desktop → การตั้งค่า → ทั่วไป → เปิดใช้งาน **Use the WSL 2 based engine**
จากนั้นรีสตาร์ท Docker Desktop และเทอร์มินัล WSL2 ของคุณ

**ข้อผิดพลาดสิทธิ์บนไฟล์ภายใต้ `/mnt/c/`:**
volume Windows NTFS ที่ mount ใน WSL2 มีสิทธิ์จำกัด ย้ายพื้นที่ทำงานของคุณไปยังเส้นทาง Linux เนทีฟ:
```bash
mkdir ~/sidjua-workspace
cd ~/sidjua-workspace
sidjua init
```

---

### Raspberry Pi / ARM64

**`npm ci` ช้ามาก (5-10 นาที):**
นี่เป็นเรื่องปกติ การคอมไพล์ addon เนทีฟบน ARM64 ใช้เวลานานกว่า พิจารณาใช้อิมเมจ Docker แทน:
```bash
docker pull sidjua/sidjua:latest-arm64
```

**หน่วยความจำไม่พอระหว่างการบิลด์:**
เพิ่มพื้นที่ swap:
```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

---

## 11. ข้อมูลอ้างอิงโวลุ่ม Docker

### โวลุ่มที่มีชื่อ

| ชื่อโวลุ่ม | เส้นทางในคอนเทนเนอร์ | วัตถุประสงค์ |
|-----------|---------------------|------------|
| `sidjua-data` | `/app/data` | ฐานข้อมูล SQLite, ไฟล์เก็บถาวรสำรองข้อมูล, คอลเลกชันความรู้ |
| `sidjua-config` | `/app/config` | `divisions.yaml`, การกำหนดค่าแบบกำหนดเอง |
| `sidjua-logs` | `/app/logs` | บันทึกแอปพลิเคชันที่มีโครงสร้าง |
| `sidjua-system` | `/app/.system` | API key, สถานะการอัปเดต, ไฟล์ล็อคกระบวนการ |
| `sidjua-workspace` | `/app/agents` | ไดเรกทอรีทักษะเอเจนต์, คำนิยาม, เทมเพลต |
| `sidjua-governance` | `/app/governance` | เส้นทางการตรวจสอบที่ไม่เปลี่ยนแปลง, สแนปช็อตการกำกับดูแล |
| `qdrant-storage` | `/qdrant/storage` | ดัชนี vector Qdrant (เฉพาะ profile การค้นหาเชิงความหมาย) |

### การใช้ไดเรกทอรีโฮสต์

เพื่อ mount `divisions.yaml` ของคุณเองแทนการแก้ไขภายในคอนเทนเนอร์:

```yaml
# docker-compose.override.yml
services:
  sidjua:
    volumes:
      - ./my-config:/app/config   # แทนที่โวลุ่มที่มีชื่อ sidjua-config
```

### การสำรองข้อมูล

```bash
sidjua backup create                    # จากภายในคอนเทนเนอร์
# หรือ
docker compose exec sidjua sidjua backup create
```

การสำรองข้อมูลเป็นไฟล์เก็บถาวรที่เซ็น HMAC ที่เก็บไว้ใน `/app/data/backups/`

---

## 12. การอัปเกรด

### Docker

```bash
git pull
docker compose build --no-cache
docker compose up -d
docker compose exec sidjua sidjua apply    # เรียกใช้การย้ายสคีมา
```

`sidjua apply` เป็น idempotent — ปลอดภัยที่จะเรียกใช้ซ้ำหลังจากการอัปเกรดเสมอ

### การติดตั้ง npm แบบ global

```bash
npm update -g sidjua
sidjua apply    # เรียกใช้การย้ายสคีมา
```

### การบิลด์จากซอร์สโค้ด

```bash
git pull
npm ci
npm run build
node dist/index.js apply    # เรียกใช้การย้ายสคีมา
```

### การย้อนกลับ

SIDJUA สร้างสแนปช็อตการกำกับดูแลก่อนทุก `sidjua apply` เพื่อย้อนกลับ:

```bash
sidjua rollback list
sidjua rollback <version>
```

---

## 13. ขั้นตอนถัดไป

| ทรัพยากร | คำสั่ง / ลิงก์ |
|---------|--------------|
| เริ่มต้นอย่างรวดเร็ว | [docs/QUICK-START.md](QUICK-START.md) |
| ข้อมูลอ้างอิง CLI | [docs/CLI-REFERENCE.md](CLI-REFERENCE.md) |
| ตัวอย่างการกำกับดูแล | [docs/GOVERNANCE-EXAMPLES.md](GOVERNANCE-EXAMPLES.md) |
| คู่มือผู้ให้บริการ LLM ฟรี | [docs/FREE-LLM-PROVIDER-GUIDE.md](FREE-LLM-PROVIDER-GUIDE.md) |
| การแก้ไขปัญหา | [docs/TROUBLESHOOTING.md](TROUBLESHOOTING.md) |

คำสั่งแรกที่ควรเรียกใช้หลังการติดตั้ง:

```bash
sidjua chat guide    # คู่มือ AI แบบไม่ต้องกำหนดค่า — ไม่ต้องใช้ API key
sidjua selftest      # การตรวจสอบสุขภาพระบบ (7 หมวดหมู่, คะแนน 0-100)
sidjua apply         # จัดเตรียมเอเจนต์จาก divisions.yaml
```
