> यह दस्तावेज़ [अंग्रेज़ी मूल](../INSTALLATION.md) से AI द्वारा अनुवादित किया गया है। कोई त्रुटि मिली? [रिपोर्ट करें](https://github.com/GoetzKohlberg/sidjua/issues)।

# SIDJUA इंस्टॉलेशन गाइड

SIDJUA संस्करण: 1.0.0 | लाइसेंस: AGPL-3.0-only | अपडेट: 2026-03-25

## विषय-सूची

1. [प्लेटफ़ॉर्म समर्थन मैट्रिक्स](#1-प्लेटफ़ॉर्म-समर्थन-मैट्रिक्स)
2. [पूर्वावश्यकताएं](#2-पूर्वावश्यकताएं)
3. [इंस्टॉलेशन विधियाँ](#3-इंस्टॉलेशन-विधियाँ)
4. [डायरेक्टरी संरचना](#4-डायरेक्टरी-संरचना)
5. [पर्यावरण चर](#5-पर्यावरण-चर)
6. [प्रदाता कॉन्फ़िगरेशन](#6-प्रदाता-कॉन्फ़िगरेशन)
7. [डेस्कटॉप GUI (वैकल्पिक)](#7-डेस्कटॉप-gui-वैकल्पिक)
8. [एजेंट सैंडबॉक्सिंग](#8-एजेंट-सैंडबॉक्सिंग)
9. [सिमेंटिक सर्च (वैकल्पिक)](#9-सिमेंटिक-सर्च-वैकल्पिक)
10. [समस्या निवारण](#10-समस्या-निवारण)
11. [Docker वॉल्यूम संदर्भ](#11-docker-वॉल्यूम-संदर्भ)
12. [अपग्रेड](#12-अपग्रेड)
13. [अगले कदम](#13-अगले-कदम)

---

## 1. प्लेटफ़ॉर्म समर्थन मैट्रिक्स

| सुविधा | Linux | macOS | Windows WSL2 | Windows (नेटिव) |
|--------|-------|-------|--------------|----------------|
| CLI + REST API | ✅ पूर्ण | ✅ पूर्ण | ✅ पूर्ण | ✅ पूर्ण |
| Docker | ✅ पूर्ण | ✅ Docker Desktop | ✅ Docker Desktop | ✅ Docker Desktop |
| सैंडबॉक्सिंग (bubblewrap) | ✅ पूर्ण | ❌ `none` पर वापस | ✅ पूर्ण (WSL2 के अंदर) | ❌ `none` पर वापस |
| Web Management Console | ✅ Full | ✅ Full | ✅ Full | ✅ Full |
| सिमेंटिक सर्च (Qdrant) | ✅ | ✅ | ✅ | ✅ |

**bubblewrap के बारे में नोट:** Linux यूजर-नेमस्पेस सैंडबॉक्सिंग। macOS और Windows नेटिव स्वचालित रूप से सैंडबॉक्स मोड `none` पर वापस आते हैं — कोई कॉन्फ़िगरेशन आवश्यक नहीं।

---

## 2. पूर्वावश्यकताएं

### Node.js >= 22.0.0

**क्यों:** SIDJUA ES मॉड्यूल, नेटिव `fetch()`, और `crypto.subtle` का उपयोग करता है — ये सभी Node.js 22+ की आवश्यकता करते हैं।

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

**macOS (.pkg इंस्टॉलर):** [nodejs.org/en/download](https://nodejs.org/en/download) से डाउनलोड करें।

**Windows (winget):**
```powershell
winget install OpenJS.NodeJS.LTS
```

**Windows (.msi):** [nodejs.org/en/download](https://nodejs.org/en/download) से डाउनलोड करें।

**WSL2:** अपने WSL2 टर्मिनल के अंदर Ubuntu/Debian निर्देशों का उपयोग करें।

सत्यापित करें:
```bash
node --version   # >= 22.0.0 होना चाहिए
npm --version    # >= 10.0.0 होना चाहिए
```

---

### C/C++ टूलचेन (केवल सोर्स बिल्ड के लिए)

**क्यों:** `better-sqlite3` और `argon2` `npm ci` के दौरान नेटिव Node.js ऐड-ऑन कंपाइल करते हैं। Docker उपयोगकर्ता इसे छोड़ सकते हैं।

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

**Windows:** **C++ के साथ डेस्कटॉप डेवलपमेंट** वर्कलोड के साथ [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) इंस्टॉल करें, फिर:
```powershell
npm install --global windows-build-tools
```

**Alpine Linux:**
```bash
apk add python3 make g++ build-base linux-headers
```

---

### Docker >= 24 (वैकल्पिक)

केवल Docker इंस्टॉलेशन विधि के लिए आवश्यक। Docker Compose V2 प्लगइन (`docker compose`) उपलब्ध होना चाहिए।

**Linux:** [docs.docker.com/engine/install](https://docs.docker.com/engine/install/) पर दिए गए निर्देशों का पालन करें।
Docker Compose V2 Docker Engine >= 24 के साथ शामिल है।

**macOS / Windows:** [Docker Desktop](https://www.docker.com/products/docker-desktop/) इंस्टॉल करें (Docker Compose V2 शामिल है)।

सत्यापित करें:
```bash
docker --version          # >= 24.0.0 होना चाहिए
docker compose version    # v2.x.x दिखाना चाहिए
```

---

### Git

कोई भी हालिया संस्करण। अपने OS पैकेज मैनेजर या [git-scm.com](https://git-scm.com) से इंस्टॉल करें।

---

## 3. इंस्टॉलेशन विधियाँ

### विधि A — Docker (अनुशंसित)

काम करने वाले SIDJUA इंस्टॉलेशन का सबसे तेज़ रास्ता। सभी निर्भरताएं इमेज में बंडल हैं।

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
docker compose up -d
```

सेवाओं के स्वस्थ होने का इंतजार करें (पहले बिल्ड पर ~60 सेकंड तक):

```bash
docker compose ps
# NAME              STATUS
# sidjua            Up X seconds (healthy)
# sidjua-qdrant     Up X seconds (healthy)
```

स्वतः-जेनरेट किया गया API की प्राप्त करें:

```bash
docker compose exec sidjua cat /app/.system/api-key
```

अपने `divisions.yaml` से गवर्नेंस बूटस्ट्रैप करें:

```bash
docker compose exec sidjua sidjua apply --verbose
```

सिस्टम स्वास्थ्य जांच चलाएं:

```bash
docker compose exec sidjua sidjua selftest
```

**ARM64 नोट:** Docker इमेज `node:22-alpine` पर बनाई गई है जो `linux/amd64` और `linux/arm64` का समर्थन करती है। Raspberry Pi (64-bit) और Apple Silicon Mac (Docker Desktop के माध्यम से) बॉक्स से बाहर समर्थित हैं।

**Docker में Bubblewrap:** कंटेनर के अंदर एजेंट सैंडबॉक्सिंग सक्षम करने के लिए, अपने Docker run कमांड में `--cap-add=SYS_ADMIN` जोड़ें या `docker-compose.yml` में सेट करें:
```yaml
cap_add:
  - SYS_ADMIN
```

---

### विधि B — npm ग्लोबल इंस्टॉल

```bash
npm install -g sidjua
```

इंटरेक्टिव सेटअप विज़ार्ड चलाएं (3 चरण: वर्कस्पेस लोकेशन, प्रदाता, पहला एजेंट):
```bash
sidjua init
```

गैर-इंटरेक्टिव CI या कंटेनर वातावरण के लिए:
```bash
sidjua init --yes
```

ज़ीरो-कॉन्फ़िग AI गाइड शुरू करें (कोई API की आवश्यक नहीं):
```bash
sidjua chat guide
```

---

### विधि C — सोर्स बिल्ड

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
npm ci
npm run build
```

बिल्ड प्रक्रिया `tsup` का उपयोग करके `src/index.ts` को निम्न में कंपाइल करती है:
- `dist/index.js` (ESM)
- `dist/index.cjs` (CommonJS)

पोस्ट-बिल्ड चरण i18n लोकेल फ़ाइलें, डिफ़ॉल्ट रोल, डिवीज़न और नॉलेज बेस टेम्पलेट `dist/` में कॉपी करते हैं।

सोर्स से चलाएं:
```bash
node dist/index.js --help
```

टेस्ट सूट चलाएं:
```bash
npm test                    # सभी टेस्ट
npm run test:coverage       # कवरेज रिपोर्ट के साथ
npx tsc --noEmit            # केवल टाइप चेक
```

---

## 4. डायरेक्टरी संरचना

### Docker डिप्लॉयमेंट पथ

| पथ | Docker वॉल्यूम | उद्देश्य | प्रबंधित |
|----|-------------|---------|---------|
| `/app/dist/` | इमेज लेयर | कंपाइल किया गया एप्लिकेशन | SIDJUA |
| `/app/node_modules/` | इमेज लेयर | Node.js निर्भरताएं | SIDJUA |
| `/app/system/` | इमेज लेयर | अंतर्निहित डिफ़ॉल्ट और टेम्पलेट | SIDJUA |
| `/app/defaults/` | इमेज लेयर | डिफ़ॉल्ट कॉन्फ़िग फ़ाइलें | SIDJUA |
| `/app/docs/` | इमेज लेयर | बंडल किया गया दस्तावेज़ीकरण | SIDJUA |
| `/app/data/` | `sidjua-data` | SQLite डेटाबेस, बैकअप, नॉलेज कलेक्शन | उपयोगकर्ता |
| `/app/config/` | `sidjua-config` | `divisions.yaml` और कस्टम कॉन्फ़िग | उपयोगकर्ता |
| `/app/logs/` | `sidjua-logs` | संरचित लॉग फ़ाइलें | उपयोगकर्ता |
| `/app/.system/` | `sidjua-system` | API की, अपडेट स्थिति, प्रोसेस लॉक | SIDJUA प्रबंधित |
| `/app/agents/` | `sidjua-workspace` | एजेंट परिभाषाएं, स्किल, टेम्पलेट | उपयोगकर्ता |
| `/app/governance/` | `sidjua-governance` | ऑडिट ट्रेल, गवर्नेंस स्नैपशॉट | उपयोगकर्ता |

---

### मैनुअल / npm इंस्टॉल पथ

`sidjua init` के बाद, आपका वर्कस्पेस इस प्रकार व्यवस्थित होता है:

```
~/sidjua-workspace/           # या SIDJUA_CONFIG_DIR
├── divisions.yaml            # आपका गवर्नेंस कॉन्फ़िगरेशन
├── .sidjua/                  # आंतरिक स्थिति (WAL, टेलीमेट्री बफर)
│   └── telemetry.db
├── data/
│   ├── sidjua.db             # मुख्य डेटाबेस (एजेंट, टास्क, ऑडिट, लागत)
│   ├── knowledge/            # प्रति-एजेंट नॉलेज डेटाबेस
│   │   └── <agent-id>.db
│   └── backups/              # HMAC-हस्ताक्षरित बैकअप आर्काइव
├── agents/                   # एजेंट स्किल डायरेक्टरी
├── governance/               # ऑडिट ट्रेल (केवल अपेंड)
├── logs/                     # एप्लिकेशन लॉग
└── system/                   # रनटाइम स्थिति
```

---

### SQLite डेटाबेस

| डेटाबेस | पथ | सामग्री |
|---------|-----|---------|
| मुख्य | `data/sidjua.db` | एजेंट, टास्क, लागत, गवर्नेंस स्नैपशॉट, API की, ऑडिट लॉग |
| टेलीमेट्री | `.sidjua/telemetry.db` | वैकल्पिक ऑप्ट-इन त्रुटि रिपोर्ट (PII-रिडैक्टेड) |
| नॉलेज | `data/knowledge/<agent-id>.db` | प्रति-एजेंट वेक्टर एम्बेडिंग और BM25 इंडेक्स |

SQLite डेटाबेस सिंगल-फ़ाइल, क्रॉस-प्लेटफ़ॉर्म और पोर्टेबल हैं। `sidjua backup create` से बैकअप करें।

---

## 5. पर्यावरण चर

`.env.example` को `.env` में कॉपी करें और कस्टमाइज़ करें। जब तक उल्लेख न हो, सभी चर वैकल्पिक हैं।

### सर्वर

| चर | डिफ़ॉल्ट | विवरण |
|----|---------|-------|
| `SIDJUA_PORT` | `3000` | REST API लिसन पोर्ट |
| `SIDJUA_HOST` | `127.0.0.1` | REST API बाइंड एड्रेस। रिमोट एक्सेस के लिए `0.0.0.0` उपयोग करें |
| `NODE_ENV` | `production` | रनटाइम मोड (`production` या `development`) |
| `SIDJUA_API_KEY` | स्वतः-जेनरेटेड | REST API बियरर टोकन। पहली शुरुआत पर अनुपस्थित होने पर स्वतः बनाया जाता है |
| `SIDJUA_MAX_BODY_SIZE` | `2097152` (2 MiB) | बाइट्स में अधिकतम इनबाउंड रिक्वेस्ट बॉडी साइज़ |

### डायरेक्टरी ओवरराइड

| चर | डिफ़ॉल्ट | विवरण |
|----|---------|-------|
| `SIDJUA_DATA_DIR` | `<workspace>/data` | डेटा डायरेक्टरी स्थान ओवरराइड करें |
| `SIDJUA_CONFIG_DIR` | `<workspace>` | कॉन्फ़िग डायरेक्टरी स्थान ओवरराइड करें |
| `SIDJUA_LOG_DIR` | `<workspace>/logs` | लॉग डायरेक्टरी स्थान ओवरराइड करें |

### सिमेंटिक सर्च

| चर | डिफ़ॉल्ट | विवरण |
|----|---------|-------|
| `SIDJUA_QDRANT_URL` | `http://localhost:6333` | Qdrant वेक्टर डेटाबेस एंडपॉइंट। Docker डिफ़ॉल्ट: `http://qdrant:6333` |
| `OPENAI_API_KEY` | — | OpenAI `text-embedding-3-large` एम्बेडिंग के लिए आवश्यक |
| `SIDJUA_CF_ACCOUNT_ID` | — | मुफ्त एम्बेडिंग के लिए Cloudflare अकाउंट ID |
| `SIDJUA_CF_TOKEN` | — | मुफ्त एम्बेडिंग के लिए Cloudflare API टोकन |

### LLM प्रदाता

| चर | प्रदाता |
|----|---------|
| `ANTHROPIC_API_KEY` | Anthropic (Claude) |
| `OPENAI_API_KEY` | OpenAI (GPT-4, एम्बेडिंग) |
| `GOOGLE_AI_API_KEY` | Google AI (Gemini) |
| `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` | Cloudflare Workers AI (मुफ्त टियर) |
| `GROQ_API_KEY` | Groq (तेज़ इनफेरेंस, मुफ्त टियर उपलब्ध) |
| `DEEPSEEK_API_KEY` | DeepSeek |

---

## 6. प्रदाता कॉन्फ़िगरेशन

### ज़ीरो-कॉन्फ़िग विकल्प

`sidjua chat guide` किसी भी API की के बिना काम करता है। यह SIDJUA प्रॉक्सी के माध्यम से Cloudflare Workers AI से जुड़ता है। रेट-लिमिटेड लेकिन मूल्यांकन और ऑनबोर्डिंग के लिए उपयुक्त।

### अपना पहला प्रदाता जोड़ना

**Groq (मुफ्त टियर, क्रेडिट कार्ड आवश्यक नहीं):**
```bash
sidjua key set groq <your-groq-api-key>
sidjua provider list
```
[console.groq.com](https://console.groq.com) पर मुफ्त की प्राप्त करें।

**Anthropic (प्रोडक्शन के लिए अनुशंसित):**
```bash
export ANTHROPIC_API_KEY=sk-ant-...
sidjua key set anthropic $ANTHROPIC_API_KEY
```

**Ollama (एयर-गैप / लोकल डिप्लॉयमेंट):**
```bash
sidjua provider add-custom \
  --id ollama \
  --name "Ollama (local)" \
  --base-url http://localhost:11434/v1 \
  --model llama3.2
```

सभी कॉन्फ़िगर किए गए प्रदाताओं को सत्यापित करें:
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

## 8. एजेंट सैंडबॉक्सिंग

SIDJUA एक प्लगेबल `SandboxProvider` इंटरफ़ेस का उपयोग करता है। सैंडबॉक्स OS-स्तरीय प्रोसेस आइसोलेशन में एजेंट स्किल निष्पादन को लपेटता है।

### प्लेटफ़ॉर्म के अनुसार सैंडबॉक्स समर्थन

| प्लेटफ़ॉर्म | सैंडबॉक्स प्रदाता | नोट्स |
|------------|---------------|-------|
| Linux (नेटिव) | `bubblewrap` | पूर्ण यूजर-नेमस्पेस आइसोलेशन |
| Docker (Linux कंटेनर) | `bubblewrap` | `--cap-add=SYS_ADMIN` आवश्यक |
| macOS | `none` (स्वचालित फ़ॉलबैक) | macOS Linux यूजर नेमस्पेस का समर्थन नहीं करता |
| Windows WSL2 | `bubblewrap` | WSL2 के अंदर Linux की तरह इंस्टॉल करें |
| Windows (नेटिव) | `none` (स्वचालित फ़ॉलबैक) | |

### bubblewrap इंस्टॉल करना (Linux)

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

### कॉन्फ़िगरेशन

`divisions.yaml` में:
```yaml
governance:
  sandbox: bubblewrap    # या: none
```

सैंडबॉक्स उपलब्धता सत्यापित करें:
```bash
sidjua sandbox check
```

---

## 9. सिमेंटिक सर्च (वैकल्पिक)

सिमेंटिक सर्च `sidjua memory search` और एजेंट नॉलेज रिट्रीवल को शक्ति देता है। इसे Qdrant वेक्टर डेटाबेस और एम्बेडिंग प्रदाता की आवश्यकता होती है।

### Docker Compose प्रोफ़ाइल

शामिल `docker-compose.yml` में एक `semantic-search` प्रोफ़ाइल है:
```bash
docker compose --profile semantic-search up -d
```
यह SIDJUA के साथ एक Qdrant कंटेनर शुरू करता है।

### स्टैंडअलोन Qdrant

```bash
docker run -d \
  --name sidjua-qdrant \
  -p 6333:6333 \
  -v qdrant-storage:/qdrant/storage \
  qdrant/qdrant:v1.13.2
```

एंडपॉइंट सेट करें:
```bash
export SIDJUA_QDRANT_URL=http://localhost:6333
```

### Qdrant के बिना

यदि Qdrant उपलब्ध नहीं है, तो `sidjua memory import` और `sidjua memory search` अक्षम हैं। अन्य सभी SIDJUA सुविधाएं (CLI, REST API, एजेंट निष्पादन, गवर्नेंस, ऑडिट) सामान्य रूप से काम करती हैं। सिस्टम किसी भी नॉलेज क्वेरी के लिए BM25 कीवर्ड सर्च पर वापस आता है।

---

## 10. समस्या निवारण

### सभी प्लेटफ़ॉर्म

**`npm ci` `node-pre-gyp` या `node-gyp` त्रुटियों के साथ विफल होता है:**
```
gyp ERR! build error
```
C/C++ टूलचेन इंस्टॉल करें (पूर्वावश्यकता अनुभाग देखें)। Ubuntu पर: `sudo apt-get install -y python3 make g++ build-essential`।

**`Cannot find divisions.yaml`:**
`SIDJUA_CONFIG_DIR` जांचें। फ़ाइल `$SIDJUA_CONFIG_DIR/divisions.yaml` पर होनी चाहिए। वर्कस्पेस संरचना बनाने के लिए `sidjua init` चलाएं।

**REST API 401 Unauthorized लौटाता है:**
`Authorization: Bearer <key>` हेडर सत्यापित करें। स्वतः-जेनरेट की गई कुंजी के साथ प्राप्त करें:
```bash
cat ~/.sidjua/.system/api-key          # मैनुअल इंस्टॉल
docker compose exec sidjua cat /app/.system/api-key  # Docker
```

**पोर्ट 3000 पहले से उपयोग में:**
```bash
SIDJUA_PORT=3001 sidjua server start
# या .env में सेट करें: SIDJUA_PORT=3001
```

---

### Ubuntu / Debian

**`better-sqlite3` `futex.h` न मिलने के साथ कंपाइल करने में विफल:**
```bash
sudo apt-get install -y linux-headers-$(uname -r)
```

---

### Fedora / RHEL

**SELinux Docker वॉल्यूम माउंट को ब्लॉक करता है:**
```yaml
# SELinux संदर्भ के लिए :Z लेबल जोड़ें
volumes:
  - ./my-config:/app/config:Z
```
या SELinux संदर्भ मैन्युअल रूप से सेट करें:
```bash
chcon -Rt svirt_sandbox_file_t ./my-config
```

---

### Arch Linux

**Node.js संस्करण बहुत पुराना:**
Node.js 22 इंस्टॉल करने के लिए `nvm` का उपयोग करें:
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

**Docker Desktop की मेमोरी खत्म होती है:**
Docker Desktop → सेटिंग्स → संसाधन → मेमोरी खोलें। कम से कम 4 GB तक बढ़ाएं।

**Apple Silicon — आर्किटेक्चर मिसमैच:**
सत्यापित करें कि आपका Node.js इंस्टॉलेशन नेटिव ARM64 है (Rosetta नहीं):
```bash
node -e "console.log(process.arch)"
# अपेक्षित: arm64
```
यदि `x64` प्रिंट होता है, तो nodejs.org के ARM64 इंस्टॉलर का उपयोग करके Node.js पुनः इंस्टॉल करें।

---

### Windows (नेटिव)

**`MSBuild` या `cl.exe` नहीं मिला:**
[Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) इंस्टॉल करें और **C++ के साथ डेस्कटॉप डेवलपमेंट** वर्कलोड चुनें। फिर चलाएं:
```powershell
npm install --global windows-build-tools
```

**लंबे पथ की त्रुटियां (`ENAMETOOLONG`):**
Windows रजिस्ट्री में लंबे पथ समर्थन सक्षम करें:
```powershell
# व्यवस्थापक के रूप में चलाएं
Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" `
  -Name LongPathsEnabled -Value 1
```

**`npm install -g` के बाद `sidjua` कमांड नहीं मिली:**
npm ग्लोबल bin डायरेक्टरी को अपने PATH में जोड़ें:
```powershell
npm config get prefix  # उदाहरण C:\Users\you\AppData\Roaming\npm दिखाता है
# उस पथ को सिस्टम पर्यावरण चर → Path में जोड़ें
```

---

### Windows WSL2

**WSL2 के अंदर Docker शुरू करने में विफल:**
Docker Desktop → सेटिंग्स → सामान्य → **WSL 2 आधारित इंजन का उपयोग करें** सक्षम करें।
फिर Docker Desktop और अपना WSL2 टर्मिनल पुनः शुरू करें।

**`/mnt/c/` के अंतर्गत फ़ाइलों पर अनुमति त्रुटियां:**
WSL2 में माउंट किए गए Windows NTFS वॉल्यूम में प्रतिबंधित अनुमतियां होती हैं। अपने वर्कस्पेस को Linux-नेटिव पथ पर ले जाएं:
```bash
mkdir ~/sidjua-workspace
cd ~/sidjua-workspace
sidjua init
```

---

### Raspberry Pi / ARM64

**`npm ci` बहुत धीमी है (5-10 मिनट):**
यह सामान्य है। ARM64 पर नेटिव ऐड-ऑन कंपाइलेशन में अधिक समय लगता है। इसके बजाय Docker इमेज का उपयोग करने पर विचार करें:
```bash
docker pull sidjua/sidjua:latest-arm64
```

**बिल्ड के दौरान मेमोरी खत्म:**
स्वैप स्पेस जोड़ें:
```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

---

## 11. Docker वॉल्यूम संदर्भ

### नामित वॉल्यूम

| वॉल्यूम नाम | कंटेनर पथ | उद्देश्य |
|------------|----------|---------|
| `sidjua-data` | `/app/data` | SQLite डेटाबेस, बैकअप आर्काइव, नॉलेज कलेक्शन |
| `sidjua-config` | `/app/config` | `divisions.yaml`, कस्टम कॉन्फ़िगरेशन |
| `sidjua-logs` | `/app/logs` | संरचित एप्लिकेशन लॉग |
| `sidjua-system` | `/app/.system` | API की, अपडेट स्थिति, प्रोसेस लॉक फ़ाइल |
| `sidjua-workspace` | `/app/agents` | एजेंट स्किल डायरेक्टरी, परिभाषाएं, टेम्पलेट |
| `sidjua-governance` | `/app/governance` | अपरिवर्तनीय ऑडिट ट्रेल, गवर्नेंस स्नैपशॉट |
| `qdrant-storage` | `/qdrant/storage` | Qdrant वेक्टर इंडेक्स (केवल सिमेंटिक सर्च प्रोफ़ाइल) |

### होस्ट डायरेक्टरी का उपयोग

कंटेनर के अंदर संपादित करने के बजाय अपना `divisions.yaml` माउंट करने के लिए:

```yaml
# docker-compose.override.yml
services:
  sidjua:
    volumes:
      - ./my-config:/app/config   # sidjua-config नामित वॉल्यूम को बदलता है
```

### बैकअप

```bash
sidjua backup create                    # कंटेनर के अंदर से
# या
docker compose exec sidjua sidjua backup create
```

बैकअप `/app/data/backups/` में संग्रहीत HMAC-हस्ताक्षरित आर्काइव हैं।

---

## 12. अपग्रेड

### Docker

```bash
git pull
docker compose build --no-cache
docker compose up -d
docker compose exec sidjua sidjua apply    # स्कीमा माइग्रेशन चलाएं
```

`sidjua apply` इडेम्पोटेंट है — अपग्रेड के बाद फिर से चलाना हमेशा सुरक्षित है।

### npm ग्लोबल इंस्टॉल

```bash
npm update -g sidjua
sidjua apply    # स्कीमा माइग्रेशन चलाएं
```

### सोर्स बिल्ड

```bash
git pull
npm ci
npm run build
node dist/index.js apply    # स्कीमा माइग्रेशन चलाएं
```

### रोलबैक

SIDJUA प्रत्येक `sidjua apply` से पहले एक गवर्नेंस स्नैपशॉट बनाता है। वापस करने के लिए:

```bash
sidjua rollback list
sidjua rollback <version>
```

---

## 13. अगले कदम

| संसाधन | कमांड / लिंक |
|--------|------------|
| क्विक स्टार्ट | [docs/QUICK-START.md](QUICK-START.md) |
| CLI संदर्भ | [docs/CLI-REFERENCE.md](CLI-REFERENCE.md) |
| गवर्नेंस उदाहरण | [docs/GOVERNANCE-EXAMPLES.md](GOVERNANCE-EXAMPLES.md) |
| मुफ्त LLM प्रदाता गाइड | [docs/FREE-LLM-PROVIDER-GUIDE.md](FREE-LLM-PROVIDER-GUIDE.md) |
| समस्या निवारण | [docs/TROUBLESHOOTING.md](TROUBLESHOOTING.md) |

इंस्टॉलेशन के बाद पहले चलाने वाले कमांड:

```bash
sidjua chat guide    # ज़ीरो-कॉन्फ़िग AI गाइड — कोई API की आवश्यक नहीं
sidjua selftest      # सिस्टम स्वास्थ्य जांच (7 श्रेणियां, 0-100 स्कोर)
sidjua apply         # divisions.yaml से एजेंट प्रोविज़न करें
```
