> এই নথিটি [ইংরেজি মূল](../INSTALLATION.md) থেকে AI দ্বারা অনুবাদিত হয়েছে। কোনো ত্রুটি খুঁজে পেয়েছেন? [রিপোর্ট করুন](https://github.com/GoetzKohlberg/sidjua/issues)।

# SIDJUA ইনস্টলেশন গাইড

SIDJUA সংস্করণ: 1.0.0 | লাইসেন্স: AGPL-3.0-only | আপডেট করা হয়েছে: 2026-03-25

## বিষয়বস্তু

1. [প্ল্যাটফর্ম সমর্থন ম্যাট্রিক্স](#1-প্ল্যাটফর্ম-সমর্থন-ম্যাট্রিক্স)
2. [পূর্বশর্তসমূহ](#2-পূর্বশর্তসমূহ)
3. [ইনস্টলেশন পদ্ধতি](#3-ইনস্টলেশন-পদ্ধতি)
4. [ডিরেক্টরি বিন্যাস](#4-ডিরেক্টরি-বিন্যাস)
5. [পরিবেশ ভেরিয়েবল](#5-পরিবেশ-ভেরিয়েবল)
6. [প্রোভাইডার কনফিগারেশন](#6-প্রোভাইডার-কনফিগারেশন)
7. [ডেস্কটপ GUI (ঐচ্ছিক)](#7-ডেস্কটপ-gui-ঐচ্ছিক)
8. [এজেন্ট স্যান্ডবক্সিং](#8-এজেন্ট-স্যান্ডবক্সিং)
9. [সেমান্টিক সার্চ (ঐচ্ছিক)](#9-সেমান্টিক-সার্চ-ঐচ্ছিক)
10. [সমস্যা সমাধান](#10-সমস্যা-সমাধান)
11. [Docker ভলিউম রেফারেন্স](#11-docker-ভলিউম-রেফারেন্স)
12. [আপগ্রেড করা](#12-আপগ্রেড-করা)
13. [পরবর্তী পদক্ষেপ](#13-পরবর্তী-পদক্ষেপ)

---

## 1. প্ল্যাটফর্ম সমর্থন ম্যাট্রিক্স

| বৈশিষ্ট্য | Linux | macOS | Windows WSL2 | Windows (নেটিভ) |
|---------|-------|-------|--------------|------------------|
| CLI + REST API | ✅ সম্পূর্ণ | ✅ সম্পূর্ণ | ✅ সম্পূর্ণ | ✅ সম্পূর্ণ |
| Docker | ✅ সম্পূর্ণ | ✅ Docker Desktop | ✅ Docker Desktop | ✅ Docker Desktop |
| স্যান্ডবক্সিং (bubblewrap) | ✅ সম্পূর্ণ | ❌ `none`-এ ফলব্যাক | ✅ সম্পূর্ণ (WSL2-এর ভেতরে) | ❌ `none`-এ ফলব্যাক |
| Web Management Console | ✅ Full | ✅ Full | ✅ Full | ✅ Full |
| সেমান্টিক সার্চ (Qdrant) | ✅ | ✅ | ✅ | ✅ |

**bubblewrap সম্পর্কে নোট:** Linux ইউজার-নেমস্পেস স্যান্ডবক্সিং। macOS এবং Windows নেটিভ স্বয়ংক্রিয়ভাবে স্যান্ডবক্স মোড `none`-এ ফলব্যাক করে — কোনো কনফিগারেশনের প্রয়োজন নেই।

---

## 2. পূর্বশর্তসমূহ

### Node.js >= 22.0.0

**কেন:** SIDJUA ES মডিউল, নেটিভ `fetch()`, এবং `crypto.subtle` ব্যবহার করে — এই সবগুলোর জন্য Node.js 22+ প্রয়োজন।

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

**macOS (.pkg ইনস্টলার):** [nodejs.org/en/download](https://nodejs.org/en/download) থেকে ডাউনলোড করুন।

**Windows (winget):**
```powershell
winget install OpenJS.NodeJS.LTS
```

**Windows (.msi):** [nodejs.org/en/download](https://nodejs.org/en/download) থেকে ডাউনলোড করুন।

**WSL2:** আপনার WSL2 টার্মিনালের ভেতরে Ubuntu/Debian নির্দেশাবলী অনুসরণ করুন।

যাচাই করুন:
```bash
node --version   # অবশ্যই >= 22.0.0 হতে হবে
npm --version    # অবশ্যই >= 10.0.0 হতে হবে
```

---

### C/C++ টুলচেইন (শুধুমাত্র সোর্স বিল্ডের জন্য)

**কেন:** `better-sqlite3` এবং `argon2` `npm ci`-এর সময় নেটিভ Node.js অ্যাডন কম্পাইল করে। Docker ব্যবহারকারীরা এটি এড়িয়ে যেতে পারেন।

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

**Windows:** **Desktop development with C++** ওয়ার্কলোড সহ [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) ইনস্টল করুন, তারপর:
```powershell
npm install --global windows-build-tools
```

**Alpine Linux:**
```bash
apk add python3 make g++ build-base linux-headers
```

---

### Docker >= 24 (ঐচ্ছিক)

শুধুমাত্র Docker ইনস্টলেশন পদ্ধতির জন্য প্রয়োজন। Docker Compose V2 প্লাগইন (`docker compose`) উপলব্ধ থাকতে হবে।

**Linux:** [docs.docker.com/engine/install](https://docs.docker.com/engine/install/)-এ নির্দেশাবলী অনুসরণ করুন।
Docker Compose V2 Docker Engine >= 24-এর সাথে অন্তর্ভুক্ত।

**macOS / Windows:** [Docker Desktop](https://www.docker.com/products/docker-desktop/) ইনস্টল করুন (Docker Compose V2 অন্তর্ভুক্ত)।

যাচাই করুন:
```bash
docker --version          # অবশ্যই >= 24.0.0 হতে হবে
docker compose version    # অবশ্যই v2.x.x দেখাতে হবে
```

---

### Git

যেকোনো সাম্প্রতিক সংস্করণ। আপনার OS প্যাকেজ ম্যানেজার বা [git-scm.com](https://git-scm.com) থেকে ইনস্টল করুন।

---

## 3. ইনস্টলেশন পদ্ধতি

### পদ্ধতি A — Docker (প্রস্তাবিত)

একটি কার্যকর SIDJUA ইনস্টলেশনের দ্রুততম পথ। সমস্ত নির্ভরতা ইমেজে বান্ডেল করা আছে।

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
docker compose up -d
```

সার্ভিসগুলো সুস্থ হওয়ার জন্য অপেক্ষা করুন (প্রথম বিল্ডে ~60 সেকেন্ড পর্যন্ত):

```bash
docker compose ps
# NAME              STATUS
# sidjua            Up X seconds (healthy)
# sidjua-qdrant     Up X seconds (healthy)
```

স্বয়ংক্রিয়-তৈরি API কী পুনরুদ্ধার করুন:

```bash
docker compose exec sidjua cat /app/.system/api-key
```

আপনার `divisions.yaml` থেকে গভর্ন্যান্স বুটস্ট্র্যাপ করুন:

```bash
docker compose exec sidjua sidjua apply --verbose
```

সিস্টেম স্বাস্থ্য পরীক্ষা চালান:

```bash
docker compose exec sidjua sidjua selftest
```

**ARM64 নোট:** Docker ইমেজটি `node:22-alpine`-এ তৈরি যা `linux/amd64` এবং `linux/arm64` সমর্থন করে। Raspberry Pi (64-বিট) এবং Apple Silicon Mac (Docker Desktop-এর মাধ্যমে) বাক্সের বাইরে সমর্থিত।

**Docker-এ bubblewrap:** কন্টেইনারের ভেতরে এজেন্ট স্যান্ডবক্সিং সক্ষম করতে, আপনার Docker রান কমান্ডে `--cap-add=SYS_ADMIN` যোগ করুন অথবা `docker-compose.yml`-এ সেট করুন:
```yaml
cap_add:
  - SYS_ADMIN
```

---

### পদ্ধতি B — npm গ্লোবাল ইনস্টল

```bash
npm install -g sidjua
```

ইন্টারেক্টিভ সেটআপ উইজার্ড চালান (৩টি ধাপ: ওয়ার্কস্পেস অবস্থান, প্রোভাইডার, প্রথম এজেন্ট):
```bash
sidjua init
```

নন-ইন্টারেক্টিভ CI বা কন্টেইনার পরিবেশের জন্য:
```bash
sidjua init --yes
```

জিরো-কনফিগ AI গাইড শুরু করুন (কোনো API কী প্রয়োজন নেই):
```bash
sidjua chat guide
```

---

### পদ্ধতি C — সোর্স বিল্ড

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
npm ci
npm run build
```

বিল্ড প্রক্রিয়াটি `tsup` ব্যবহার করে `src/index.ts` কম্পাইল করে:
- `dist/index.js` (ESM)
- `dist/index.cjs` (CommonJS)

পোস্ট-বিল্ড ধাপগুলো i18n লোকেল ফাইল, ডিফল্ট ভূমিকা, বিভাগ এবং জ্ঞানভাণ্ডার টেমপ্লেট `dist/`-এ কপি করে।

সোর্স থেকে চালান:
```bash
node dist/index.js --help
```

টেস্ট স্যুট চালান:
```bash
npm test                    # সমস্ত পরীক্ষা
npm run test:coverage       # কভারেজ রিপোর্ট সহ
npx tsc --noEmit            # শুধুমাত্র টাইপ চেক
```

---

## 4. ডিরেক্টরি বিন্যাস

### Docker ডেপ্লয়মেন্ট পাথ

| পাথ | Docker ভলিউম | উদ্দেশ্য | পরিচালিত |
|------|---------------|---------|------------|
| `/app/dist/` | ইমেজ লেয়ার | কম্পাইল করা অ্যাপ্লিকেশন | SIDJUA |
| `/app/node_modules/` | ইমেজ লেয়ার | Node.js নির্ভরতা | SIDJUA |
| `/app/system/` | ইমেজ লেয়ার | বিল্ট-ইন ডিফল্ট এবং টেমপ্লেট | SIDJUA |
| `/app/defaults/` | ইমেজ লেয়ার | ডিফল্ট কনফিগ ফাইল | SIDJUA |
| `/app/docs/` | ইমেজ লেয়ার | বান্ডেল করা ডকুমেন্টেশন | SIDJUA |
| `/app/data/` | `sidjua-data` | SQLite ডেটাবেস, ব্যাকআপ, জ্ঞান সংগ্রহ | ব্যবহারকারী |
| `/app/config/` | `sidjua-config` | `divisions.yaml` এবং কাস্টম কনফিগ | ব্যবহারকারী |
| `/app/logs/` | `sidjua-logs` | স্ট্রাকচার্ড লগ ফাইল | ব্যবহারকারী |
| `/app/.system/` | `sidjua-system` | API কী, আপডেট স্টেট, প্রসেস লক | SIDJUA পরিচালিত |
| `/app/agents/` | `sidjua-workspace` | এজেন্ট সংজ্ঞা, দক্ষতা, টেমপ্লেট | ব্যবহারকারী |
| `/app/governance/` | `sidjua-governance` | অডিট ট্রেইল, গভর্ন্যান্স স্ন্যাপশট | ব্যবহারকারী |

---

### ম্যানুয়াল / npm ইনস্টল পাথ

`sidjua init`-এর পরে, আপনার ওয়ার্কস্পেস এভাবে সংগঠিত:

```
~/sidjua-workspace/           # অথবা SIDJUA_CONFIG_DIR
├── divisions.yaml            # আপনার গভর্ন্যান্স কনফিগারেশন
├── .sidjua/                  # অভ্যন্তরীণ স্টেট (WAL, টেলিমেট্রি বাফার)
│   └── telemetry.db
├── data/
│   ├── sidjua.db             # মূল ডেটাবেস (এজেন্ট, টাস্ক, অডিট, খরচ)
│   ├── knowledge/            # প্রতি-এজেন্ট জ্ঞান ডেটাবেস
│   │   └── <agent-id>.db
│   └── backups/              # HMAC-স্বাক্ষরিত ব্যাকআপ আর্কাইভ
├── agents/                   # এজেন্ট দক্ষতা ডিরেক্টরি
├── governance/               # অডিট ট্রেইল (শুধুমাত্র সংযোজনযোগ্য)
├── logs/                     # অ্যাপ্লিকেশন লগ
└── system/                   # রানটাইম স্টেট
```

---

### SQLite ডেটাবেস

| ডেটাবেস | পাথ | বিষয়বস্তু |
|----------|------|----------|
| মূল | `data/sidjua.db` | এজেন্ট, টাস্ক, খরচ, গভর্ন্যান্স স্ন্যাপশট, API কী, অডিট লগ |
| টেলিমেট্রি | `.sidjua/telemetry.db` | ঐচ্ছিক অপ্ট-ইন ত্রুটি রিপোর্ট (PII-রিডেক্টেড) |
| জ্ঞান | `data/knowledge/<agent-id>.db` | প্রতি-এজেন্ট ভেক্টর এম্বেডিং এবং BM25 ইন্ডেক্স |

SQLite ডেটাবেস একক-ফাইল, ক্রস-প্ল্যাটফর্ম এবং পোর্টেবল। `sidjua backup create` দিয়ে ব্যাকআপ নিন।

---

## 5. পরিবেশ ভেরিয়েবল

`.env.example` কপি করে `.env` হিসেবে সংরক্ষণ করুন এবং কাস্টমাইজ করুন। উল্লেখ না থাকলে সমস্ত ভেরিয়েবল ঐচ্ছিক।

### সার্ভার

| ভেরিয়েবল | ডিফল্ট | বিবরণ |
|----------|---------|-------------|
| `SIDJUA_PORT` | `3000` | REST API লিসেন পোর্ট |
| `SIDJUA_HOST` | `127.0.0.1` | REST API বাইন্ড ঠিকানা। রিমোট অ্যাক্সেসের জন্য `0.0.0.0` ব্যবহার করুন |
| `NODE_ENV` | `production` | রানটাইম মোড (`production` অথবা `development`) |
| `SIDJUA_API_KEY` | স্বয়ংক্রিয়-তৈরি | REST API বেয়ারার টোকেন। অনুপস্থিত থাকলে প্রথম স্টার্টে স্বয়ংক্রিয়ভাবে তৈরি হয় |
| `SIDJUA_MAX_BODY_SIZE` | `2097152` (2 MiB) | বাইটে সর্বোচ্চ ইনবাউন্ড রিকোয়েস্ট বডি সাইজ |

### ডিরেক্টরি ওভাররাইড

| ভেরিয়েবল | ডিফল্ট | বিবরণ |
|----------|---------|-------------|
| `SIDJUA_DATA_DIR` | `<workspace>/data` | ডেটা ডিরেক্টরি অবস্থান ওভাররাইড করুন |
| `SIDJUA_CONFIG_DIR` | `<workspace>` | কনফিগ ডিরেক্টরি অবস্থান ওভাররাইড করুন |
| `SIDJUA_LOG_DIR` | `<workspace>/logs` | লগ ডিরেক্টরি অবস্থান ওভাররাইড করুন |

### সেমান্টিক সার্চ

| ভেরিয়েবল | ডিফল্ট | বিবরণ |
|----------|---------|-------------|
| `SIDJUA_QDRANT_URL` | `http://localhost:6333` | Qdrant ভেক্টর ডেটাবেস এন্ডপয়েন্ট। Docker ডিফল্ট: `http://qdrant:6333` |
| `OPENAI_API_KEY` | — | OpenAI `text-embedding-3-large` এম্বেডিংয়ের জন্য প্রয়োজন |
| `SIDJUA_CF_ACCOUNT_ID` | — | বিনামূল্যে এম্বেডিংয়ের জন্য Cloudflare অ্যাকাউন্ট ID |
| `SIDJUA_CF_TOKEN` | — | বিনামূল্যে এম্বেডিংয়ের জন্য Cloudflare API টোকেন |

### LLM প্রোভাইডার

| ভেরিয়েবল | প্রোভাইডার |
|----------|----------|
| `ANTHROPIC_API_KEY` | Anthropic (Claude) |
| `OPENAI_API_KEY` | OpenAI (GPT-4, এম্বেডিং) |
| `GOOGLE_AI_API_KEY` | Google AI (Gemini) |
| `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` | Cloudflare Workers AI (বিনামূল্যে স্তর) |
| `GROQ_API_KEY` | Groq (দ্রুত ইনফারেন্স, বিনামূল্যে স্তর উপলব্ধ) |
| `DEEPSEEK_API_KEY` | DeepSeek |

---

## 6. প্রোভাইডার কনফিগারেশন

### জিরো-কনফিগ বিকল্প

`sidjua chat guide` কোনো API কী ছাড়াই কাজ করে। এটি SIDJUA প্রক্সির মাধ্যমে Cloudflare Workers AI-এর সাথে সংযুক্ত হয়। রেট-সীমিত কিন্তু মূল্যায়ন এবং অনবোর্ডিংয়ের জন্য উপযুক্ত।

### আপনার প্রথম প্রোভাইডার যোগ করুন

**Groq (বিনামূল্যে স্তর, ক্রেডিট কার্ড প্রয়োজন নেই):**
```bash
sidjua key set groq <your-groq-api-key>
sidjua provider list
```
[console.groq.com](https://console.groq.com)-এ বিনামূল্যে কী পান।

**Anthropic (প্রোডাকশনের জন্য প্রস্তাবিত):**
```bash
export ANTHROPIC_API_KEY=sk-ant-...
sidjua key set anthropic $ANTHROPIC_API_KEY
```

**Ollama (এয়ার-গ্যাপ / লোকাল ডেপ্লয়মেন্ট):**
```bash
sidjua provider add-custom \
  --id ollama \
  --name "Ollama (local)" \
  --base-url http://localhost:11434/v1 \
  --model llama3.2
```

সমস্ত কনফিগার করা প্রোভাইডার যাচাই করুন:
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

## 8. এজেন্ট স্যান্ডবক্সিং

SIDJUA একটি প্লাগযোগ্য `SandboxProvider` ইন্টারফেস ব্যবহার করে। স্যান্ডবক্স OS-স্তরের প্রসেস আইসোলেশনে এজেন্ট দক্ষতা এক্সিকিউশন মোড়ক করে।

### প্ল্যাটফর্ম অনুসারে স্যান্ডবক্স সমর্থন

| প্ল্যাটফর্ম | স্যান্ডবক্স প্রোভাইডার | নোট |
|----------|-----------------|-------|
| Linux (নেটিভ) | `bubblewrap` | সম্পূর্ণ ইউজার-নেমস্পেস আইসোলেশন |
| Docker (Linux কন্টেইনার) | `bubblewrap` | `--cap-add=SYS_ADMIN` প্রয়োজন |
| macOS | `none` (স্বয়ংক্রিয় ফলব্যাক) | macOS Linux ইউজার নেমস্পেস সমর্থন করে না |
| Windows WSL2 | `bubblewrap` | WSL2-এর ভেতরে Linux-এর মতো ইনস্টল করুন |
| Windows (নেটিভ) | `none` (স্বয়ংক্রিয় ফলব্যাক) | |

### bubblewrap ইনস্টল করা (Linux)

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

### কনফিগারেশন

`divisions.yaml`-এ:
```yaml
governance:
  sandbox: bubblewrap    # অথবা: none
```

স্যান্ডবক্স উপলব্ধতা যাচাই করুন:
```bash
sidjua sandbox check
```

---

## 9. সেমান্টিক সার্চ (ঐচ্ছিক)

সেমান্টিক সার্চ `sidjua memory search` এবং এজেন্ট জ্ঞান পুনরুদ্ধারকে শক্তি দেয়। এটির জন্য একটি Qdrant ভেক্টর ডেটাবেস এবং একটি এম্বেডিং প্রোভাইডার প্রয়োজন।

### Docker Compose প্রোফাইল

অন্তর্ভুক্ত `docker-compose.yml`-এ একটি `semantic-search` প্রোফাইল রয়েছে:
```bash
docker compose --profile semantic-search up -d
```
এটি SIDJUA-এর পাশাপাশি একটি Qdrant কন্টেইনার শুরু করে।

### স্বতন্ত্র Qdrant

```bash
docker run -d \
  --name sidjua-qdrant \
  -p 6333:6333 \
  -v qdrant-storage:/qdrant/storage \
  qdrant/qdrant:v1.13.2
```

এন্ডপয়েন্ট সেট করুন:
```bash
export SIDJUA_QDRANT_URL=http://localhost:6333
```

### Qdrant ছাড়া

Qdrant উপলব্ধ না থাকলে, `sidjua memory import` এবং `sidjua memory search` নিষ্ক্রিয় থাকে। অন্য সমস্ত SIDJUA বৈশিষ্ট্য (CLI, REST API, এজেন্ট এক্সিকিউশন, গভর্ন্যান্স, অডিট) স্বাভাবিকভাবে কাজ করে। যেকোনো জ্ঞান কোয়েরির জন্য সিস্টেম BM25 কীওয়ার্ড সার্চে ফলব্যাক করে।

---

## 10. সমস্যা সমাধান

### সমস্ত প্ল্যাটফর্ম

**`npm ci` `node-pre-gyp` বা `node-gyp` ত্রুটি সহ ব্যর্থ হয়:**
```
gyp ERR! build error
```
C/C++ টুলচেইন ইনস্টল করুন (পূর্বশর্ত বিভাগ দেখুন)। Ubuntu-তে: `sudo apt-get install -y python3 make g++ build-essential`।

**`Cannot find divisions.yaml`:**
`SIDJUA_CONFIG_DIR` চেক করুন। ফাইলটি অবশ্যই `$SIDJUA_CONFIG_DIR/divisions.yaml`-এ থাকতে হবে। ওয়ার্কস্পেস স্ট্রাকচার তৈরি করতে `sidjua init` চালান।

**REST API 401 Unauthorized ফেরত দেয়:**
`Authorization: Bearer <key>` হেডার যাচাই করুন। স্বয়ংক্রিয়-তৈরি কী পুনরুদ্ধার করুন:
```bash
cat ~/.sidjua/.system/api-key          # ম্যানুয়াল ইনস্টল
docker compose exec sidjua cat /app/.system/api-key  # Docker
```

**পোর্ট 3000 ইতিমধ্যে ব্যবহৃত:**
```bash
SIDJUA_PORT=3001 sidjua server start
# অথবা .env-এ সেট করুন: SIDJUA_PORT=3001
```

---

### Ubuntu / Debian

**`better-sqlite3` `futex.h` পাওয়া যায় না সহ কম্পাইল করতে ব্যর্থ হয়:**
```bash
sudo apt-get install -y linux-headers-$(uname -r)
```

---

### Fedora / RHEL

**SELinux Docker ভলিউম মাউন্ট ব্লক করে:**
```yaml
# SELinux কনটেক্সটের জন্য :Z লেবেল যোগ করুন
volumes:
  - ./my-config:/app/config:Z
```
অথবা SELinux কনটেক্সট ম্যানুয়ালি সেট করুন:
```bash
chcon -Rt svirt_sandbox_file_t ./my-config
```

---

### Arch Linux

**Node.js সংস্করণ অনেক পুরনো:**
Node.js 22 ইনস্টল করতে `nvm` ব্যবহার করুন:
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

**Docker Desktop মেমোরি শেষ হয়ে যায়:**
Docker Desktop → Settings → Resources → Memory খুলুন। কমপক্ষে 4 GB-এ বাড়ান।

**Apple Silicon — আর্কিটেকচার অমিল:**
আপনার Node.js ইনস্টলেশন নেটিভ ARM64 কিনা যাচাই করুন (Rosetta নয়):
```bash
node -e "console.log(process.arch)"
# প্রত্যাশিত: arm64
```
যদি `x64` প্রিন্ট করে, nodejs.org থেকে ARM64 ইনস্টলার ব্যবহার করে Node.js পুনরায় ইনস্টল করুন।

---

### Windows (নেটিভ)

**`MSBuild` বা `cl.exe` পাওয়া যায় না:**
[Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) ইনস্টল করুন এবং **Desktop development with C++** ওয়ার্কলোড নির্বাচন করুন। তারপর চালান:
```powershell
npm install --global windows-build-tools
```

**দীর্ঘ পাথ ত্রুটি (`ENAMETOOLONG`):**
Windows রেজিস্ট্রিতে দীর্ঘ পাথ সমর্থন সক্ষম করুন:
```powershell
# অ্যাডমিনিস্ট্রেটর হিসেবে চালান
Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" `
  -Name LongPathsEnabled -Value 1
```

**`npm install -g`-এর পরে `sidjua` কমান্ড পাওয়া যায় না:**
আপনার PATH-এ npm গ্লোবাল বিন ডিরেক্টরি যোগ করুন:
```powershell
npm config get prefix  # যেমন C:\Users\you\AppData\Roaming\npm দেখায়
# সেই পাথটি System Environment Variables → Path-এ যোগ করুন
```

---

### Windows WSL2

**WSL2-এর ভেতরে Docker শুরু হতে ব্যর্থ হয়:**
Docker Desktop → Settings → General → **Use the WSL 2 based engine** সক্ষম করুন।
তারপর Docker Desktop এবং আপনার WSL2 টার্মিনাল পুনরায় শুরু করুন।

**`/mnt/c/`-এর অধীনে ফাইলে অনুমতি ত্রুটি:**
WSL2-এ মাউন্ট করা Windows NTFS ভলিউমে সীমাবদ্ধ অনুমতি রয়েছে। আপনার ওয়ার্কস্পেস একটি Linux-নেটিভ পাথে সরান:
```bash
mkdir ~/sidjua-workspace
cd ~/sidjua-workspace
sidjua init
```

---

### Raspberry Pi / ARM64

**`npm ci` অনেক ধীর (5-10 মিনিট):**
এটি স্বাভাবিক। ARM64-এ নেটিভ অ্যাডন কম্পাইলেশন বেশি সময় নেয়। পরিবর্তে Docker ইমেজ ব্যবহার বিবেচনা করুন:
```bash
docker pull sidjua/sidjua:latest-arm64
```

**বিল্ডের সময় মেমোরি শেষ:**
সোয়াপ স্পেস যোগ করুন:
```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

---

## 11. Docker ভলিউম রেফারেন্স

### নামকৃত ভলিউম

| ভলিউমের নাম | কন্টেইনার পাথ | উদ্দেশ্য |
|-------------|---------------|---------|
| `sidjua-data` | `/app/data` | SQLite ডেটাবেস, ব্যাকআপ আর্কাইভ, জ্ঞান সংগ্রহ |
| `sidjua-config` | `/app/config` | `divisions.yaml`, কাস্টম কনফিগারেশন |
| `sidjua-logs` | `/app/logs` | স্ট্রাকচার্ড অ্যাপ্লিকেশন লগ |
| `sidjua-system` | `/app/.system` | API কী, আপডেট স্টেট, প্রসেস লক ফাইল |
| `sidjua-workspace` | `/app/agents` | এজেন্ট দক্ষতা ডিরেক্টরি, সংজ্ঞা, টেমপ্লেট |
| `sidjua-governance` | `/app/governance` | অপরিবর্তনীয় অডিট ট্রেইল, গভর্ন্যান্স স্ন্যাপশট |
| `qdrant-storage` | `/qdrant/storage` | Qdrant ভেক্টর ইন্ডেক্স (শুধুমাত্র সেমান্টিক সার্চ প্রোফাইল) |

### হোস্ট ডিরেক্টরি ব্যবহার করা

কন্টেইনারের ভেতরে সম্পাদনা করার পরিবর্তে আপনার নিজের `divisions.yaml` মাউন্ট করতে:

```yaml
# docker-compose.override.yml
services:
  sidjua:
    volumes:
      - ./my-config:/app/config   # sidjua-config নামকৃত ভলিউম প্রতিস্থাপন করে
```

### ব্যাকআপ

```bash
sidjua backup create                    # কন্টেইনারের ভেতর থেকে
# অথবা
docker compose exec sidjua sidjua backup create
```

ব্যাকআপগুলো `/app/data/backups/`-এ সংরক্ষিত HMAC-স্বাক্ষরিত আর্কাইভ।

---

## 12. আপগ্রেড করা

### Docker

```bash
git pull
docker compose build --no-cache
docker compose up -d
docker compose exec sidjua sidjua apply    # স্কিমা মাইগ্রেশন চালান
```

`sidjua apply` আইডেমপোটেন্ট — আপগ্রেডের পরে পুনরায় চালানো সবসময় নিরাপদ।

### npm গ্লোবাল ইনস্টল

```bash
npm update -g sidjua
sidjua apply    # স্কিমা মাইগ্রেশন চালান
```

### সোর্স বিল্ড

```bash
git pull
npm ci
npm run build
node dist/index.js apply    # স্কিমা মাইগ্রেশন চালান
```

### রোলব্যাক

SIDJUA প্রতিটি `sidjua apply`-এর আগে একটি গভর্ন্যান্স স্ন্যাপশট তৈরি করে। পূর্বাবস্থায় ফেরাতে:

```bash
sidjua rollback list
sidjua rollback <version>
```

---

## 13. পরবর্তী পদক্ষেপ

| রিসোর্স | কমান্ড / লিঙ্ক |
|----------|---------------|
| দ্রুত শুরু | [docs/QUICK-START.md](QUICK-START.md) |
| CLI রেফারেন্স | [docs/CLI-REFERENCE.md](CLI-REFERENCE.md) |
| গভর্ন্যান্স উদাহরণ | [docs/GOVERNANCE-EXAMPLES.md](GOVERNANCE-EXAMPLES.md) |
| বিনামূল্যে LLM প্রোভাইডার গাইড | [docs/FREE-LLM-PROVIDER-GUIDE.md](FREE-LLM-PROVIDER-GUIDE.md) |
| সমস্যা সমাধান | [docs/TROUBLESHOOTING.md](TROUBLESHOOTING.md) |

ইনস্টলেশনের পরে প্রথম কমান্ডগুলো চালান:

```bash
sidjua chat guide    # জিরো-কনফিগ AI গাইড — কোনো API কী প্রয়োজন নেই
sidjua selftest      # সিস্টেম স্বাস্থ্য পরীক্ষা (৭টি বিভাগ, 0-100 স্কোর)
sidjua apply         # divisions.yaml থেকে এজেন্ট প্রভিশন করুন
```
