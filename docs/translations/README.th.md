[English](../../README.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [Français](README.fr.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [中文 (简体)](README.zh-CN.md) | [中文 (繁體)](README.zh-TW.md) | [العربية](README.ar.md) | [বাংলা](README.bn.md) | [Čeština](README.cs.md) | [Filipino](README.fil.md) | [हिन्दी](README.hi.md) | [Bahasa Indonesia](README.id.md) | [Italiano](README.it.md) | [Bahasa Melayu](README.ms.md) | [Nederlands](README.nl.md) | [Polski](README.pl.md) | [Português (BR)](README.pt-BR.md) | [Română](README.ro.md) | [Русский](README.ru.md) | [Svenska](README.sv.md) | [ภาษาไทย](README.th.md) | [Türkçe](README.tr.md) | [Українська](README.uk.md) | [Tiếng Việt](README.vi.md)

---

> *หน้านี้แปลโดยอัตโนมัติจาก[ต้นฉบับภาษาอังกฤษ](../../README.md) พบข้อผิดพลาด? [รายงาน](https://github.com/GoetzKohlberg/sidjua/issues)*

# SIDJUA — แพลตฟอร์มการกำกับดูแล AI Agent

> แพลตฟอร์ม Agent เดียวที่การกำกับดูแลถูกบังคับใช้โดยสถาปัตยกรรม ไม่ใช่โดยความหวังว่าโมเดลจะทำงานถูกต้อง

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Docker](https://img.shields.io/badge/Docker-sidjua%2Fsidjua-blue)](https://hub.docker.com/r/sidjua/sidjua)
[![Version](https://img.shields.io/badge/version-1.0.0-green)](https://github.com/sidjua-dev/sidjua/releases)

---

## การติดตั้ง

### ข้อกำหนดเบื้องต้น

| เครื่องมือ | ที่จำเป็น | หมายเหตุ |
|-----------|----------|----------|
| **Node.js** | >= 22.0.0 | โมดูล ES, `fetch()`, `crypto.subtle`. [ดาวน์โหลด](https://nodejs.org) |
| **ชุดเครื่องมือ C/C++** | เฉพาะการสร้างจากซอร์สโค้ด | `better-sqlite3` และ `argon2` คอมไพล์ส่วนเสริมแบบ native |
| **Docker** | >= 24 (ไม่บังคับ) | เฉพาะสำหรับการปรับใช้ Docker |

ติดตั้ง Node.js 22: Ubuntu/Debian (`curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs`), macOS (`brew install node@22`), Windows (`winget install OpenJS.NodeJS.LTS`).

ติดตั้งเครื่องมือ C/C++: Ubuntu (`sudo apt-get install -y python3 make g++ build-essential`), macOS (`xcode-select --install`), Windows (`npm install --global windows-build-tools`).

### ตัวเลือก A — Docker (แนะนำ)

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
docker compose up -d
```

```bash
# ดู API key ที่สร้างโดยอัตโนมัติ
docker compose exec sidjua cat /app/.system/api-key

# เริ่มการกำกับดูแล
docker compose exec sidjua sidjua apply --verbose

# ตรวจสอบสุขภาพระบบ
docker compose exec sidjua sidjua selftest
```

รองรับ **linux/amd64** และ **linux/arm64** (Raspberry Pi, Apple Silicon)

### ตัวเลือก B — การติดตั้ง npm แบบ Global

```bash
npm install -g sidjua
sidjua init          # การตั้งค่าแบบโต้ตอบ 3 ขั้นตอน
sidjua chat guide    # คู่มือ AI ไม่ต้องตั้งค่า (ไม่ต้องใช้ API key)
```

### ตัวเลือก C — การสร้างจากซอร์สโค้ด

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
npm ci && npm run build
node dist/index.js --help
```

### หมายเหตุเกี่ยวกับแพลตฟอร์ม

| ฟีเจอร์ | Linux | macOS | Windows (WSL2) | Windows (native) |
|---------|-------|-------|----------------|------------------|
| CLI + REST API | ✅ เต็มรูปแบบ | ✅ เต็มรูปแบบ | ✅ เต็มรูปแบบ | ✅ เต็มรูปแบบ |
| Docker | ✅ เต็มรูปแบบ | ✅ เต็มรูปแบบ (Desktop) | ✅ เต็มรูปแบบ (Desktop) | ✅ เต็มรูปแบบ (Desktop) |
| Sandboxing (bubblewrap) | ✅ เต็มรูปแบบ | ❌ ย้อนกลับไปที่ `none` | ✅ เต็มรูปแบบ (ใน WSL2) | ❌ ย้อนกลับไปที่ `none` |
| Web Management Console | ✅ Full | ✅ Full | ✅ Full | ✅ Full |

ไม่จำเป็นต้องใช้ฐานข้อมูลภายนอก SIDJUA ใช้ SQLite Qdrant เป็นตัวเลือก (เฉพาะการค้นหาเชิงความหมาย)

ดู [docs/INSTALLATION.md](docs/INSTALLATION.md) สำหรับคู่มือฉบับสมบูรณ์พร้อมโครงสร้างไดเรกทอรี ตัวแปรสภาพแวดล้อม การแก้ไขปัญหาสำหรับแต่ละระบบปฏิบัติการ และเอกสารอ้างอิง Docker volume

---

## ทำไมต้องใช้ SIDJUA?

กรอบงาน AI Agent ทุกตัวในปัจจุบันอาศัยสมมติฐานที่ผิดพลาดเดียวกัน: ว่าคุณ
สามารถไว้วางใจให้ AI ปฏิบัติตามกฎของตัวเองได้

**ปัญหาของการกำกับดูแลแบบ prompt:**

คุณให้ prompt ระบบแก่ agent ที่บอกว่า "อย่าเข้าถึง PII ของลูกค้าเด็ดขาด" Agent
อ่านคำสั่ง Agent ยังอ่านข้อความของผู้ใช้ที่ขอให้ดึงประวัติการชำระเงินของสมชาย ใจดี
Agent ตัดสินใจ — ด้วยตัวเอง — ว่าจะปฏิบัติตามหรือไม่ นั่นไม่ใช่การกำกับดูแล
นั่นคือข้อเสนอแนะที่กำหนดไว้อย่างหนักแน่น

**SIDJUA แตกต่างออกไป**

การกำกับดูแลอยู่ **ภายนอก** agent ทุกการกระทำผ่านไปป์ไลน์การบังคับใช้ 5 ขั้นตอน
**ก่อน** การดำเนินการ คุณกำหนดกฎใน YAML ระบบบังคับใช้กฎเหล่านั้น
Agent ไม่มีโอกาสตัดสินใจว่าจะปฏิบัติตามหรือไม่ เพราะการตรวจสอบเกิดขึ้นก่อน
ที่ agent จะดำเนินการ

นี่คือการกำกับดูแลผ่านสถาปัตยกรรม ไม่ใช่ผ่าน prompt ไม่ใช่ผ่านการปรับแต่ง
และไม่ใช่ผ่านความหวัง

---

## วิธีการทำงาน

SIDJUA ห่อหุ้ม agent ของคุณด้วยชั้นการกำกับดูแลภายนอก การเรียก LLM ของ agent
จะไม่เกิดขึ้นจนกว่าการกระทำที่เสนอจะผ่านไปป์ไลน์การบังคับใช้ 5 ขั้นตอน:

**ขั้นตอนที่ 1 — ห้าม:** การกระทำที่ถูกบล็อกจะถูกปฏิเสธทันที ไม่มีการเรียก LLM
ไม่มีรายการบันทึกที่ทำเครื่องหมายว่า "อนุญาต" ไม่มีโอกาสที่สอง หากการกระทำอยู่ใน
รายการห้าม มันจะหยุดที่นี่

**ขั้นตอนที่ 2 — การอนุมัติ:** การกระทำที่ต้องได้รับการอนุมัติจากมนุษย์จะถูกระงับไว้
เพื่อรอการอนุมัติก่อนดำเนินการ Agent รอ มนุษย์ตัดสินใจ

**ขั้นตอนที่ 3 — งบประมาณ:** ทุกงานดำเนินการภายใต้ขีดจำกัดต้นทุนแบบเรียลไทม์ งบประมาณ
ต่องานและต่อ agent ถูกบังคับใช้ เมื่อถึงขีดจำกัด งานจะถูก
ยกเลิก ไม่ใช่ทำเครื่องหมาย ไม่ใช่บันทึกเพื่อตรวจสอบ แต่ *ยกเลิก*

**ขั้นตอนที่ 4 — การจำแนก:** ข้อมูลที่ข้ามขอบเขตระหว่างฝ่ายจะถูกตรวจสอบ
เทียบกับกฎการจำแนก Agent Tier-2 ไม่สามารถเข้าถึงข้อมูล SECRET ได้ Agent
ในฝ่าย A ไม่สามารถอ่านความลับของฝ่าย B ได้

**ขั้นตอนที่ 5 — นโยบาย:** กฎองค์กรที่กำหนดเอง บังคับใช้ตามโครงสร้าง ขีดจำกัด
ความถี่การเรียก API ขีดจำกัด token เอาต์พุต ข้อจำกัดช่วงเวลา

ไปป์ไลน์ทั้งหมดทำงานก่อนที่การกระทำใดๆ จะดำเนินการ ไม่มีโหมด "บันทึกและ
ตรวจสอบภายหลัง" สำหรับการดำเนินการที่สำคัญต่อการกำกับดูแล

### ไฟล์การกำหนดค่าเดียว

องค์กร agent ทั้งหมดของคุณอยู่ในไฟล์ `divisions.yaml` เดียว:

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

`sidjua apply` อ่านไฟล์นี้และจัดเตรียมโครงสร้างพื้นฐาน agent ที่สมบูรณ์:
agent ฝ่าย RBAC การกำหนดเส้นทาง ตารางการตรวจสอบ เส้นทางความลับ และ
กฎการกำกับดูแล ใน 10 ขั้นตอนที่ทำซ้ำได้

### สถาปัตยกรรม Agent

Agent จัดระเบียบเป็น **ฝ่าย** (กลุ่มหน้าที่) และ **ระดับ**
(ระดับความน่าเชื่อถือ) Agent Tier 1 มีความเป็นอิสระเต็มรูปแบบภายในกรอบการกำกับดูแล
Agent Tier 2 ต้องได้รับการอนุมัติสำหรับการดำเนินการที่ละเอียดอ่อน Agent Tier 3
อยู่ภายใต้การดูแลอย่างเต็มรูปแบบ ระบบระดับถูกบังคับใช้ตามโครงสร้าง agent
ไม่สามารถเลื่อนตำแหน่งตัวเองได้

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

## ข้อจำกัดทางสถาปัตยกรรม

SIDJUA บังคับใช้ข้อจำกัดเหล่านี้ในระดับสถาปัตยกรรม ไม่สามารถ
ปิดการใช้งาน หลีกเลี่ยง หรือถูก agent แทนที่ได้:

1. **การกำกับดูแลเป็นภายนอก**: ชั้นการกำกับดูแลห่อหุ้ม agent Agent
   ไม่มีสิทธิ์เข้าถึงโค้ดการกำกับดูแล ไม่สามารถแก้ไขกฎ และไม่สามารถ
   ตรวจจับว่ามีการกำกับดูแลอยู่หรือไม่

2. **ก่อนการกระทำ ไม่ใช่หลังการกระทำ**: ทุกการกระทำจะถูกตรวจสอบก่อนการดำเนินการ
   ไม่มีโหมด "บันทึกและตรวจสอบภายหลัง" สำหรับการดำเนินการที่สำคัญต่อการกำกับดูแล

3. **การบังคับใช้ตามโครงสร้าง**: กฎถูกบังคับใช้โดยเส้นทางโค้ด ไม่ใช่โดย
   prompt หรือคำสั่งของโมเดล Agent ไม่สามารถ "jailbreak" ออกจาก
   การกำกับดูแลเพราะการกำกับดูแลไม่ได้ถูกนำไปใช้เป็นคำสั่งให้โมเดล

4. **ความไม่เปลี่ยนแปลงของการตรวจสอบ**: Write-Ahead Log (WAL) เป็นแบบเพิ่มข้อมูลอย่างเดียวพร้อม
   การยืนยันความสมบูรณ์ รายการที่ถูกแก้ไขจะถูกตรวจพบและยกเว้น

5. **การแยกฝ่าย**: Agent ในฝ่ายต่างๆ ไม่สามารถเข้าถึงข้อมูล
   ความลับ หรือช่องทางการสื่อสารของกันและกัน

---

## การเปรียบเทียบ

| ฟีเจอร์ | SIDJUA | CrewAI | AutoGen | LangGraph | OpenClaw |
|---------|--------|--------|---------|-----------|----------|
| การกำกับดูแลภายนอก | ✅ สถาปัตยกรรม | ❌ | ❌ | ❌ | ❌ |
| การบังคับใช้ก่อนการกระทำ | ✅ ไปป์ไลน์ 5 ขั้นตอน | ❌ | ❌ | ❌ | ❌ |
| พร้อมสำหรับ EU AI Act | ✅ | ❌ | ❌ | ❌ | ❌ |
| โฮสต์เอง | ✅ | ❌ คลาวด์ | ❌ คลาวด์ | ❌ คลาวด์ | ✅ ปลั๊กอิน |
| ทำงานแบบออฟไลน์ได้ | ✅ | ❌ | ❌ | ❌ | ❌ |
| ไม่ขึ้นกับโมเดล | ✅ LLM ใดก็ได้ | บางส่วน | บางส่วน | บางส่วน | ✅ |
| อีเมลสองทิศทาง | ✅ | ❌ | ❌ | ❌ | ❌ |
| Discord Gateway | ✅ | ❌ | ❌ | ❌ | ❌ |
| Agent แบบลำดับชั้น | ✅ ฝ่าย + ระดับ | พื้นฐาน | พื้นฐาน | กราฟ | ❌ |
| การบังคับใช้งบประมาณ | ✅ ขีดจำกัดต่อ agent | ❌ | ❌ | ❌ | ❌ |
| การแยก sandbox | ✅ bubblewrap | ❌ | ❌ | ❌ | ❌ |
| ความไม่เปลี่ยนแปลงของการตรวจสอบ | ✅ WAL + ความสมบูรณ์ | ❌ | ❌ | ❌ | ❌ |
| ใบอนุญาต | AGPL-3.0 | MIT | MIT | MIT | ผสม |
| การตรวจสอบอิสระ | ✅ 2 ภายนอก | ❌ | ❌ | ❌ | ❌ |

---

## ฟีเจอร์

### การกำกับดูแลและการปฏิบัติตาม

**ไปป์ไลน์ก่อนการกระทำ (ขั้นตอนที่ 0)** ทำงานก่อนทุกการกระทำของ agent: การตรวจสอบสิ่งต้องห้าม
→ การอนุมัติจากมนุษย์ → การบังคับใช้งบประมาณ → การจำแนกข้อมูล → นโยบาย
ที่กำหนดเอง ทั้งห้าขั้นตอนเป็นโครงสร้าง ดำเนินการในโค้ด ไม่ใช่ใน
prompt ของ agent

**กฎพื้นฐานบังคับ** มาพร้อมกับการติดตั้งทุกครั้ง: กฎการกำกับดูแล 10 ข้อ
(`SYS-SEC-001` ถึง `SYS-GOV-002`) ที่ไม่สามารถลบออกหรือลดความเข้มข้นลงโดย
การกำหนดค่าของผู้ใช้ กฎที่กำหนดเองขยายพื้นฐาน ไม่สามารถแทนที่ได้

**การปฏิบัติตาม EU AI Act** — เส้นทางการตรวจสอบ กรอบการจำแนก และกระแสงาน
การอนุมัติแมปโดยตรงกับข้อกำหนดของมาตรา 9, 12 และ 17 กำหนดเวลา
การปฏิบัติตามในเดือนสิงหาคม 2026 ถูกสร้างขึ้นในแผนงานผลิตภัณฑ์

**การรายงานการปฏิบัติตาม** ผ่าน `sidjua audit report/violations/agents/export`:
คะแนนการปฏิบัติตาม คะแนนความน่าเชื่อถือต่อ agent ประวัติการละเมิด การส่งออก CSV/JSON
สำหรับผู้ตรวจสอบภายนอกหรือการผสานรวม SIEM

**Write-Ahead Log (WAL)** พร้อมการยืนยันความสมบูรณ์: ทุกการตัดสินใจด้านการกำกับดูแล
จะถูกเขียนไปยังบันทึกที่เพิ่มข้อมูลอย่างเดียวก่อนการดำเนินการ รายการที่ถูกแก้ไข
จะถูกตรวจพบเมื่ออ่าน `sidjua memory recover` ตรวจสอบและซ่อมแซมใหม่

### การสื่อสาร

Agent ไม่ได้แค่ตอบสนองต่อการเรียก API พวกมันมีส่วนร่วมในช่องทางการสื่อสารจริง

**อีเมลสองทิศทาง** (`sidjua email status/test/threads`): agent รับ
อีเมลผ่านการสำรวจ IMAP และตอบกลับผ่าน SMTP การแมปเธรดผ่านส่วนหัว
In-Reply-To ทำให้การสนทนาต่อเนื่อง การอนุญาตผู้ส่ง ขีดจำกัดขนาดเนื้อหา
และการลบ HTML ปกป้องไปป์ไลน์ agent จากอินพุตที่เป็นอันตราย

**Discord Gateway Bot**: อินเทอร์เฟซคำสั่ง slash เต็มรูปแบบผ่าน `sidjua module install
discord` Agent ตอบสนองต่อข้อความ Discord รักษาเธรดการสนทนา
และส่งการแจ้งเตือนเชิงรุก

**การผสานรวม Telegram**: การแจ้งเตือน agent ผ่านบอท Telegram
รูปแบบ adapter หลายช่องทางรองรับ Telegram, Discord, ntfy และอีเมล
พร้อมกัน

### การดำเนินงาน

**คำสั่ง Docker เดียว** สู่การผลิต:

```bash
docker run -p 4200:4200 sidjua/sidjua:latest
```

API key ถูกสร้างโดยอัตโนมัติในการเริ่มต้นครั้งแรกและพิมพ์ไปยังบันทึกของ container
ไม่จำเป็นต้องมีตัวแปรสภาพแวดล้อม ไม่จำเป็นต้องมีการกำหนดค่า ไม่จำเป็นต้องมี
เซิร์ฟเวอร์ฐานข้อมูล SIDJUA ใช้ SQLite ไฟล์ฐานข้อมูลหนึ่งไฟล์ต่อ agent

**การจัดการ CLI** — วงจรชีวิตที่สมบูรณ์จากไบนารีเดียว:

```bash
sidjua init                      # การตั้งค่าพื้นที่ทำงานแบบโต้ตอบ (3 ขั้นตอน)
sidjua apply                     # จัดเตรียมจาก divisions.yaml
sidjua agent create/list/stop    # วงจรชีวิต agent
sidjua run "task..." --wait      # ส่งงานพร้อมการบังคับใช้การกำกับดูแล
sidjua audit report              # รายงานการปฏิบัติตาม
sidjua costs                     # การแบ่งต้นทุนตามฝ่าย/agent
sidjua backup create/restore     # การจัดการสำรองข้อมูลที่ลงนาม HMAC
sidjua update                    # การอัปเดตเวอร์ชันพร้อมการสำรองข้อมูลอัตโนมัติก่อนหน้า
sidjua rollback                  # คืนค่าเป็นเวอร์ชันก่อนหน้าด้วย 1 คลิก
sidjua email status/test         # การจัดการช่องทางอีเมล
sidjua secret set/get/rotate     # การจัดการความลับที่เข้ารหัส
sidjua memory import/search      # ไปป์ไลน์ความรู้เชิงความหมาย
sidjua selftest                  # การตรวจสอบสุขภาพระบบ (7 หมวดหมู่ คะแนน 0-100)
```

**หน่วยความจำเชิงความหมาย** — นำเข้าการสนทนาและเอกสาร (`sidjua memory import
~/exports/claude-chats.zip`) ค้นหาด้วยการจัดอันดับแบบไฮบริด vector + BM25 รองรับ
การฝัง Cloudflare Workers AI (ฟรี ไม่ต้องตั้งค่า) และการฝังขนาดใหญ่ของ OpenAI
(คุณภาพสูงกว่าสำหรับฐานความรู้ขนาดใหญ่)

**การแบ่งส่วนแบบปรับตัว** — ไปป์ไลน์หน่วยความจำปรับขนาดส่วนโดยอัตโนมัติเพื่อให้อยู่ภายใน
ขีดจำกัด token ของโมเดลฝังแต่ละตัว

**คู่มือไม่ต้องตั้งค่า** — `sidjua chat guide` เปิดตัวผู้ช่วย AI แบบโต้ตอบ
โดยไม่ต้องใช้ API key ขับเคลื่อนโดย Cloudflare Workers AI ผ่าน SIDJUA proxy
ถามว่าจะตั้งค่า agent ได้อย่างไร กำหนดค่าการกำกับดูแล หรือเข้าใจว่าเกิดอะไรขึ้น
ในบันทึกการตรวจสอบ

**การปรับใช้แบบออฟไลน์** — ทำงานได้โดยสมบูรณ์โดยไม่เชื่อมต่ออินเทอร์เน็ตโดยใช้ LLM
ในพื้นที่ผ่าน Ollama หรือ endpoint ที่เข้ากันได้กับ OpenAI ใดๆ ไม่มีการรวบรวมข้อมูลโดยค่าเริ่มต้น
การรายงานข้อผิดพลาดแบบเลือกได้พร้อมการแก้ไข PII อย่างสมบูรณ์

### ความปลอดภัย

**การแยก sandbox** — ทักษะ agent ทำงานภายใน OS-level process isolation ผ่าน
bubblewrap (Linux user namespaces) ไม่มีค่าใช้จ่าย RAM เพิ่มเติม อินเทอร์เฟซ
`SandboxProvider` แบบเสียบได้: `none` สำหรับการพัฒนา `bubblewrap` สำหรับการผลิต

**การจัดการความลับ** — ที่เก็บความลับที่เข้ารหัสพร้อม RBAC (`sidjua secret
set/get/list/delete/rotate/namespaces`) ไม่จำเป็นต้องใช้ vault ภายนอก

**การสร้างที่เน้นความปลอดภัยเป็นอันดับแรก** — ชุดการทดสอบภายในที่ครอบคลุมบวกการตรวจสอบ
อิสระโดยผู้ตรวจสอบโค้ดภายนอก 2 ราย (DeepSeek V3 และ xAI Grok) ส่วนหัวความปลอดภัย
การป้องกัน CSRF การจำกัดอัตรา และการทำความสะอาดอินพุตบนทุกพื้นผิว API
การป้องกันการฉีด SQL ด้วยการสอบถามแบบ parameterized ตลอดทั้งระบบ

**ความสมบูรณ์ของการสำรองข้อมูล** — ไฟล์เก็บถาวรสำรองที่ลงนาม HMAC พร้อมการป้องกัน zip-slip
การป้องกัน zip bomb และการยืนยัน checksum ของ manifest เมื่อคืนค่า

---

## การนำเข้าจากกรอบงานอื่น

```bash
# ดูตัวอย่างสิ่งที่จะถูกนำเข้า ไม่มีการเปลี่ยนแปลง
sidjua import openclaw --dry-run

# นำเข้า config + ไฟล์ทักษะ
sidjua import openclaw --skills
```

Agent ที่มีอยู่ของคุณรักษาตัวตน โมเดล และทักษะของตน SIDJUA เพิ่ม
การกำกับดูแล เส้นทางการตรวจสอบ และการควบคุมงบประมาณโดยอัตโนมัติ

---

## เอกสารอ้างอิงการกำหนดค่า

`divisions.yaml` ขั้นต่ำเพื่อเริ่มต้น:

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

`sidjua apply` จัดเตรียมโครงสร้างพื้นฐานที่สมบูรณ์จากไฟล์นี้ เรียกใช้อีกครั้ง
หลังจากทำการเปลี่ยนแปลง มันเป็น idempotent

ดู [docs/SIDJUA-APPLY-TECH-SPEC-V1.md](docs/SIDJUA-APPLY-TECH-SPEC-V1.md)
สำหรับข้อกำหนดเต็มรูปแบบของขั้นตอนการจัดเตรียมทั้ง 10 ขั้นตอน

---

## REST API

SIDJUA REST API ทำงานบนพอร์ตเดียวกับ dashboard:

```bash
sidjua server start --port 4200 --api-key $SIDJUA_API_KEY
```

Endpoint หลัก:

```
GET  /api/v1/health          # การตรวจสอบสุขภาพสาธารณะ (ไม่ต้องยืนยันตัวตน)
GET  /api/v1/info            # ข้อมูลเมตาของระบบ (ยืนยันตัวตนแล้ว)
POST /api/v1/execute/run     # ส่งงาน
GET  /api/v1/execute/:id/status  # สถานะงาน
GET  /api/v1/execute/:id/result  # ผลลัพธ์งาน
GET  /api/v1/events          # สตรีมเหตุการณ์ SSE
GET  /api/v1/audit/report    # รายงานการปฏิบัติตาม
```

Endpoint ทั้งหมดยกเว้น `/health` ต้องการการยืนยันตัวตน Bearer สร้าง key:

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

หรือใช้ `docker-compose.yml` ที่รวมมาซึ่งเพิ่ม named volume สำหรับการกำหนดค่า
บันทึก และพื้นที่ทำงาน agent บวกบริการ Qdrant ที่เป็นตัวเลือกสำหรับการค้นหาเชิงความหมาย:

```bash
docker compose up -d
docker compose exec sidjua sidjua init
docker compose exec sidjua sidjua apply
```

---

## ผู้ให้บริการ

SIDJUA เชื่อมต่อกับผู้ให้บริการ LLM ใดก็ได้โดยไม่ต้องผูกมัด:

| ผู้ให้บริการ | โมเดล | API Key |
|------------|-------|---------|
| Anthropic | Claude Sonnet 4.6, Haiku 4.5, Opus 4.6 | `ANTHROPIC_API_KEY` |
| Google | Gemini 2.0, Gemini 1.5 Pro | `GOOGLE_API_KEY` |
| Groq | Llama 3.x, Mixtral | `GROQ_API_KEY` (ระดับฟรี) |
| Cloudflare Workers AI | Llama, Mistral, Phi | `CF_ACCOUNT_ID` + `CF_TOKEN` |
| Ollama | โมเดลในพื้นที่ใดก็ได้ | ไม่ต้องใช้ key (ในพื้นที่) |
| เข้ากันได้กับ OpenAI | endpoint ใดก็ได้ | URL ที่กำหนดเอง + key |

```bash
# เพิ่ม key ผู้ให้บริการ
sidjua key set groq gsk_...

# แสดงรายการผู้ให้บริการและโมเดลที่พร้อมใช้งาน
sidjua provider list
```

---

## แผนงาน

แผนงานฉบับสมบูรณ์ที่ [sidjua.com/roadmap](https://sidjua.com/roadmap)

ระยะสั้น:
- รูปแบบการประสาน multi-agent (V1.1)
- ทริกเกอร์ขาเข้า webhook (V1.1)
- การสื่อสาร agent ต่อ agent (V1.2)
- การผสานรวม Enterprise SSO (V1.x)
- บริการตรวจสอบการกำกับดูแลที่โฮสต์บนคลาวด์ (V1.x)

---

## ชุมชน

- **Discord**: [sidjua.com/discord](https://sidjua.com/discord)
- **GitHub Issues**: [github.com/sidjua-dev/sidjua/issues](https://github.com/sidjua-dev/sidjua/issues)
- **อีเมล**: contact@sidjua.com
- **เอกสาร**: [sidjua.com/docs](https://sidjua.com/docs)

หากคุณพบข้อบกพร่อง โปรดเปิด issue เราดำเนินการรวดเร็ว

---

## การแปล

SIDJUA มีให้บริการใน 26 ภาษา ภาษาอังกฤษและภาษาเยอรมันได้รับการดูแลโดยทีมหลัก การแปลอื่นๆ ทั้งหมดสร้างโดย AI และดูแลโดยชุมชน

**เอกสาร:** README นี้และ[คู่มือการติดตั้ง](docs/INSTALLATION.md) มีให้บริการใน 26 ภาษา ดูตัวเลือกภาษาที่ด้านบนของหน้านี้

| ภูมิภาค | ภาษา |
|--------|------|
| อเมริกา | อังกฤษ สเปน โปรตุเกส (บราซิล) |
| ยุโรป | เยอรมัน ฝรั่งเศส อิตาลี ดัตช์ โปแลนด์ เช็ก โรมาเนีย รัสเซีย ยูเครน สวีเดน ตุรกี |
| ตะวันออกกลาง | อาหรับ |
| เอเชีย | ฮินดี เบงกาลี ฟิลิปปินส์ อินโดนีเซีย มาเลย์ ไทย เวียดนาม ญี่ปุ่น เกาหลี จีน (ตัวย่อ) จีน (ตัวเต็ม) |

พบข้อผิดพลาดในการแปล? โปรดเปิด GitHub Issue ด้วย:
- ภาษาและรหัส locale (เช่น `fil`)
- ข้อความที่ไม่ถูกต้องหรือ key จากไฟล์ locale (เช่น `gui.nav.dashboard`)
- การแปลที่ถูกต้อง

ต้องการดูแลภาษา? ดู [CONTRIBUTING.md](CONTRIBUTING.md#translations) เราใช้โมเดลผู้ดูแลต่อภาษา

---

## ใบอนุญาต

**AGPL-3.0** — คุณสามารถใช้ แก้ไข และเผยแพร่ SIDJUA ได้อย่างอิสระตราบใดที่
คุณแบ่งปันการแก้ไขภายใต้ใบอนุญาตเดียวกัน ซอร์สโค้ดพร้อมใช้งานเสมอ
สำหรับผู้ใช้การปรับใช้แบบโฮสต์

ใบอนุญาต Enterprise มีให้สำหรับองค์กรที่ต้องการการปรับใช้แบบกรรมสิทธิ์
โดยไม่มีภาระผูกพัน AGPL
[contact@sidjua.com](mailto:contact@sidjua.com)
