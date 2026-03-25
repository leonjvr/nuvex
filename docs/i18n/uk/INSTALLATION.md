> Цей документ було автоматично перекладено ШІ з [англійського оригіналу](../INSTALLATION.md). Знайшли помилку? [Повідомте про неї](https://github.com/GoetzKohlberg/sidjua/issues).

# Посібник з встановлення SIDJUA

Версія SIDJUA: 1.0.0 | Ліцензія: AGPL-3.0-only | Оновлено: 2026-03-25

## Зміст

1. [Матриця підтримки платформ](#1-матриця-підтримки-платформ)
2. [Передумови](#2-передумови)
3. [Методи встановлення](#3-методи-встановлення)
4. [Структура каталогів](#4-структура-каталогів)
5. [Змінні середовища](#5-змінні-середовища)
6. [Налаштування постачальника](#6-налаштування-постачальника)
7. [Десктопний інтерфейс (необов'язково)](#7-десктопний-інтерфейс-необовязково)
8. [Ізоляція агентів](#8-ізоляція-агентів)
9. [Семантичний пошук (необов'язково)](#9-семантичний-пошук-необовязково)
10. [Усунення несправностей](#10-усунення-несправностей)
11. [Довідник томів Docker](#11-довідник-томів-docker)
12. [Оновлення](#12-оновлення)
13. [Наступні кроки](#13-наступні-кроки)

---

## 1. Матриця підтримки платформ

| Функція | Linux | macOS | Windows WSL2 | Windows (нативний) |
|---------|-------|-------|--------------|-------------------|
| CLI + REST API | ✅ Повна | ✅ Повна | ✅ Повна | ✅ Повна |
| Docker | ✅ Повна | ✅ Docker Desktop | ✅ Docker Desktop | ✅ Docker Desktop |
| Ізоляція (bubblewrap) | ✅ Повна | ❌ Відкат до `none` | ✅ Повна (всередині WSL2) | ❌ Відкат до `none` |
| Web Management Console | ✅ Full | ✅ Full | ✅ Full | ✅ Full |
| Семантичний пошук (Qdrant) | ✅ | ✅ | ✅ | ✅ |

**Примітка щодо bubblewrap:** Ізоляція з використанням просторів імен користувача Linux. macOS і Windows (нативний) автоматично переходять до режиму ізоляції `none` — налаштування не потрібне.

---

## 2. Передумови

### Node.js >= 22.0.0

**Чому:** SIDJUA використовує ES-модулі, нативний `fetch()` та `crypto.subtle` — усе це потребує Node.js 22+.

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

**macOS (установник .pkg):** Завантажте з [nodejs.org/en/download](https://nodejs.org/en/download).

**Windows (winget):**
```powershell
winget install OpenJS.NodeJS.LTS
```

**Windows (.msi):** Завантажте з [nodejs.org/en/download](https://nodejs.org/en/download).

**WSL2:** Використовуйте інструкції для Ubuntu/Debian вище у своєму терміналі WSL2.

Перевірка:
```bash
node --version   # має бути >= 22.0.0
npm --version    # має бути >= 10.0.0
```

---

### Ланцюжок інструментів C/C++ (лише для збірки з вихідного коду)

**Чому:** `better-sqlite3` та `argon2` компілюють нативні доповнення Node.js під час виконання `npm ci`. Користувачі Docker можуть пропустити це.

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

**Windows:** Встановіть [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) з робочим навантаженням **Розробка класичних застосунків на C++**, потім:
```powershell
npm install --global windows-build-tools
```

**Alpine Linux:**
```bash
apk add python3 make g++ build-base linux-headers
```

---

### Docker >= 24 (необов'язково)

Потрібен лише для методу встановлення через Docker. Плагін Docker Compose V2 (`docker compose`) має бути доступний.

**Linux:** Дотримуйтесь інструкцій на [docs.docker.com/engine/install](https://docs.docker.com/engine/install/).
Docker Compose V2 входить до складу Docker Engine >= 24.

**macOS / Windows:** Встановіть [Docker Desktop](https://www.docker.com/products/docker-desktop/) (містить Docker Compose V2).

Перевірка:
```bash
docker --version          # має бути >= 24.0.0
docker compose version    # має відображати v2.x.x
```

---

### Git

Будь-яка актуальна версія. Встановіть через менеджер пакетів вашої ОС або з [git-scm.com](https://git-scm.com).

---

## 3. Методи встановлення

### Метод A — Docker (рекомендовано)

Найшвидший шлях до робочого встановлення SIDJUA. Усі залежності включені до образу.

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
docker compose up -d
```

Зачекайте, поки служби стануть справними (до ~60 секунд при першій збірці):

```bash
docker compose ps
# NAME              STATUS
# sidjua            Up X seconds (healthy)
# sidjua-qdrant     Up X seconds (healthy)
```

Отримайте автоматично згенерований API-ключ:

```bash
docker compose exec sidjua cat /app/.system/api-key
```

Ініціалізуйте управління з вашого `divisions.yaml`:

```bash
docker compose exec sidjua sidjua apply --verbose
```

Запустіть перевірку стану системи:

```bash
docker compose exec sidjua sidjua selftest
```

**Примітка ARM64:** Образ Docker зібраний на `node:22-alpine`, який підтримує `linux/amd64` та `linux/arm64`. Raspberry Pi (64-бітний) та Mac на Apple Silicon (через Docker Desktop) підтримуються з коробки.

**Bubblewrap у Docker:** Щоб увімкнути ізоляцію агентів всередині контейнера, додайте `--cap-add=SYS_ADMIN` до команди Docker run або вкажіть це в `docker-compose.yml`:
```yaml
cap_add:
  - SYS_ADMIN
```

---

### Метод Б — Глобальне встановлення npm

```bash
npm install -g sidjua
```

Запустіть інтерактивний майстер налаштування (3 кроки: розташування робочого простору, постачальник, перший агент):
```bash
sidjua init
```

Для неінтерактивних середовищ CI або контейнерів:
```bash
sidjua init --yes
```

Запустіть ШІ-помічника без налаштування (API-ключ не потрібен):
```bash
sidjua chat guide
```

---

### Метод В — Збірка з вихідного коду

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
npm ci
npm run build
```

Процес збірки використовує `tsup` для компіляції `src/index.ts` у:
- `dist/index.js` (ESM)
- `dist/index.cjs` (CommonJS)

Кроки після збірки копіюють файли локалізацій i18n, ролі за замовчуванням, підрозділи та шаблони бази знань до `dist/`.

Запуск з вихідного коду:
```bash
node dist/index.js --help
```

Запуск набору тестів:
```bash
npm test                    # всі тести
npm run test:coverage       # зі звітом про покриття
npx tsc --noEmit            # лише перевірка типів
```

---

## 4. Структура каталогів

### Шляхи розгортання Docker

| Шлях | Том Docker | Призначення | Управляється |
|------|-----------|------------|-------------|
| `/app/dist/` | Шар образу | Скомпільований застосунок | SIDJUA |
| `/app/node_modules/` | Шар образу | Залежності Node.js | SIDJUA |
| `/app/system/` | Шар образу | Вбудовані налаштування та шаблони за замовчуванням | SIDJUA |
| `/app/defaults/` | Шар образу | Файли конфігурації за замовчуванням | SIDJUA |
| `/app/docs/` | Шар образу | Вбудована документація | SIDJUA |
| `/app/data/` | `sidjua-data` | Бази даних SQLite, резервні копії, колекції знань | Користувач |
| `/app/config/` | `sidjua-config` | `divisions.yaml` та користувацька конфігурація | Користувач |
| `/app/logs/` | `sidjua-logs` | Структуровані файли журналів | Користувач |
| `/app/.system/` | `sidjua-system` | API-ключ, стан оновлення, блокування процесу | Управляється SIDJUA |
| `/app/agents/` | `sidjua-workspace` | Визначення агентів, навички, шаблони | Користувач |
| `/app/governance/` | `sidjua-governance` | Журнал аудиту, знімки стану управління | Користувач |

---

### Шляхи ручного встановлення / npm

Після `sidjua init` ваш робочий простір організовано таким чином:

```
~/sidjua-workspace/           # або SIDJUA_CONFIG_DIR
├── divisions.yaml            # Ваша конфігурація управління
├── .sidjua/                  # Внутрішній стан (WAL, буфер телеметрії)
│   └── telemetry.db
├── data/
│   ├── sidjua.db             # Основна база даних (агенти, завдання, аудит, витрати)
│   ├── knowledge/            # Бази даних знань на кожного агента
│   │   └── <agent-id>.db
│   └── backups/              # Архіви резервних копій, підписані HMAC
├── agents/                   # Каталоги навичок агентів
├── governance/               # Журнал аудиту (лише додавання)
├── logs/                     # Журнали застосунку
└── system/                   # Стан виконання
```

---

### Бази даних SQLite

| База даних | Шлях | Вміст |
|-----------|------|-------|
| Основна | `data/sidjua.db` | Агенти, завдання, витрати, знімки управління, API-ключі, журнал аудиту |
| Телеметрія | `.sidjua/telemetry.db` | Необов'язкові звіти про помилки за згодою (з видаленням PII) |
| Знання | `data/knowledge/<agent-id>.db` | Векторні вкладення на кожного агента та індекс BM25 |

Бази даних SQLite — це одиночні файли, кросплатформні та переносні. Створюйте резервні копії за допомогою `sidjua backup create`.

---

## 5. Змінні середовища

Скопіюйте `.env.example` до `.env` та налаштуйте. Усі змінні є необов'язковими, якщо не зазначено інше.

### Сервер

| Змінна | За замовчуванням | Опис |
|-------|----------------|------|
| `SIDJUA_PORT` | `3000` | Порт прослуховування REST API |
| `SIDJUA_HOST` | `127.0.0.1` | Адреса прив'язки REST API. Використовуйте `0.0.0.0` для віддаленого доступу |
| `NODE_ENV` | `production` | Режим виконання (`production` або `development`) |
| `SIDJUA_API_KEY` | Автогенерація | Bearer-токен REST API. Автоматично створюється при першому запуску, якщо відсутній |
| `SIDJUA_MAX_BODY_SIZE` | `2097152` (2 МіБ) | Максимальний розмір тіла вхідного запиту в байтах |

### Перевизначення каталогів

| Змінна | За замовчуванням | Опис |
|-------|----------------|------|
| `SIDJUA_DATA_DIR` | `<workspace>/data` | Перевизначити розташування каталогу даних |
| `SIDJUA_CONFIG_DIR` | `<workspace>` | Перевизначити розташування каталогу конфігурації |
| `SIDJUA_LOG_DIR` | `<workspace>/logs` | Перевизначити розташування каталогу журналів |

### Семантичний пошук

| Змінна | За замовчуванням | Опис |
|-------|----------------|------|
| `SIDJUA_QDRANT_URL` | `http://localhost:6333` | Кінцева точка векторної бази даних Qdrant. За замовчуванням для Docker: `http://qdrant:6333` |
| `OPENAI_API_KEY` | — | Потрібен для вкладень OpenAI `text-embedding-3-large` |
| `SIDJUA_CF_ACCOUNT_ID` | — | ID облікового запису Cloudflare для безкоштовних вкладень |
| `SIDJUA_CF_TOKEN` | — | API-токен Cloudflare для безкоштовних вкладень |

### Постачальники LLM

| Змінна | Постачальник |
|-------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic (Claude) |
| `OPENAI_API_KEY` | OpenAI (GPT-4, вкладення) |
| `GOOGLE_AI_API_KEY` | Google AI (Gemini) |
| `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` | Cloudflare Workers AI (безкоштовний рівень) |
| `GROQ_API_KEY` | Groq (швидкий вивід, доступний безкоштовний рівень) |
| `DEEPSEEK_API_KEY` | DeepSeek |

---

## 6. Налаштування постачальника

### Варіант без налаштування

`sidjua chat guide` працює без будь-якого API-ключа. Підключається до Cloudflare Workers AI через проксі SIDJUA. Обмежений за частотою запитів, але підходить для оцінки та навчання.

### Додавання першого постачальника

**Groq (безкоштовний рівень, кредитна картка не потрібна):**
```bash
sidjua key set groq <your-groq-api-key>
sidjua provider list
```
Отримайте безкоштовний ключ на [console.groq.com](https://console.groq.com).

**Anthropic (рекомендовано для продакшену):**
```bash
export ANTHROPIC_API_KEY=sk-ant-...
sidjua key set anthropic $ANTHROPIC_API_KEY
```

**Ollama (ізольоване / локальне розгортання):**
```bash
sidjua provider add-custom \
  --id ollama \
  --name "Ollama (local)" \
  --base-url http://localhost:11434/v1 \
  --model llama3.2
```

Перевірте всіх налаштованих постачальників:
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

## 8. Ізоляція агентів

SIDJUA використовує підключаємий інтерфейс `SandboxProvider`. Пісочниця обгортає виконання навичок агентів в ізоляцію процесів на рівні ОС.

### Підтримка ізоляції за платформами

| Платформа | Постачальник ізоляції | Примітки |
|-----------|----------------------|----------|
| Linux (нативний) | `bubblewrap` | Повна ізоляція просторів імен користувача |
| Docker (контейнер Linux) | `bubblewrap` | Потребує `--cap-add=SYS_ADMIN` |
| macOS | `none` (автоматичний відкат) | macOS не підтримує простори імен користувача Linux |
| Windows WSL2 | `bubblewrap` | Встановлюйте як на Linux всередині WSL2 |
| Windows (нативний) | `none` (автоматичний відкат) | |

### Встановлення bubblewrap (Linux)

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

### Налаштування

У `divisions.yaml`:
```yaml
governance:
  sandbox: bubblewrap    # або: none
```

Перевірте доступність пісочниці:
```bash
sidjua sandbox check
```

---

## 9. Семантичний пошук (необов'язково)

Семантичний пошук забезпечує роботу `sidjua memory search` та пошук в базі знань агентів. Потребує векторну базу даних Qdrant та постачальника вкладень.

### Профіль Docker Compose

Включений `docker-compose.yml` має профіль `semantic-search`:
```bash
docker compose --profile semantic-search up -d
```
Це запускає контейнер Qdrant поруч із SIDJUA.

### Автономний Qdrant

```bash
docker run -d \
  --name sidjua-qdrant \
  -p 6333:6333 \
  -v qdrant-storage:/qdrant/storage \
  qdrant/qdrant:v1.13.2
```

Вкажіть кінцеву точку:
```bash
export SIDJUA_QDRANT_URL=http://localhost:6333
```

### Без Qdrant

Якщо Qdrant недоступний, `sidjua memory import` та `sidjua memory search` вимкнено. Усі інші функції SIDJUA (CLI, REST API, виконання агентів, управління, аудит) працюють у звичайному режимі. Система переходить до пошуку за ключовими словами BM25 для будь-яких запитів до бази знань.

---

## 10. Усунення несправностей

### Всі платформи

**`npm ci` завершується з помилками `node-pre-gyp` або `node-gyp`:**
```
gyp ERR! build error
```
Встановіть ланцюжок інструментів C/C++ (див. розділ Передумови). На Ubuntu: `sudo apt-get install -y python3 make g++ build-essential`.

**`Cannot find divisions.yaml`:**
Перевірте `SIDJUA_CONFIG_DIR`. Файл має знаходитися за шляхом `$SIDJUA_CONFIG_DIR/divisions.yaml`. Запустіть `sidjua init` для створення структури робочого простору.

**REST API повертає 401 Unauthorized:**
Перевірте заголовок `Authorization: Bearer <key>`. Отримайте автоматично згенерований ключ за допомогою:
```bash
cat ~/.sidjua/.system/api-key          # ручне встановлення
docker compose exec sidjua cat /app/.system/api-key  # Docker
```

**Порт 3000 вже використовується:**
```bash
SIDJUA_PORT=3001 sidjua server start
# або вкажіть у .env: SIDJUA_PORT=3001
```

---

### Ubuntu / Debian

**`better-sqlite3` не компілюється, `futex.h` не знайдено:**
```bash
sudo apt-get install -y linux-headers-$(uname -r)
```

---

### Fedora / RHEL

**SELinux блокує монтування томів Docker:**
```yaml
# Додайте мітку :Z для контексту SELinux
volumes:
  - ./my-config:/app/config:Z
```
Або вкажіть контекст SELinux вручну:
```bash
chcon -Rt svirt_sandbox_file_t ./my-config
```

---

### Arch Linux

**Версія Node.js застаріла:**
Використовуйте `nvm` для встановлення Node.js 22:
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

**Docker Desktop вичерпує пам'ять:**
Відкрийте Docker Desktop → Налаштування → Ресурси → Пам'ять. Збільшіть до мінімум 4 ГБ.

**Apple Silicon — невідповідність архітектур:**
Переконайтеся, що ваше встановлення Node.js є нативним ARM64 (не через Rosetta):
```bash
node -e "console.log(process.arch)"
# очікується: arm64
```
Якщо виводиться `x64`, перевстановіть Node.js, використовуючи ARM64-установник з nodejs.org.

---

### Windows (нативний)

**`MSBuild` або `cl.exe` не знайдено:**
Встановіть [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) та виберіть робоче навантаження **Розробка класичних застосунків на C++**. Потім запустіть:
```powershell
npm install --global windows-build-tools
```

**Помилки довгих шляхів (`ENAMETOOLONG`):**
Увімкніть підтримку довгих шляхів у реєстрі Windows:
```powershell
# Запустіть від імені адміністратора
Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" `
  -Name LongPathsEnabled -Value 1
```

**Команда `sidjua` не знайдена після `npm install -g`:**
Додайте глобальний каталог bin npm до PATH:
```powershell
npm config get prefix  # показує, наприклад, C:\Users\you\AppData\Roaming\npm
# Додайте цей шлях до Системних змінних середовища → Path
```

---

### Windows WSL2

**Docker не запускається всередині WSL2:**
Відкрийте Docker Desktop → Налаштування → Загальне → увімкніть **Use the WSL 2 based engine**.
Потім перезапустіть Docker Desktop та ваш термінал WSL2.

**Помилки прав доступу до файлів під `/mnt/c/`:**
Томи Windows NTFS, змонтовані у WSL2, мають обмежені права доступу. Перемістіть робочий простір на нативний шлях Linux:
```bash
mkdir ~/sidjua-workspace
cd ~/sidjua-workspace
sidjua init
```

---

### Raspberry Pi / ARM64

**`npm ci` працює дуже повільно (5-10 хвилин):**
Це нормально. Компіляція нативних доповнень на ARM64 займає більше часу. Розгляньте можливість використання образу Docker:
```bash
docker pull sidjua/sidjua:latest-arm64
```

**Недостатньо пам'яті під час збірки:**
Додайте файл підкачки:
```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

---

## 11. Довідник томів Docker

### Іменовані томи

| Ім'я тому | Шлях у контейнері | Призначення |
|----------|------------------|------------|
| `sidjua-data` | `/app/data` | Бази даних SQLite, архіви резервних копій, колекції знань |
| `sidjua-config` | `/app/config` | `divisions.yaml`, користувацька конфігурація |
| `sidjua-logs` | `/app/logs` | Структуровані журнали застосунку |
| `sidjua-system` | `/app/.system` | API-ключ, стан оновлення, файл блокування процесу |
| `sidjua-workspace` | `/app/agents` | Каталоги навичок агентів, визначення, шаблони |
| `sidjua-governance` | `/app/governance` | Незмінний журнал аудиту, знімки управління |
| `qdrant-storage` | `/qdrant/storage` | Векторний індекс Qdrant (лише для профілю семантичного пошуку) |

### Використання каталогу хоста

Щоб змонтувати власний `divisions.yaml` замість редагування всередині контейнера:

```yaml
# docker-compose.override.yml
services:
  sidjua:
    volumes:
      - ./my-config:/app/config   # замінює іменований том sidjua-config
```

### Резервне копіювання

```bash
sidjua backup create                    # зсередини контейнера
# або
docker compose exec sidjua sidjua backup create
```

Резервні копії — це підписані HMAC архіви, що зберігаються в `/app/data/backups/`.

---

## 12. Оновлення

### Docker

```bash
git pull
docker compose build --no-cache
docker compose up -d
docker compose exec sidjua sidjua apply    # виконати міграції схеми
```

`sidjua apply` є ідемпотентним — завжди безпечно виконувати повторно після оновлення.

### Глобальне встановлення npm

```bash
npm update -g sidjua
sidjua apply    # виконати міграції схеми
```

### Збірка з вихідного коду

```bash
git pull
npm ci
npm run build
node dist/index.js apply    # виконати міграції схеми
```

### Відкат

SIDJUA створює знімок управління перед кожним `sidjua apply`. Для відкату:

```bash
sidjua rollback list
sidjua rollback <version>
```

---

## 13. Наступні кроки

| Ресурс | Команда / Посилання |
|--------|-------------------|
| Швидкий старт | [docs/QUICK-START.md](QUICK-START.md) |
| Довідник CLI | [docs/CLI-REFERENCE.md](CLI-REFERENCE.md) |
| Приклади управління | [docs/GOVERNANCE-EXAMPLES.md](GOVERNANCE-EXAMPLES.md) |
| Посібник з безкоштовних LLM-постачальників | [docs/FREE-LLM-PROVIDER-GUIDE.md](FREE-LLM-PROVIDER-GUIDE.md) |
| Усунення несправностей | [docs/TROUBLESHOOTING.md](TROUBLESHOOTING.md) |

Перші команди для запуску після встановлення:

```bash
sidjua chat guide    # ШІ-помічник без налаштування — API-ключ не потрібен
sidjua selftest      # перевірка стану системи (7 категорій, оцінка 0-100)
sidjua apply         # розгорнути агентів з divisions.yaml
```
