> تمت ترجمة هذا المستند بالذكاء الاصطناعي من [النسخة الإنجليزية الأصلية](../INSTALLATION.md). وجدت خطأ؟ [أبلغ عنه](https://github.com/GoetzKohlberg/sidjua/issues).

# دليل تثبيت SIDJUA

إصدار SIDJUA: 1.0.0 | الترخيص: AGPL-3.0-only | تاريخ التحديث: 2026-03-25

## جدول المحتويات

1. [مصفوفة دعم المنصات](#1-مصفوفة-دعم-المنصات)
2. [المتطلبات الأساسية](#2-المتطلبات-الأساسية)
3. [طرق التثبيت](#3-طرق-التثبيت)
4. [هيكل الدليل](#4-هيكل-الدليل)
5. [متغيرات البيئة](#5-متغيرات-البيئة)
6. [تكوين المزود](#6-تكوين-المزود)
7. [واجهة المستخدم الرسومية لسطح المكتب (اختياري)](#7-واجهة-المستخدم-الرسومية-لسطح-المكتب-اختياري)
8. [صندوق رمل العامل](#8-صندوق-رمل-العامل)
9. [البحث الدلالي (اختياري)](#9-البحث-الدلالي-اختياري)
10. [استكشاف الأخطاء وإصلاحها](#10-استكشاف-الأخطاء-وإصلاحها)
11. [مرجع وحدات تخزين Docker](#11-مرجع-وحدات-تخزين-docker)
12. [الترقية](#12-الترقية)
13. [الخطوات التالية](#13-الخطوات-التالية)

---

## 1. مصفوفة دعم المنصات

| الميزة | Linux | macOS | Windows WSL2 | Windows (أصلي) |
|--------|-------|-------|--------------|----------------|
| CLI + REST API | ✅ كامل | ✅ كامل | ✅ كامل | ✅ كامل |
| Docker | ✅ كامل | ✅ Docker Desktop | ✅ Docker Desktop | ✅ Docker Desktop |
| صندوق الرمل (bubblewrap) | ✅ كامل | ❌ يعود إلى `none` | ✅ كامل (داخل WSL2) | ❌ يعود إلى `none` |
| Web Management Console | ✅ Full | ✅ Full | ✅ Full | ✅ Full |
| البحث الدلالي (Qdrant) | ✅ | ✅ | ✅ | ✅ |

**ملاحظة حول bubblewrap:** عزل مساحة اسم مستخدم Linux. يعود نظام macOS وWindows الأصلي تلقائياً إلى وضع صندوق الرمل `none` — لا يلزم أي تكوين.

---

## 2. المتطلبات الأساسية

### Node.js >= 22.0.0

**السبب:** يستخدم SIDJUA وحدات ES والدالة الأصلية `fetch()` و`crypto.subtle` — وهذه جميعها تتطلب Node.js 22 أو أحدث.

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

**macOS (مثبّت .pkg):** قم بالتنزيل من [nodejs.org/en/download](https://nodejs.org/en/download).

**Windows (winget):**
```powershell
winget install OpenJS.NodeJS.LTS
```

**Windows (.msi):** قم بالتنزيل من [nodejs.org/en/download](https://nodejs.org/en/download).

**WSL2:** استخدم تعليمات Ubuntu/Debian أعلاه داخل طرفية WSL2 الخاصة بك.

التحقق:
```bash
node --version   # يجب أن يكون >= 22.0.0
npm --version    # يجب أن يكون >= 10.0.0
```

---

### سلسلة أدوات C/C++ (لبنيات المصدر فقط)

**السبب:** تُجمّع `better-sqlite3` و`argon2` إضافات Node.js الأصلية أثناء تشغيل `npm ci`. يمكن لمستخدمي Docker تخطي هذا.

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

**Windows:** قم بتثبيت [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) مع حِزمة عمل **تطوير سطح المكتب باستخدام C++**، ثم:
```powershell
npm install --global windows-build-tools
```

**Alpine Linux:**
```bash
apk add python3 make g++ build-base linux-headers
```

---

### Docker >= 24 (اختياري)

مطلوب فقط لطريقة تثبيت Docker. يجب أن يكون إضافي Docker Compose V2 (`docker compose`) متاحاً.

**Linux:** اتبع التعليمات على [docs.docker.com/engine/install](https://docs.docker.com/engine/install/).
يتضمن Docker Compose V2 مع Docker Engine >= 24.

**macOS / Windows:** قم بتثبيت [Docker Desktop](https://www.docker.com/products/docker-desktop/) (يتضمن Docker Compose V2).

التحقق:
```bash
docker --version          # يجب أن يكون >= 24.0.0
docker compose version    # يجب أن يُظهر v2.x.x
```

---

### Git

أي إصدار حديث. قم بالتثبيت عبر مدير حزم نظام التشغيل الخاص بك أو من [git-scm.com](https://git-scm.com).

---

## 3. طرق التثبيت

### الطريقة أ — Docker (موصى بها)

أسرع طريقة للحصول على تثبيت SIDJUA يعمل. جميع التبعيات مجمّعة في الصورة.

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
docker compose up -d
```

انتظر حتى تصبح الخدمات سليمة (ما يصل إلى ~60 ثانية عند البناء الأول):

```bash
docker compose ps
# NAME              STATUS
# sidjua            Up X seconds (healthy)
# sidjua-qdrant     Up X seconds (healthy)
```

استرداد مفتاح API المُولَّد تلقائياً:

```bash
docker compose exec sidjua cat /app/.system/api-key
```

تمهيد الحوكمة من `divisions.yaml` الخاص بك:

```bash
docker compose exec sidjua sidjua apply --verbose
```

تشغيل فحص سلامة النظام:

```bash
docker compose exec sidjua sidjua selftest
```

**ملاحظة ARM64:** صورة Docker مبنية على `node:22-alpine` التي تدعم `linux/amd64` و`linux/arm64`. يدعم Raspberry Pi (64 بت) وأجهزة Mac ذات شريحة Apple Silicon (عبر Docker Desktop) خارج الصندوق.

**Bubblewrap في Docker:** لتمكين صندوق رمل العامل داخل الحاوية، أضف `--cap-add=SYS_ADMIN` إلى أمر تشغيل Docker الخاص بك أو اضبطه في `docker-compose.yml`:
```yaml
cap_add:
  - SYS_ADMIN
```

---

### الطريقة ب — تثبيت npm العالمي

```bash
npm install -g sidjua
```

تشغيل معالج الإعداد التفاعلي (3 خطوات: موقع مساحة العمل، المزود، العامل الأول):
```bash
sidjua init
```

لبيئات CI أو الحاويات غير التفاعلية:
```bash
sidjua init --yes
```

تشغيل دليل الذكاء الاصطناعي بدون تكوين (لا يلزم مفتاح API):
```bash
sidjua chat guide
```

---

### الطريقة ج — بناء المصدر

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
npm ci
npm run build
```

تستخدم عملية البناء `tsup` لتجميع `src/index.ts` إلى:
- `dist/index.js` (ESM)
- `dist/index.cjs` (CommonJS)

تنسخ خطوات ما بعد البناء ملفات اللغة i18n وأدوار الأدوار الافتراضية والأقسام وقوالب قاعدة المعرفة إلى `dist/`.

التشغيل من المصدر:
```bash
node dist/index.js --help
```

تشغيل مجموعة الاختبار:
```bash
npm test                    # جميع الاختبارات
npm run test:coverage       # مع تقرير التغطية
npx tsc --noEmit            # فحص النوع فقط
```

---

## 4. هيكل الدليل

### مسارات نشر Docker

| المسار | وحدة تخزين Docker | الغرض | المُدار من |
|--------|-----------------|-------|-----------|
| `/app/dist/` | طبقة الصورة | التطبيق المُجمَّع | SIDJUA |
| `/app/node_modules/` | طبقة الصورة | تبعيات Node.js | SIDJUA |
| `/app/system/` | طبقة الصورة | الإعدادات الافتراضية المدمجة والقوالب | SIDJUA |
| `/app/defaults/` | طبقة الصورة | ملفات التكوين الافتراضية | SIDJUA |
| `/app/docs/` | طبقة الصورة | الوثائق المجمّعة | SIDJUA |
| `/app/data/` | `sidjua-data` | قواعد بيانات SQLite والنسخ الاحتياطية ومجموعات المعرفة | المستخدم |
| `/app/config/` | `sidjua-config` | `divisions.yaml` والتكوين المخصص | المستخدم |
| `/app/logs/` | `sidjua-logs` | ملفات السجل المنظمة | المستخدم |
| `/app/.system/` | `sidjua-system` | مفتاح API وحالة التحديث وقفل العملية | SIDJUA مُدار |
| `/app/agents/` | `sidjua-workspace` | تعريفات العامل والمهارات والقوالب | المستخدم |
| `/app/governance/` | `sidjua-governance` | مسار التدقيق ولقطات الحوكمة | المستخدم |

---

### مسارات التثبيت اليدوي / npm

بعد `sidjua init`، تكون مساحة العمل الخاصة بك منظمة كما يلي:

```
~/sidjua-workspace/           # أو SIDJUA_CONFIG_DIR
├── divisions.yaml            # تكوين الحوكمة الخاص بك
├── .sidjua/                  # الحالة الداخلية (WAL، مخزن مؤقت للقياس عن بُعد)
│   └── telemetry.db
├── data/
│   ├── sidjua.db             # قاعدة البيانات الرئيسية (العملاء، المهام، التدقيق، التكاليف)
│   ├── knowledge/            # قواعد بيانات المعرفة لكل عامل
│   │   └── <agent-id>.db
│   └── backups/              # أرشيفات النسخ الاحتياطي الموقعة بـ HMAC
├── agents/                   # دلائل مهارات العامل
├── governance/               # مسار التدقيق (للإلحاق فقط)
├── logs/                     # سجلات التطبيق
└── system/                   # حالة وقت التشغيل
```

---

### قواعد بيانات SQLite

| قاعدة البيانات | المسار | المحتويات |
|--------------|-------|----------|
| الرئيسية | `data/sidjua.db` | العملاء والمهام والتكاليف ولقطات الحوكمة ومفاتيح API وسجل التدقيق |
| القياس عن بُعد | `.sidjua/telemetry.db` | تقارير خطأ اختيارية (تمت إزالة PII) |
| المعرفة | `data/knowledge/<agent-id>.db` | تضمينات المتجهات وفهرس BM25 لكل عامل |

قواعد بيانات SQLite ذات ملف واحد وعبر المنصات وقابلة للنقل. قم بنسخها احتياطياً بـ `sidjua backup create`.

---

## 5. متغيرات البيئة

انسخ `.env.example` إلى `.env` وقم بالتخصيص. جميع المتغيرات اختيارية ما لم يُذكر خلاف ذلك.

### الخادم

| المتغير | الافتراضي | الوصف |
|---------|---------|-------|
| `SIDJUA_PORT` | `3000` | منفذ استماع REST API |
| `SIDJUA_HOST` | `127.0.0.1` | عنوان ربط REST API. استخدم `0.0.0.0` للوصول عن بُعد |
| `NODE_ENV` | `production` | وضع وقت التشغيل (`production` أو `development`) |
| `SIDJUA_API_KEY` | مُولَّد تلقائياً | رمز حامل REST API. يُنشأ تلقائياً عند البدء الأول إذا لم يكن موجوداً |
| `SIDJUA_MAX_BODY_SIZE` | `2097152` (2 MiB) | الحد الأقصى لحجم نص الطلب الوارد بالبايت |

### تجاوزات الدليل

| المتغير | الافتراضي | الوصف |
|---------|---------|-------|
| `SIDJUA_DATA_DIR` | `<workspace>/data` | تجاوز موقع دليل البيانات |
| `SIDJUA_CONFIG_DIR` | `<workspace>` | تجاوز موقع دليل التكوين |
| `SIDJUA_LOG_DIR` | `<workspace>/logs` | تجاوز موقع دليل السجل |

### البحث الدلالي

| المتغير | الافتراضي | الوصف |
|---------|---------|-------|
| `SIDJUA_QDRANT_URL` | `http://localhost:6333` | نقطة نهاية قاعدة بيانات متجه Qdrant. الافتراضي في Docker: `http://qdrant:6333` |
| `OPENAI_API_KEY` | — | مطلوب لتضمينات OpenAI `text-embedding-3-large` |
| `SIDJUA_CF_ACCOUNT_ID` | — | معرف حساب Cloudflare للتضمينات المجانية |
| `SIDJUA_CF_TOKEN` | — | رمز Cloudflare API للتضمينات المجانية |

### مزودو LLM

| المتغير | المزود |
|---------|-------|
| `ANTHROPIC_API_KEY` | Anthropic (Claude) |
| `OPENAI_API_KEY` | OpenAI (GPT-4، التضمينات) |
| `GOOGLE_AI_API_KEY` | Google AI (Gemini) |
| `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` | Cloudflare Workers AI (الطبقة المجانية) |
| `GROQ_API_KEY` | Groq (استنتاج سريع، طبقة مجانية متاحة) |
| `DEEPSEEK_API_KEY` | DeepSeek |

---

## 6. تكوين المزود

### خيار التكوين الصفري

`sidjua chat guide` يعمل بدون أي مفتاح API. يتصل بـ Cloudflare Workers AI من خلال وكيل SIDJUA. محدود بمعدل الطلبات لكنه مناسب للتقييم والإعداد.

### إضافة مزودك الأول

**Groq (طبقة مجانية، لا يلزم بطاقة ائتمان):**
```bash
sidjua key set groq <your-groq-api-key>
sidjua provider list
```
احصل على مفتاح مجاني على [console.groq.com](https://console.groq.com).

**Anthropic (موصى به للإنتاج):**
```bash
export ANTHROPIC_API_KEY=sk-ant-...
sidjua key set anthropic $ANTHROPIC_API_KEY
```

**Ollama (نشر هوائي / محلي):**
```bash
sidjua provider add-custom \
  --id ollama \
  --name "Ollama (local)" \
  --base-url http://localhost:11434/v1 \
  --model llama3.2
```

التحقق من جميع المزودين المكونين:
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

## 8. صندوق رمل العامل

يستخدم SIDJUA واجهة `SandboxProvider` القابلة للتوصيل. يلف صندوق الرمل تنفيذ مهارة العامل في عزل العملية على مستوى نظام التشغيل.

### دعم صندوق الرمل حسب المنصة

| المنصة | مزود صندوق الرمل | ملاحظات |
|--------|----------------|---------|
| Linux (أصلي) | `bubblewrap` | عزل كامل لمساحة اسم المستخدم |
| Docker (حاوية Linux) | `bubblewrap` | يتطلب `--cap-add=SYS_ADMIN` |
| macOS | `none` (احتياطي تلقائي) | لا يدعم macOS مساحات اسم مستخدم Linux |
| Windows WSL2 | `bubblewrap` | قم بالتثبيت كما هو الحال في Linux داخل WSL2 |
| Windows (أصلي) | `none` (احتياطي تلقائي) | |

### تثبيت bubblewrap (Linux)

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

### التكوين

في `divisions.yaml`:
```yaml
governance:
  sandbox: bubblewrap    # أو: none
```

التحقق من توافر صندوق الرمل:
```bash
sidjua sandbox check
```

---

## 9. البحث الدلالي (اختياري)

يشغّل البحث الدلالي `sidjua memory search` واسترداد معرفة العامل. يتطلب قاعدة بيانات متجه Qdrant ومزود تضمين.

### ملف تعريف Docker Compose

يحتوي `docker-compose.yml` المضمّن على ملف تعريف `semantic-search`:
```bash
docker compose --profile semantic-search up -d
```
يبدأ هذا حاوية Qdrant جنباً إلى جنب مع SIDJUA.

### Qdrant المستقل

```bash
docker run -d \
  --name sidjua-qdrant \
  -p 6333:6333 \
  -v qdrant-storage:/qdrant/storage \
  qdrant/qdrant:v1.13.2
```

تعيين نقطة النهاية:
```bash
export SIDJUA_QDRANT_URL=http://localhost:6333
```

### بدون Qdrant

إذا لم يكن Qdrant متاحاً، يتم تعطيل `sidjua memory import` و`sidjua memory search`. تعمل جميع ميزات SIDJUA الأخرى (CLI وREST API وتنفيذ العامل والحوكمة والتدقيق) بشكل طبيعي. يعود النظام إلى البحث بالكلمات الرئيسية BM25 لأي استعلامات معرفة.

---

## 10. استكشاف الأخطاء وإصلاحها

### جميع المنصات

**فشل `npm ci` بأخطاء `node-pre-gyp` أو `node-gyp`:**
```
gyp ERR! build error
```
قم بتثبيت سلسلة أدوات C/C++ (انظر قسم المتطلبات الأساسية). على Ubuntu: `sudo apt-get install -y python3 make g++ build-essential`.

**`Cannot find divisions.yaml`:**
تحقق من `SIDJUA_CONFIG_DIR`. يجب أن يكون الملف في `$SIDJUA_CONFIG_DIR/divisions.yaml`. شغّل `sidjua init` لإنشاء هيكل مساحة العمل.

**يعيد REST API 401 Unauthorized:**
تحقق من رأس `Authorization: Bearer <key>`. استرد المفتاح المُولَّد تلقائياً بـ:
```bash
cat ~/.sidjua/.system/api-key          # التثبيت اليدوي
docker compose exec sidjua cat /app/.system/api-key  # Docker
```

**المنفذ 3000 قيد الاستخدام بالفعل:**
```bash
SIDJUA_PORT=3001 sidjua server start
# أو قم بالتعيين في .env: SIDJUA_PORT=3001
```

---

### Ubuntu / Debian

**فشل `better-sqlite3` في التجميع بسبب عدم إيجاد `futex.h`:**
```bash
sudo apt-get install -y linux-headers-$(uname -r)
```

---

### Fedora / RHEL

**SELinux يمنع تحميلات وحدة تخزين Docker:**
```yaml
# أضف تسمية :Z لسياق SELinux
volumes:
  - ./my-config:/app/config:Z
```
أو قم بتعيين سياق SELinux يدوياً:
```bash
chcon -Rt svirt_sandbox_file_t ./my-config
```

---

### Arch Linux

**إصدار Node.js قديم جداً:**
استخدم `nvm` لتثبيت Node.js 22:
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

**Docker Desktop ينفد من الذاكرة:**
افتح Docker Desktop → الإعدادات → الموارد → الذاكرة. قم بالزيادة إلى 4 جيجابايت على الأقل.

**Apple Silicon — عدم تطابق البنية:**
تحقق من أن تثبيت Node.js الخاص بك أصلي ARM64 (وليس Rosetta):
```bash
node -e "console.log(process.arch)"
# المتوقع: arm64
```
إذا طبع `x64`، أعد تثبيت Node.js باستخدام مثبت ARM64 من nodejs.org.

---

### Windows (أصلي)

**`MSBuild` أو `cl.exe` غير موجود:**
قم بتثبيت [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) وحدد حِزمة عمل **تطوير سطح المكتب باستخدام C++**. ثم شغّل:
```powershell
npm install --global windows-build-tools
```

**أخطاء المسار الطويل (`ENAMETOOLONG`):**
قم بتمكين دعم المسار الطويل في سجل Windows:
```powershell
# شغّل كمسؤول
Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" `
  -Name LongPathsEnabled -Value 1
```

**أمر `sidjua` غير موجود بعد `npm install -g`:**
أضف دليل bin العالمي لـ npm إلى PATH الخاص بك:
```powershell
npm config get prefix  # يُظهر مثلاً C:\Users\you\AppData\Roaming\npm
# أضف هذا المسار إلى متغيرات بيئة النظام → Path
```

---

### Windows WSL2

**فشل بدء تشغيل Docker داخل WSL2:**
افتح Docker Desktop → الإعدادات → عام → مكّن **استخدام محرك WSL 2**.
ثم أعد تشغيل Docker Desktop وطرفية WSL2.

**أخطاء الأذونات على الملفات ضمن `/mnt/c/`:**
وحدات تخزين Windows NTFS المثبتة في WSL2 لها أذونات مقيدة. انقل مساحة العمل الخاصة بك إلى مسار Linux الأصلي:
```bash
mkdir ~/sidjua-workspace
cd ~/sidjua-workspace
sidjua init
```

---

### Raspberry Pi / ARM64

**`npm ci` بطيء جداً (5-10 دقائق):**
هذا طبيعي. يستغرق تجميع الإضافة الأصلية على ARM64 وقتاً أطول. فكّر في استخدام صورة Docker بدلاً من ذلك:
```bash
docker pull sidjua/sidjua:latest-arm64
```

**نفاد الذاكرة أثناء البناء:**
أضف مساحة مبادلة:
```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

---

## 11. مرجع وحدات تخزين Docker

### وحدات التخزين المسمّاة

| اسم وحدة التخزين | مسار الحاوية | الغرض |
|----------------|------------|-------|
| `sidjua-data` | `/app/data` | قواعد بيانات SQLite وأرشيفات النسخ الاحتياطي ومجموعات المعرفة |
| `sidjua-config` | `/app/config` | `divisions.yaml` والتكوين المخصص |
| `sidjua-logs` | `/app/logs` | سجلات التطبيق المنظمة |
| `sidjua-system` | `/app/.system` | مفتاح API وحالة التحديث وملف قفل العملية |
| `sidjua-workspace` | `/app/agents` | دلائل مهارات العامل والتعريفات والقوالب |
| `sidjua-governance` | `/app/governance` | مسار تدقيق ثابت ولقطات الحوكمة |
| `qdrant-storage` | `/qdrant/storage` | فهرس متجه Qdrant (ملف تعريف البحث الدلالي فقط) |

### استخدام دليل مضيف

لتحميل `divisions.yaml` الخاص بك بدلاً من التحرير داخل الحاوية:

```yaml
# docker-compose.override.yml
services:
  sidjua:
    volumes:
      - ./my-config:/app/config   # يستبدل وحدة تخزين sidjua-config المسمّاة
```

### النسخ الاحتياطي

```bash
sidjua backup create                    # من داخل الحاوية
# أو
docker compose exec sidjua sidjua backup create
```

النسخ الاحتياطية عبارة عن أرشيفات موقعة بـ HMAC مخزنة في `/app/data/backups/`.

---

## 12. الترقية

### Docker

```bash
git pull
docker compose build --no-cache
docker compose up -d
docker compose exec sidjua sidjua apply    # تشغيل هجرات المخطط
```

`sidjua apply` idempotent — دائماً آمن لإعادة التشغيل بعد الترقية.

### تثبيت npm العالمي

```bash
npm update -g sidjua
sidjua apply    # تشغيل هجرات المخطط
```

### بناء المصدر

```bash
git pull
npm ci
npm run build
node dist/index.js apply    # تشغيل هجرات المخطط
```

### التراجع

يُنشئ SIDJUA لقطة حوكمة قبل كل `sidjua apply`. للرجوع إلى الوراء:

```bash
sidjua rollback list
sidjua rollback <version>
```

---

## 13. الخطوات التالية

| المورد | الأمر / الرابط |
|--------|-------------|
| البداية السريعة | [docs/QUICK-START.md](QUICK-START.md) |
| مرجع CLI | [docs/CLI-REFERENCE.md](CLI-REFERENCE.md) |
| أمثلة الحوكمة | [docs/GOVERNANCE-EXAMPLES.md](GOVERNANCE-EXAMPLES.md) |
| دليل مزود LLM المجاني | [docs/FREE-LLM-PROVIDER-GUIDE.md](FREE-LLM-PROVIDER-GUIDE.md) |
| استكشاف الأخطاء وإصلاحها | [docs/TROUBLESHOOTING.md](TROUBLESHOOTING.md) |

الأوامر الأولى التي يجب تشغيلها بعد التثبيت:

```bash
sidjua chat guide    # دليل الذكاء الاصطناعي بدون تكوين — لا يلزم مفتاح API
sidjua selftest      # فحص سلامة النظام (7 فئات، نتيجة 0-100)
sidjua apply         # توفير العملاء من divisions.yaml
```
