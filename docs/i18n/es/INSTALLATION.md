> Este documento ha sido traducido por IA desde el [original en inglés](../INSTALLATION.md). ¿Encontró un error? [Repórtelo](https://github.com/GoetzKohlberg/sidjua/issues).

# Guía de Instalación de SIDJUA

SIDJUA versión: 1.0.0 | Licencia: AGPL-3.0-only | Actualizado: 2026-03-25

## Tabla de Contenidos

1. [Matriz de Compatibilidad de Plataformas](#1-matriz-de-compatibilidad-de-plataformas)
2. [Requisitos Previos](#2-requisitos-previos)
3. [Métodos de Instalación](#3-métodos-de-instalación)
4. [Estructura de Directorios](#4-estructura-de-directorios)
5. [Variables de Entorno](#5-variables-de-entorno)
6. [Configuración de Proveedores](#6-configuración-de-proveedores)
7. [GUI de Escritorio (Opcional)](#7-gui-de-escritorio-opcional)
8. [Sandboxing de Agentes](#8-sandboxing-de-agentes)
9. [Búsqueda Semántica (Opcional)](#9-búsqueda-semántica-opcional)
10. [Solución de Problemas](#10-solución-de-problemas)
11. [Referencia de Volúmenes Docker](#11-referencia-de-volúmenes-docker)
12. [Actualización](#12-actualización)
13. [Próximos Pasos](#13-próximos-pasos)

---

## 1. Matriz de Compatibilidad de Plataformas

| Característica | Linux | macOS | Windows WSL2 | Windows (nativo) |
|---------|-------|-------|--------------|------------------|
| CLI + REST API | ✅ Completo | ✅ Completo | ✅ Completo | ✅ Completo |
| Docker | ✅ Completo | ✅ Docker Desktop | ✅ Docker Desktop | ✅ Docker Desktop |
| Sandboxing (bubblewrap) | ✅ Completo | ❌ Recurre a `none` | ✅ Completo (dentro de WSL2) | ❌ Recurre a `none` |
| Web Management Console | ✅ Full | ✅ Full | ✅ Full | ✅ Full |
| Búsqueda Semántica (Qdrant) | ✅ | ✅ | ✅ | ✅ |

**Nota sobre bubblewrap:** Sandboxing de espacio de nombres de usuario de Linux. macOS y Windows nativo recurren automáticamente al modo sandbox `none` — no se necesita configuración.

---

## 2. Requisitos Previos

### Node.js >= 22.0.0

**Por qué:** SIDJUA utiliza módulos ES, `fetch()` nativo y `crypto.subtle` — todo requiere Node.js 22+.

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

**macOS (instalador .pkg):** Descargar desde [nodejs.org/en/download](https://nodejs.org/en/download).

**Windows (winget):**
```powershell
winget install OpenJS.NodeJS.LTS
```

**Windows (.msi):** Descargar desde [nodejs.org/en/download](https://nodejs.org/en/download).

**WSL2:** Use las instrucciones de Ubuntu/Debian anteriores dentro de su terminal WSL2.

Verificar:
```bash
node --version   # debe ser >= 22.0.0
npm --version    # debe ser >= 10.0.0
```

---

### Cadena de Herramientas C/C++ (solo para compilaciones desde fuente)

**Por qué:** `better-sqlite3` y `argon2` compilan complementos nativos de Node.js durante `npm ci`. Los usuarios de Docker omiten esto.

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

**Windows:** Instale [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) con la carga de trabajo **Desarrollo de escritorio con C++**, luego:
```powershell
npm install --global windows-build-tools
```

**Alpine Linux:**
```bash
apk add python3 make g++ build-base linux-headers
```

---

### Docker >= 24 (opcional)

Solo requerido para el método de instalación con Docker. El plugin Docker Compose V2 (`docker compose`) debe estar disponible.

**Linux:** Siga las instrucciones en [docs.docker.com/engine/install](https://docs.docker.com/engine/install/).
Docker Compose V2 está incluido con Docker Engine >= 24.

**macOS / Windows:** Instale [Docker Desktop](https://www.docker.com/products/docker-desktop/) (incluye Docker Compose V2).

Verificar:
```bash
docker --version          # debe ser >= 24.0.0
docker compose version    # debe mostrar v2.x.x
```

---

### Git

Cualquier versión reciente. Instale a través del gestor de paquetes de su sistema operativo o [git-scm.com](https://git-scm.com).

---

## 3. Métodos de Instalación

### Método A — Docker (Recomendado)

La forma más rápida de obtener una instalación funcional de SIDJUA. Todas las dependencias están incluidas en la imagen.

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
docker compose up -d
```

Espere a que los servicios estén saludables (hasta ~60 segundos en la primera compilación):

```bash
docker compose ps
# NAME              STATUS
# sidjua            Up X seconds (healthy)
# sidjua-qdrant     Up X seconds (healthy)
```

Recuperar la clave API generada automáticamente:

```bash
docker compose exec sidjua cat /app/.system/api-key
```

Inicializar la gobernanza desde su `divisions.yaml`:

```bash
docker compose exec sidjua sidjua apply --verbose
```

Ejecutar la comprobación de salud del sistema:

```bash
docker compose exec sidjua sidjua selftest
```

**Nota ARM64:** La imagen Docker se construye sobre `node:22-alpine` que admite `linux/amd64` y `linux/arm64`. Raspberry Pi (64 bits) y Macs con Apple Silicon (a través de Docker Desktop) son compatibles de fábrica.

**Bubblewrap en Docker:** Para habilitar el sandboxing de agentes dentro del contenedor, agregue `--cap-add=SYS_ADMIN` a su comando Docker run o configúrelo en `docker-compose.yml`:
```yaml
cap_add:
  - SYS_ADMIN
```

---

### Método B — Instalación Global npm

```bash
npm install -g sidjua
```

Ejecutar el asistente de configuración interactivo (3 pasos: ubicación del espacio de trabajo, proveedor, primer agente):
```bash
sidjua init
```

Para entornos CI o contenedores no interactivos:
```bash
sidjua init --yes
```

Iniciar la guía de IA sin configuración (no se requiere clave API):
```bash
sidjua chat guide
```

---

### Método C — Compilación desde Fuente

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
npm ci
npm run build
```

El proceso de compilación usa `tsup` para compilar `src/index.ts` en:
- `dist/index.js` (ESM)
- `dist/index.cjs` (CommonJS)

Los pasos posteriores a la compilación copian archivos de configuración regional i18n, roles predeterminados, divisiones y plantillas de base de conocimiento en `dist/`.

Ejecutar desde la fuente:
```bash
node dist/index.js --help
```

Ejecutar la suite de pruebas:
```bash
npm test                    # todas las pruebas
npm run test:coverage       # con informe de cobertura
npx tsc --noEmit            # solo verificación de tipos
```

---

## 4. Estructura de Directorios

### Rutas de Implementación Docker

| Ruta | Volumen Docker | Propósito | Administrado por |
|------|---------------|---------|------------|
| `/app/dist/` | Capa de imagen | Aplicación compilada | SIDJUA |
| `/app/node_modules/` | Capa de imagen | Dependencias de Node.js | SIDJUA |
| `/app/system/` | Capa de imagen | Valores predeterminados y plantillas integradas | SIDJUA |
| `/app/defaults/` | Capa de imagen | Archivos de configuración predeterminados | SIDJUA |
| `/app/docs/` | Capa de imagen | Documentación incluida | SIDJUA |
| `/app/data/` | `sidjua-data` | Bases de datos SQLite, copias de seguridad, colecciones de conocimiento | Usuario |
| `/app/config/` | `sidjua-config` | `divisions.yaml` y configuración personalizada | Usuario |
| `/app/logs/` | `sidjua-logs` | Archivos de registro estructurados | Usuario |
| `/app/.system/` | `sidjua-system` | Clave API, estado de actualización, bloqueo de proceso | Administrado por SIDJUA |
| `/app/agents/` | `sidjua-workspace` | Definiciones de agentes, habilidades, plantillas | Usuario |
| `/app/governance/` | `sidjua-governance` | Registro de auditoría, instantáneas de gobernanza | Usuario |

---

### Rutas de Instalación Manual / npm

Después de `sidjua init`, su espacio de trabajo está organizado como:

```
~/sidjua-workspace/           # o SIDJUA_CONFIG_DIR
├── divisions.yaml            # Su configuración de gobernanza
├── .sidjua/                  # Estado interno (WAL, búfer de telemetría)
│   └── telemetry.db
├── data/
│   ├── sidjua.db             # Base de datos principal (agentes, tareas, auditoría, costos)
│   ├── knowledge/            # Bases de datos de conocimiento por agente
│   │   └── <agent-id>.db
│   └── backups/              # Archivos de copia de seguridad firmados con HMAC
├── agents/                   # Directorios de habilidades de agentes
├── governance/               # Registro de auditoría (solo anexar)
├── logs/                     # Registros de aplicación
└── system/                   # Estado en tiempo de ejecución
```

---

### Bases de Datos SQLite

| Base de Datos | Ruta | Contenido |
|----------|------|----------|
| Principal | `data/sidjua.db` | Agentes, tareas, costos, instantáneas de gobernanza, claves API, registro de auditoría |
| Telemetría | `.sidjua/telemetry.db` | Informes de errores opcionales con consentimiento (con PII eliminado) |
| Conocimiento | `data/knowledge/<agent-id>.db` | Incrustaciones vectoriales por agente e índice BM25 |

Las bases de datos SQLite son archivos únicos, multiplataforma y portátiles. Realice copias de seguridad con `sidjua backup create`.

---

## 5. Variables de Entorno

Copie `.env.example` a `.env` y personalice. Todas las variables son opcionales salvo que se indique lo contrario.

### Servidor

| Variable | Predeterminado | Descripción |
|----------|---------|-------------|
| `SIDJUA_PORT` | `3000` | Puerto de escucha de la REST API |
| `SIDJUA_HOST` | `127.0.0.1` | Dirección de enlace de la REST API. Use `0.0.0.0` para acceso remoto |
| `NODE_ENV` | `production` | Modo de ejecución (`production` o `development`) |
| `SIDJUA_API_KEY` | Generado automáticamente | Token bearer de la REST API. Se crea automáticamente al primer inicio si está ausente |
| `SIDJUA_MAX_BODY_SIZE` | `2097152` (2 MiB) | Tamaño máximo del cuerpo de la solicitud entrante en bytes |

### Anulaciones de Directorio

| Variable | Predeterminado | Descripción |
|----------|---------|-------------|
| `SIDJUA_DATA_DIR` | `<workspace>/data` | Anular la ubicación del directorio de datos |
| `SIDJUA_CONFIG_DIR` | `<workspace>` | Anular la ubicación del directorio de configuración |
| `SIDJUA_LOG_DIR` | `<workspace>/logs` | Anular la ubicación del directorio de registros |

### Búsqueda Semántica

| Variable | Predeterminado | Descripción |
|----------|---------|-------------|
| `SIDJUA_QDRANT_URL` | `http://localhost:6333` | Punto de conexión de la base de datos vectorial Qdrant. Predeterminado Docker: `http://qdrant:6333` |
| `OPENAI_API_KEY` | — | Requerido para incrustaciones `text-embedding-3-large` de OpenAI |
| `SIDJUA_CF_ACCOUNT_ID` | — | ID de cuenta de Cloudflare para incrustaciones gratuitas |
| `SIDJUA_CF_TOKEN` | — | Token API de Cloudflare para incrustaciones gratuitas |

### Proveedores LLM

| Variable | Proveedor |
|----------|----------|
| `ANTHROPIC_API_KEY` | Anthropic (Claude) |
| `OPENAI_API_KEY` | OpenAI (GPT-4, incrustaciones) |
| `GOOGLE_AI_API_KEY` | Google AI (Gemini) |
| `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` | Cloudflare Workers AI (nivel gratuito) |
| `GROQ_API_KEY` | Groq (inferencia rápida, nivel gratuito disponible) |
| `DEEPSEEK_API_KEY` | DeepSeek |

---

## 6. Configuración de Proveedores

### Opción Sin Configuración

`sidjua chat guide` funciona sin ninguna clave API. Se conecta a Cloudflare Workers AI a través del proxy SIDJUA. Con límite de velocidad pero adecuado para evaluación e incorporación.

### Agregar Su Primer Proveedor

**Groq (nivel gratuito, no se requiere tarjeta de crédito):**
```bash
sidjua key set groq <your-groq-api-key>
sidjua provider list
```
Obtenga una clave gratuita en [console.groq.com](https://console.groq.com).

**Anthropic (recomendado para producción):**
```bash
export ANTHROPIC_API_KEY=sk-ant-...
sidjua key set anthropic $ANTHROPIC_API_KEY
```

**Ollama (implementación aislada / local):**
```bash
sidjua provider add-custom \
  --id ollama \
  --name "Ollama (local)" \
  --base-url http://localhost:11434/v1 \
  --model llama3.2
```

Validar todos los proveedores configurados:
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

## 8. Sandboxing de Agentes

SIDJUA utiliza una interfaz `SandboxProvider` conectable. El sandbox envuelve la ejecución de habilidades de agentes en aislamiento de proceso a nivel de sistema operativo.

### Compatibilidad de Sandbox por Plataforma

| Plataforma | Proveedor de Sandbox | Notas |
|----------|-----------------|-------|
| Linux (nativo) | `bubblewrap` | Aislamiento completo de espacio de nombres de usuario |
| Docker (contenedor Linux) | `bubblewrap` | Requiere `--cap-add=SYS_ADMIN` |
| macOS | `none` (recurso automático) | macOS no admite espacios de nombres de usuario de Linux |
| Windows WSL2 | `bubblewrap` | Instalar como en Linux dentro de WSL2 |
| Windows (nativo) | `none` (recurso automático) | |

### Instalación de bubblewrap (Linux)

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

### Configuración

En `divisions.yaml`:
```yaml
governance:
  sandbox: bubblewrap    # o: none
```

Verificar disponibilidad del sandbox:
```bash
sidjua sandbox check
```

---

## 9. Búsqueda Semántica (Opcional)

La búsqueda semántica potencia `sidjua memory search` y la recuperación de conocimiento de agentes. Requiere una base de datos vectorial Qdrant y un proveedor de incrustaciones.

### Perfil de Docker Compose

El `docker-compose.yml` incluido tiene un perfil `semantic-search`:
```bash
docker compose --profile semantic-search up -d
```
Esto inicia un contenedor Qdrant junto a SIDJUA.

### Qdrant Independiente

```bash
docker run -d \
  --name sidjua-qdrant \
  -p 6333:6333 \
  -v qdrant-storage:/qdrant/storage \
  qdrant/qdrant:v1.13.2
```

Establecer el punto de conexión:
```bash
export SIDJUA_QDRANT_URL=http://localhost:6333
```

### Sin Qdrant

Si Qdrant no está disponible, `sidjua memory import` y `sidjua memory search` están deshabilitados. Todas las demás características de SIDJUA (CLI, REST API, ejecución de agentes, gobernanza, auditoría) funcionan normalmente. El sistema recurre a la búsqueda de palabras clave BM25 para cualquier consulta de conocimiento.

---

## 10. Solución de Problemas

### Todas las Plataformas

**`npm ci` falla con errores de `node-pre-gyp` o `node-gyp`:**
```
gyp ERR! build error
```
Instale la cadena de herramientas C/C++ (consulte la sección de Requisitos previos). En Ubuntu: `sudo apt-get install -y python3 make g++ build-essential`.

**`Cannot find divisions.yaml`:**
Verifique `SIDJUA_CONFIG_DIR`. El archivo debe estar en `$SIDJUA_CONFIG_DIR/divisions.yaml`. Ejecute `sidjua init` para crear la estructura del espacio de trabajo.

**La REST API devuelve 401 Unauthorized:**
Verifique el encabezado `Authorization: Bearer <key>`. Recupere la clave generada automáticamente con:
```bash
cat ~/.sidjua/.system/api-key          # instalación manual
docker compose exec sidjua cat /app/.system/api-key  # Docker
```

**Puerto 3000 ya en uso:**
```bash
SIDJUA_PORT=3001 sidjua server start
# o establecer en .env: SIDJUA_PORT=3001
```

---

### Ubuntu / Debian

**`better-sqlite3` no compila, `futex.h` no encontrado:**
```bash
sudo apt-get install -y linux-headers-$(uname -r)
```

---

### Fedora / RHEL

**SELinux bloquea los montajes de volúmenes Docker:**
```yaml
# Agregar etiqueta :Z para el contexto SELinux
volumes:
  - ./my-config:/app/config:Z
```
O establecer el contexto SELinux manualmente:
```bash
chcon -Rt svirt_sandbox_file_t ./my-config
```

---

### Arch Linux

**Versión de Node.js demasiado antigua:**
Use `nvm` para instalar Node.js 22:
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

**Docker Desktop se queda sin memoria:**
Abra Docker Desktop → Configuración → Recursos → Memoria. Aumente a al menos 4 GB.

**Apple Silicon — incompatibilidad de arquitectura:**
Verifique que su instalación de Node.js sea ARM64 nativo (no Rosetta):
```bash
node -e "console.log(process.arch)"
# esperado: arm64
```
Si imprime `x64`, reinstale Node.js usando el instalador ARM64 de nodejs.org.

---

### Windows (nativo)

**`MSBuild` o `cl.exe` no encontrado:**
Instale [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) y seleccione la carga de trabajo **Desarrollo de escritorio con C++**. Luego ejecute:
```powershell
npm install --global windows-build-tools
```

**Errores de ruta larga (`ENAMETOOLONG`):**
Habilite la compatibilidad con rutas largas en el registro de Windows:
```powershell
# Ejecutar como Administrador
Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" `
  -Name LongPathsEnabled -Value 1
```

**Comando `sidjua` no encontrado después de `npm install -g`:**
Agregue el directorio bin global de npm a su PATH:
```powershell
npm config get prefix  # muestra p. ej. C:\Users\you\AppData\Roaming\npm
# Agregue esa ruta a Variables de entorno del sistema → Ruta
```

---

### Windows WSL2

**Docker no inicia dentro de WSL2:**
Abra Docker Desktop → Configuración → General → habilite **Usar el motor basado en WSL 2**.
Luego reinicie Docker Desktop y su terminal WSL2.

**Errores de permisos en archivos bajo `/mnt/c/`:**
Los volúmenes Windows NTFS montados en WSL2 tienen permisos restringidos. Mueva su espacio de trabajo a una ruta nativa de Linux:
```bash
mkdir ~/sidjua-workspace
cd ~/sidjua-workspace
sidjua init
```

---

### Raspberry Pi / ARM64

**`npm ci` es muy lento (5-10 minutos):**
Esto es normal. La compilación de complementos nativos en ARM64 tarda más. Considere usar la imagen Docker en su lugar:
```bash
docker pull sidjua/sidjua:latest-arm64
```

**Sin memoria durante la compilación:**
Agregar espacio de intercambio:
```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

---

## 11. Referencia de Volúmenes Docker

### Volúmenes con Nombre

| Nombre del Volumen | Ruta del Contenedor | Propósito |
|-------------|---------------|---------|
| `sidjua-data` | `/app/data` | Bases de datos SQLite, archivos de copia de seguridad, colecciones de conocimiento |
| `sidjua-config` | `/app/config` | `divisions.yaml`, configuración personalizada |
| `sidjua-logs` | `/app/logs` | Registros de aplicación estructurados |
| `sidjua-system` | `/app/.system` | Clave API, estado de actualización, archivo de bloqueo de proceso |
| `sidjua-workspace` | `/app/agents` | Directorios de habilidades de agentes, definiciones, plantillas |
| `sidjua-governance` | `/app/governance` | Registro de auditoría inmutable, instantáneas de gobernanza |
| `qdrant-storage` | `/qdrant/storage` | Índice vectorial Qdrant (solo perfil de búsqueda semántica) |

### Usar un Directorio del Host

Para montar su propio `divisions.yaml` en lugar de editarlo dentro del contenedor:

```yaml
# docker-compose.override.yml
services:
  sidjua:
    volumes:
      - ./my-config:/app/config   # reemplaza el volumen con nombre sidjua-config
```

### Copia de Seguridad

```bash
sidjua backup create                    # desde dentro del contenedor
# o
docker compose exec sidjua sidjua backup create
```

Las copias de seguridad son archivos firmados con HMAC almacenados en `/app/data/backups/`.

---

## 12. Actualización

### Docker

```bash
git pull
docker compose build --no-cache
docker compose up -d
docker compose exec sidjua sidjua apply    # ejecutar migraciones de esquema
```

`sidjua apply` es idempotente — siempre seguro de volver a ejecutar después de una actualización.

### Instalación Global npm

```bash
npm update -g sidjua
sidjua apply    # ejecutar migraciones de esquema
```

### Compilación desde Fuente

```bash
git pull
npm ci
npm run build
node dist/index.js apply    # ejecutar migraciones de esquema
```

### Reversión

SIDJUA crea una instantánea de gobernanza antes de cada `sidjua apply`. Para revertir:

```bash
sidjua rollback list
sidjua rollback <version>
```

---

## 13. Próximos Pasos

| Recurso | Comando / Enlace |
|----------|---------------|
| Inicio Rápido | [docs/QUICK-START.md](QUICK-START.md) |
| Referencia de CLI | [docs/CLI-REFERENCE.md](CLI-REFERENCE.md) |
| Ejemplos de Gobernanza | [docs/GOVERNANCE-EXAMPLES.md](GOVERNANCE-EXAMPLES.md) |
| Guía de Proveedores LLM Gratuitos | [docs/FREE-LLM-PROVIDER-GUIDE.md](FREE-LLM-PROVIDER-GUIDE.md) |
| Solución de Problemas | [docs/TROUBLESHOOTING.md](TROUBLESHOOTING.md) |

Primeros comandos a ejecutar después de la instalación:

```bash
sidjua chat guide    # guía de IA sin configuración — no se requiere clave API
sidjua selftest      # comprobación de salud del sistema (7 categorías, puntuación 0-100)
sidjua apply         # aprovisionar agentes desde divisions.yaml
```
