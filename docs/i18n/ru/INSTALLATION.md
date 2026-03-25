> Этот документ был переведён ИИ с [английского оригинала](../INSTALLATION.md). Нашли ошибку? [Сообщите о ней](https://github.com/GoetzKohlberg/sidjua/issues).

# Руководство по установке SIDJUA

Версия SIDJUA: 1.0.0 | Лицензия: AGPL-3.0-only | Обновлено: 2026-03-25

## Содержание

1. [Матрица поддержки платформ](#1-матрица-поддержки-платформ)
2. [Требования](#2-требования)
3. [Методы установки](#3-методы-установки)
4. [Структура каталогов](#4-структура-каталогов)
5. [Переменные окружения](#5-переменные-окружения)
6. [Настройка провайдера](#6-настройка-провайдера)
7. [Десктопный интерфейс (необязательно)](#7-десктопный-интерфейс-необязательно)
8. [Изоляция агентов](#8-изоляция-агентов)
9. [Семантический поиск (необязательно)](#9-семантический-поиск-необязательно)
10. [Устранение неполадок](#10-устранение-неполадок)
11. [Справочник по томам Docker](#11-справочник-по-томам-docker)
12. [Обновление](#12-обновление)
13. [Следующие шаги](#13-следующие-шаги)

---

## 1. Матрица поддержки платформ

| Функция | Linux | macOS | Windows WSL2 | Windows (нативный) |
|---------|-------|-------|--------------|-------------------|
| CLI + REST API | ✅ Полная | ✅ Полная | ✅ Полная | ✅ Полная |
| Docker | ✅ Полная | ✅ Docker Desktop | ✅ Docker Desktop | ✅ Docker Desktop |
| Изоляция (bubblewrap) | ✅ Полная | ❌ Откат к `none` | ✅ Полная (внутри WSL2) | ❌ Откат к `none` |
| Web Management Console | ✅ Full | ✅ Full | ✅ Full | ✅ Full |
| Семантический поиск (Qdrant) | ✅ | ✅ | ✅ | ✅ |

**Примечание о bubblewrap:** Изоляция с использованием пространств имён пользователя Linux. macOS и Windows (нативный) автоматически переключаются в режим изоляции `none` — настройка не требуется.

---

## 2. Требования

### Node.js >= 22.0.0

**Почему:** SIDJUA использует ES-модули, нативный `fetch()` и `crypto.subtle` — всё это требует Node.js 22+.

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

**macOS (установщик .pkg):** Загрузите с [nodejs.org/en/download](https://nodejs.org/en/download).

**Windows (winget):**
```powershell
winget install OpenJS.NodeJS.LTS
```

**Windows (.msi):** Загрузите с [nodejs.org/en/download](https://nodejs.org/en/download).

**WSL2:** Используйте инструкции для Ubuntu/Debian выше в терминале WSL2.

Проверка:
```bash
node --version   # должно быть >= 22.0.0
npm --version    # должно быть >= 10.0.0
```

---

### Цепочка инструментов C/C++ (только для сборки из исходного кода)

**Почему:** `better-sqlite3` и `argon2` компилируют нативные аддоны Node.js во время выполнения `npm ci`. Пользователи Docker могут пропустить этот шаг.

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

**Windows:** Установите [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) с рабочей нагрузкой **Разработка классических приложений на C++**, затем:
```powershell
npm install --global windows-build-tools
```

**Alpine Linux:**
```bash
apk add python3 make g++ build-base linux-headers
```

---

### Docker >= 24 (необязательно)

Требуется только для метода установки через Docker. Плагин Docker Compose V2 (`docker compose`) должен быть доступен.

**Linux:** Следуйте инструкциям на [docs.docker.com/engine/install](https://docs.docker.com/engine/install/).
Docker Compose V2 входит в состав Docker Engine >= 24.

**macOS / Windows:** Установите [Docker Desktop](https://www.docker.com/products/docker-desktop/) (включает Docker Compose V2).

Проверка:
```bash
docker --version          # должно быть >= 24.0.0
docker compose version    # должно отображать v2.x.x
```

---

### Git

Любая актуальная версия. Установите через менеджер пакетов вашей ОС или с [git-scm.com](https://git-scm.com).

---

## 3. Методы установки

### Метод А — Docker (рекомендуется)

Самый быстрый способ получить рабочую установку SIDJUA. Все зависимости включены в образ.

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
docker compose up -d
```

Подождите, пока сервисы станут работоспособными (до ~60 секунд при первой сборке):

```bash
docker compose ps
# NAME              STATUS
# sidjua            Up X seconds (healthy)
# sidjua-qdrant     Up X seconds (healthy)
```

Получите автоматически сгенерированный API-ключ:

```bash
docker compose exec sidjua cat /app/.system/api-key
```

Инициализируйте управление из вашего `divisions.yaml`:

```bash
docker compose exec sidjua sidjua apply --verbose
```

Запустите проверку работоспособности системы:

```bash
docker compose exec sidjua sidjua selftest
```

**Примечание для ARM64:** Образ Docker собран на `node:22-alpine`, который поддерживает `linux/amd64` и `linux/arm64`. Raspberry Pi (64-бит) и Mac на Apple Silicon (через Docker Desktop) поддерживаются из коробки.

**Bubblewrap в Docker:** Чтобы включить изоляцию агентов внутри контейнера, добавьте `--cap-add=SYS_ADMIN` в команду Docker run или укажите это в `docker-compose.yml`:
```yaml
cap_add:
  - SYS_ADMIN
```

---

### Метод Б — Глобальная установка npm

```bash
npm install -g sidjua
```

Запустите интерактивный мастер настройки (3 шага: расположение рабочего пространства, провайдер, первый агент):
```bash
sidjua init
```

Для неинтерактивных сред CI или контейнеров:
```bash
sidjua init --yes
```

Запустите ИИ-помощника без настройки (API-ключ не требуется):
```bash
sidjua chat guide
```

---

### Метод В — Сборка из исходного кода

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
npm ci
npm run build
```

Процесс сборки использует `tsup` для компиляции `src/index.ts` в:
- `dist/index.js` (ESM)
- `dist/index.cjs` (CommonJS)

Шаги после сборки копируют файлы локализаций i18n, роли по умолчанию, подразделения и шаблоны базы знаний в `dist/`.

Запуск из исходного кода:
```bash
node dist/index.js --help
```

Запуск набора тестов:
```bash
npm test                    # все тесты
npm run test:coverage       # с отчётом о покрытии
npx tsc --noEmit            # только проверка типов
```

---

## 4. Структура каталогов

### Пути развёртывания Docker

| Путь | Том Docker | Назначение | Управляется |
|------|-----------|------------|-------------|
| `/app/dist/` | Слой образа | Скомпилированное приложение | SIDJUA |
| `/app/node_modules/` | Слой образа | Зависимости Node.js | SIDJUA |
| `/app/system/` | Слой образа | Встроенные настройки и шаблоны по умолчанию | SIDJUA |
| `/app/defaults/` | Слой образа | Файлы конфигурации по умолчанию | SIDJUA |
| `/app/docs/` | Слой образа | Встроенная документация | SIDJUA |
| `/app/data/` | `sidjua-data` | Базы данных SQLite, резервные копии, коллекции знаний | Пользователь |
| `/app/config/` | `sidjua-config` | `divisions.yaml` и пользовательская конфигурация | Пользователь |
| `/app/logs/` | `sidjua-logs` | Структурированные файлы журналов | Пользователь |
| `/app/.system/` | `sidjua-system` | API-ключ, состояние обновления, блокировка процесса | Управляется SIDJUA |
| `/app/agents/` | `sidjua-workspace` | Определения агентов, навыки, шаблоны | Пользователь |
| `/app/governance/` | `sidjua-governance` | Журнал аудита, снимки состояния управления | Пользователь |

---

### Пути ручной установки / npm

После `sidjua init` ваше рабочее пространство организовано следующим образом:

```
~/sidjua-workspace/           # или SIDJUA_CONFIG_DIR
├── divisions.yaml            # Ваша конфигурация управления
├── .sidjua/                  # Внутреннее состояние (WAL, буфер телеметрии)
│   └── telemetry.db
├── data/
│   ├── sidjua.db             # Основная база данных (агенты, задачи, аудит, затраты)
│   ├── knowledge/            # Базы данных знаний для каждого агента
│   │   └── <agent-id>.db
│   └── backups/              # Архивы резервных копий, подписанные HMAC
├── agents/                   # Каталоги навыков агентов
├── governance/               # Журнал аудита (только добавление)
├── logs/                     # Журналы приложения
└── system/                   # Состояние выполнения
```

---

### Базы данных SQLite

| База данных | Путь | Содержимое |
|-------------|------|------------|
| Основная | `data/sidjua.db` | Агенты, задачи, затраты, снимки управления, API-ключи, журнал аудита |
| Телеметрия | `.sidjua/telemetry.db` | Необязательные отчёты об ошибках с согласия пользователя (с удалением PII) |
| Знания | `data/knowledge/<agent-id>.db` | Векторные вложения для каждого агента и индекс BM25 |

Базы данных SQLite — это одиночные файлы, кроссплатформенные и переносимые. Создавайте резервные копии с помощью `sidjua backup create`.

---

## 5. Переменные окружения

Скопируйте `.env.example` в `.env` и настройте. Все переменные необязательны, если не указано иное.

### Сервер

| Переменная | По умолчанию | Описание |
|-----------|-------------|----------|
| `SIDJUA_PORT` | `3000` | Порт прослушивания REST API |
| `SIDJUA_HOST` | `127.0.0.1` | Адрес привязки REST API. Используйте `0.0.0.0` для удалённого доступа |
| `NODE_ENV` | `production` | Режим выполнения (`production` или `development`) |
| `SIDJUA_API_KEY` | Автогенерация | Bearer-токен REST API. Автоматически создаётся при первом запуске, если отсутствует |
| `SIDJUA_MAX_BODY_SIZE` | `2097152` (2 МиБ) | Максимальный размер входящего тела запроса в байтах |

### Переопределение каталогов

| Переменная | По умолчанию | Описание |
|-----------|-------------|----------|
| `SIDJUA_DATA_DIR` | `<workspace>/data` | Переопределить расположение каталога данных |
| `SIDJUA_CONFIG_DIR` | `<workspace>` | Переопределить расположение каталога конфигурации |
| `SIDJUA_LOG_DIR` | `<workspace>/logs` | Переопределить расположение каталога журналов |

### Семантический поиск

| Переменная | По умолчанию | Описание |
|-----------|-------------|----------|
| `SIDJUA_QDRANT_URL` | `http://localhost:6333` | Конечная точка векторной базы данных Qdrant. По умолчанию для Docker: `http://qdrant:6333` |
| `OPENAI_API_KEY` | — | Требуется для вложений OpenAI `text-embedding-3-large` |
| `SIDJUA_CF_ACCOUNT_ID` | — | ID аккаунта Cloudflare для бесплатных вложений |
| `SIDJUA_CF_TOKEN` | — | API-токен Cloudflare для бесплатных вложений |

### Провайдеры LLM

| Переменная | Провайдер |
|-----------|----------|
| `ANTHROPIC_API_KEY` | Anthropic (Claude) |
| `OPENAI_API_KEY` | OpenAI (GPT-4, вложения) |
| `GOOGLE_AI_API_KEY` | Google AI (Gemini) |
| `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` | Cloudflare Workers AI (бесплатный уровень) |
| `GROQ_API_KEY` | Groq (быстрый вывод, доступен бесплатный уровень) |
| `DEEPSEEK_API_KEY` | DeepSeek |

---

## 6. Настройка провайдера

### Вариант без настройки

`sidjua chat guide` работает без API-ключа. Он подключается к Cloudflare Workers AI через прокси SIDJUA. Ограничен по частоте запросов, но подходит для оценки и обучения.

### Добавление первого провайдера

**Groq (бесплатный уровень, кредитная карта не требуется):**
```bash
sidjua key set groq <your-groq-api-key>
sidjua provider list
```
Получите бесплатный ключ на [console.groq.com](https://console.groq.com).

**Anthropic (рекомендуется для продакшена):**
```bash
export ANTHROPIC_API_KEY=sk-ant-...
sidjua key set anthropic $ANTHROPIC_API_KEY
```

**Ollama (изолированное / локальное развёртывание):**
```bash
sidjua provider add-custom \
  --id ollama \
  --name "Ollama (local)" \
  --base-url http://localhost:11434/v1 \
  --model llama3.2
```

Проверьте все настроенные провайдеры:
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

## 8. Изоляция агентов

SIDJUA использует подключаемый интерфейс `SandboxProvider`. Изолированная среда обёртывает выполнение навыков агентов в изоляцию процессов на уровне ОС.

### Поддержка изоляции по платформам

| Платформа | Провайдер изоляции | Примечания |
|-----------|-------------------|------------|
| Linux (нативный) | `bubblewrap` | Полная изоляция пространств имён пользователя |
| Docker (контейнер Linux) | `bubblewrap` | Требует `--cap-add=SYS_ADMIN` |
| macOS | `none` (автоматический откат) | macOS не поддерживает пространства имён пользователя Linux |
| Windows WSL2 | `bubblewrap` | Устанавливайте как на Linux внутри WSL2 |
| Windows (нативный) | `none` (автоматический откат) | |

### Установка bubblewrap (Linux)

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

### Настройка

В `divisions.yaml`:
```yaml
governance:
  sandbox: bubblewrap    # или: none
```

Проверьте доступность изолированной среды:
```bash
sidjua sandbox check
```

---

## 9. Семантический поиск (необязательно)

Семантический поиск обеспечивает работу `sidjua memory search` и поиск в базе знаний агентов. Требует векторную базу данных Qdrant и провайдера вложений.

### Профиль Docker Compose

Включённый `docker-compose.yml` имеет профиль `semantic-search`:
```bash
docker compose --profile semantic-search up -d
```
Это запускает контейнер Qdrant вместе с SIDJUA.

### Автономный Qdrant

```bash
docker run -d \
  --name sidjua-qdrant \
  -p 6333:6333 \
  -v qdrant-storage:/qdrant/storage \
  qdrant/qdrant:v1.13.2
```

Укажите конечную точку:
```bash
export SIDJUA_QDRANT_URL=http://localhost:6333
```

### Без Qdrant

Если Qdrant недоступен, `sidjua memory import` и `sidjua memory search` отключены. Все остальные функции SIDJUA (CLI, REST API, выполнение агентов, управление, аудит) работают в обычном режиме. Система переключается на ключевой поиск BM25 для любых запросов к базе знаний.

---

## 10. Устранение неполадок

### Все платформы

**`npm ci` завершается с ошибками `node-pre-gyp` или `node-gyp`:**
```
gyp ERR! build error
```
Установите цепочку инструментов C/C++ (см. раздел Требования). На Ubuntu: `sudo apt-get install -y python3 make g++ build-essential`.

**`Cannot find divisions.yaml`:**
Проверьте `SIDJUA_CONFIG_DIR`. Файл должен находиться по пути `$SIDJUA_CONFIG_DIR/divisions.yaml`. Запустите `sidjua init` для создания структуры рабочего пространства.

**REST API возвращает 401 Unauthorized:**
Проверьте заголовок `Authorization: Bearer <key>`. Получите автоматически сгенерированный ключ с помощью:
```bash
cat ~/.sidjua/.system/api-key          # ручная установка
docker compose exec sidjua cat /app/.system/api-key  # Docker
```

**Порт 3000 уже используется:**
```bash
SIDJUA_PORT=3001 sidjua server start
# или установите в .env: SIDJUA_PORT=3001
```

---

### Ubuntu / Debian

**`better-sqlite3` не компилируется, `futex.h` не найден:**
```bash
sudo apt-get install -y linux-headers-$(uname -r)
```

---

### Fedora / RHEL

**SELinux блокирует монтирование томов Docker:**
```yaml
# Добавьте метку :Z для контекста SELinux
volumes:
  - ./my-config:/app/config:Z
```
Или установите контекст SELinux вручную:
```bash
chcon -Rt svirt_sandbox_file_t ./my-config
```

---

### Arch Linux

**Версия Node.js устарела:**
Используйте `nvm` для установки Node.js 22:
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

**Docker Desktop заканчивается память:**
Откройте Docker Desktop → Настройки → Ресурсы → Память. Увеличьте до минимум 4 ГБ.

**Apple Silicon — несоответствие архитектур:**
Убедитесь, что ваша установка Node.js является нативной ARM64 (не через Rosetta):
```bash
node -e "console.log(process.arch)"
# ожидается: arm64
```
Если выводится `x64`, переустановите Node.js с использованием ARM64-установщика с nodejs.org.

---

### Windows (нативный)

**`MSBuild` или `cl.exe` не найден:**
Установите [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) и выберите рабочую нагрузку **Разработка классических приложений на C++**. Затем запустите:
```powershell
npm install --global windows-build-tools
```

**Ошибки длинных путей (`ENAMETOOLONG`):**
Включите поддержку длинных путей в реестре Windows:
```powershell
# Запустите от имени администратора
Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" `
  -Name LongPathsEnabled -Value 1
```

**Команда `sidjua` не найдена после `npm install -g`:**
Добавьте глобальный каталог bin npm в PATH:
```powershell
npm config get prefix  # показывает, например, C:\Users\you\AppData\Roaming\npm
# Добавьте этот путь в Системные переменные окружения → Path
```

---

### Windows WSL2

**Docker не запускается внутри WSL2:**
Откройте Docker Desktop → Настройки → Общие → включите **Use the WSL 2 based engine**.
Затем перезапустите Docker Desktop и терминал WSL2.

**Ошибки прав доступа к файлам под `/mnt/c/`:**
Тома Windows NTFS, смонтированные в WSL2, имеют ограниченные права доступа. Переместите рабочее пространство на нативный путь Linux:
```bash
mkdir ~/sidjua-workspace
cd ~/sidjua-workspace
sidjua init
```

---

### Raspberry Pi / ARM64

**`npm ci` работает очень медленно (5-10 минут):**
Это нормально. Компиляция нативных аддонов на ARM64 занимает больше времени. Рассмотрите возможность использования образа Docker:
```bash
docker pull sidjua/sidjua:latest-arm64
```

**Недостаточно памяти во время сборки:**
Добавьте файл подкачки:
```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

---

## 11. Справочник по томам Docker

### Именованные тома

| Имя тома | Путь в контейнере | Назначение |
|---------|------------------|------------|
| `sidjua-data` | `/app/data` | Базы данных SQLite, архивы резервных копий, коллекции знаний |
| `sidjua-config` | `/app/config` | `divisions.yaml`, пользовательская конфигурация |
| `sidjua-logs` | `/app/logs` | Структурированные журналы приложения |
| `sidjua-system` | `/app/.system` | API-ключ, состояние обновления, файл блокировки процесса |
| `sidjua-workspace` | `/app/agents` | Каталоги навыков агентов, определения, шаблоны |
| `sidjua-governance` | `/app/governance` | Неизменяемый журнал аудита, снимки управления |
| `qdrant-storage` | `/qdrant/storage` | Векторный индекс Qdrant (только для профиля семантического поиска) |

### Использование хост-каталога

Для монтирования собственного `divisions.yaml` вместо редактирования внутри контейнера:

```yaml
# docker-compose.override.yml
services:
  sidjua:
    volumes:
      - ./my-config:/app/config   # заменяет именованный том sidjua-config
```

### Резервное копирование

```bash
sidjua backup create                    # из внутри контейнера
# или
docker compose exec sidjua sidjua backup create
```

Резервные копии — это подписанные HMAC архивы, хранящиеся в `/app/data/backups/`.

---

## 12. Обновление

### Docker

```bash
git pull
docker compose build --no-cache
docker compose up -d
docker compose exec sidjua sidjua apply    # выполнить миграции схемы
```

`sidjua apply` является идемпотентным — всегда безопасно выполнять повторно после обновления.

### Глобальная установка npm

```bash
npm update -g sidjua
sidjua apply    # выполнить миграции схемы
```

### Сборка из исходного кода

```bash
git pull
npm ci
npm run build
node dist/index.js apply    # выполнить миграции схемы
```

### Откат

SIDJUA создаёт снимок управления перед каждым `sidjua apply`. Для отката:

```bash
sidjua rollback list
sidjua rollback <version>
```

---

## 13. Следующие шаги

| Ресурс | Команда / Ссылка |
|--------|-----------------|
| Быстрый старт | [docs/QUICK-START.md](QUICK-START.md) |
| Справочник CLI | [docs/CLI-REFERENCE.md](CLI-REFERENCE.md) |
| Примеры управления | [docs/GOVERNANCE-EXAMPLES.md](GOVERNANCE-EXAMPLES.md) |
| Руководство по бесплатным LLM-провайдерам | [docs/FREE-LLM-PROVIDER-GUIDE.md](FREE-LLM-PROVIDER-GUIDE.md) |
| Устранение неполадок | [docs/TROUBLESHOOTING.md](TROUBLESHOOTING.md) |

Первые команды для запуска после установки:

```bash
sidjua chat guide    # ИИ-помощник без настройки — API-ключ не требуется
sidjua selftest      # проверка работоспособности системы (7 категорий, оценка 0-100)
sidjua apply         # развернуть агентов из divisions.yaml
```
