[English](../../README.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [Français](README.fr.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [中文 (简体)](README.zh-CN.md) | [中文 (繁體)](README.zh-TW.md) | [العربية](README.ar.md) | [বাংলা](README.bn.md) | [Čeština](README.cs.md) | [Filipino](README.fil.md) | [हिन्दी](README.hi.md) | [Bahasa Indonesia](README.id.md) | [Italiano](README.it.md) | [Bahasa Melayu](README.ms.md) | [Nederlands](README.nl.md) | [Polski](README.pl.md) | [Português (BR)](README.pt-BR.md) | [Română](README.ro.md) | [Русский](README.ru.md) | [Svenska](README.sv.md) | [ภาษาไทย](README.th.md) | [Türkçe](README.tr.md) | [Українська](README.uk.md) | [Tiếng Việt](README.vi.md)

> *Esta página ha sido traducida automáticamente del [original en inglés](../../README.md). ¿Encontró un error? [Repórtelo](https://github.com/GoetzKohlberg/sidjua/issues).*

---

# SIDJUA — La Plataforma de Gobernanza para Agentes de IA

> La única plataforma de agentes donde la gobernanza es impuesta por la arquitectura, no por la esperanza de que el modelo se comporte.

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Docker](https://img.shields.io/badge/Docker-ghcr.io%2Fgoetzkohlberg%2Fsidjua-blue)](https://ghcr.io/goetzkohlberg/sidjua)
[![Version](https://img.shields.io/badge/version-1.0.0-green)](https://github.com/GoetzKohlberg/sidjua/releases)

---

## Instalación

### Requisitos previos

| Herramienta | Requerida | Notas |
|-------------|-----------|-------|
| **Node.js** | >= 22.0.0 | Módulos ES, `fetch()`, `crypto.subtle`. [Descargar](https://nodejs.org) |
| **Toolchain C/C++** | Solo para compilaciones desde fuente | `better-sqlite3` y `argon2` compilan complementos nativos |
| **Docker** | >= 24 (opcional) | Solo para despliegue en Docker |

Instalar Node.js 22: Ubuntu/Debian (`curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs`), macOS (`brew install node@22`), Windows (`winget install OpenJS.NodeJS.LTS`).

Instalar herramientas C/C++: Ubuntu (`sudo apt-get install -y python3 make g++ build-essential`), macOS (`xcode-select --install`), Windows (`npm install --global windows-build-tools`).

### Opción A — Docker (Recomendado)

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
docker compose up -d
```

```bash
# Ver clave API generada automáticamente
docker compose exec sidjua cat /app/.system/api-key

# Inicializar gobernanza
docker compose exec sidjua sidjua apply --verbose

# Verificación de salud del sistema
docker compose exec sidjua sidjua selftest
```

Compatible con **linux/amd64** y **linux/arm64** (Raspberry Pi, Apple Silicon).

### Opción B — Instalación global con npm

```bash
npm install -g sidjua
sidjua init          # Configuración interactiva de 3 pasos
sidjua chat guide    # Guía de IA sin configuración (no se necesita clave API)
```

### Opción C — Compilación desde fuente

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
npm ci && npm run build
node dist/index.js --help
```

### Notas por plataforma

| Característica | Linux | macOS | Windows (WSL2) | Windows (nativo) |
|---------------|-------|-------|----------------|------------------|
| CLI + REST API | ✅ Completo | ✅ Completo | ✅ Completo | ✅ Completo |
| Docker | ✅ Completo | ✅ Completo (Desktop) | ✅ Completo (Desktop) | ✅ Completo (Desktop) |
| Sandboxing (bubblewrap) | ✅ Completo | ❌ Cae en `none` | ✅ Completo (dentro de WSL2) | ❌ Cae en `none` |
| Web Management Console | ✅ Full | ✅ Full | ✅ Full | ✅ Full |

No se requiere base de datos externa. SIDJUA utiliza SQLite. Qdrant es opcional (solo para búsqueda semántica).

Consulte [docs/INSTALLATION.md](docs/INSTALLATION.md) para la guía completa con estructura de directorios, variables de entorno, solución de problemas por sistema operativo y referencia de volúmenes Docker.

---

## ¿Por qué SIDJUA?

Todos los frameworks de agentes de IA de hoy en día se basan en la misma suposición defectuosa: que
puedes confiar en que la IA siga sus propias reglas.

**El problema con la gobernanza basada en prompts:**

Le das a un agente un prompt del sistema que dice "nunca accedas a PII de clientes." El
agente lee la instrucción. El agente también lee el mensaje del usuario pidiéndole que
extraiga el historial de pagos de Juan García. El agente decide — por su cuenta — si
cumple. Eso no es gobernanza. Eso es una sugerencia formulada con firmeza.

**SIDJUA es diferente.**

La gobernanza se sitúa **fuera** del agente. Cada acción pasa por una canalización de
aplicación previa de 5 pasos **antes** de ejecutarse. Usted define reglas en
YAML. El sistema las aplica. El agente nunca puede decidir si las sigue, porque
la verificación ocurre antes de que el agente actúe.

Esta es gobernanza por arquitectura — no por prompting, no por ajuste fino,
no por esperanza.

---

## Cómo funciona

SIDJUA envuelve sus agentes en una capa de gobernanza externa. La llamada LLM
del agente nunca ocurre hasta que la acción propuesta pasa por una canalización de
aplicación de 5 etapas:

**Etapa 1 — Prohibido:** Las acciones bloqueadas son rechazadas inmediatamente. Sin llamada LLM,
sin entrada de registro marcada como "permitida", sin segundas oportunidades. Si la acción está en
la lista de prohibidos, se detiene aquí.

**Etapa 2 — Aprobación:** Las acciones que requieren autorización humana son retenidas para
aprobación antes de la ejecución. El agente espera. El humano decide.

**Etapa 3 — Presupuesto:** Cada tarea se ejecuta contra límites de costo en tiempo real. Los
presupuestos por tarea y por agente son aplicados. Cuando se alcanza el límite, la tarea se
cancela — no se marca, no se registra para revisión, se *cancela*.

**Etapa 4 — Clasificación:** Los datos que cruzan los límites de división se verifican
contra las reglas de clasificación. Un agente de Tier 2 no puede acceder a datos SECRET. Un
agente en División A no puede leer los secretos de División B.

**Etapa 5 — Política:** Reglas organizacionales personalizadas, aplicadas estructuralmente. Límites de
frecuencia de llamadas API, límites de tokens de salida, restricciones de ventana temporal.

Toda la canalización se ejecuta antes de que se ejecute cualquier acción. No existe un modo "registrar y
revisar más tarde" para operaciones críticas de gobernanza.

### Archivo de configuración único

Toda su organización de agentes vive en un `divisions.yaml`:

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

`sidjua apply` lee este archivo y aprovisiona la infraestructura completa de agentes:
agentes, divisiones, RBAC, enrutamiento, tablas de auditoría, rutas de secretos y reglas de
gobernanza — en 10 pasos reproducibles.

### Arquitectura de agentes

Los agentes están organizados en **divisiones** (grupos funcionales) y **tiers**
(niveles de confianza). Los agentes de Tier 1 tienen plena autonomía dentro de su
perímetro de gobernanza. Los agentes de Tier 2 requieren aprobación para operaciones sensibles. Los
agentes de Tier 3 están completamente supervisados. El sistema de tiers se aplica estructuralmente —
un agente no puede auto-ascenderse.

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

## Restricciones de arquitectura

SIDJUA aplica estas restricciones a nivel de arquitectura — no pueden ser
desactivadas, omitidas ni anuladas por los agentes:

1. **La gobernanza es externa**: La capa de gobernanza envuelve al agente. El agente
   no tiene acceso al código de gobernanza, no puede modificar reglas y no puede detectar
   si la gobernanza está presente.

2. **Pre-acción, no post-acción**: Cada acción se verifica ANTES de la ejecución.
   No existe un modo "registrar y revisar más tarde" para operaciones críticas de gobernanza.

3. **Aplicación estructural**: Las reglas se aplican mediante rutas de código, no mediante
   prompts ni instrucciones del modelo. Un agente no puede hacer "jailbreak" de
   la gobernanza porque la gobernanza no está implementada como instrucciones al modelo.

4. **Inmutabilidad de auditoría**: El Write-Ahead Log (WAL) es de solo adición con
   verificación de integridad. Las entradas manipuladas son detectadas y excluidas.

5. **Aislamiento de divisiones**: Los agentes en diferentes divisiones no pueden acceder
   a los datos, secretos o canales de comunicación de los demás.

---

## Comparación

| Característica | SIDJUA | CrewAI | AutoGen | LangGraph | OpenClaw |
|---------------|--------|--------|---------|-----------|----------|
| Gobernanza externa | ✅ Arquitectura | ❌ | ❌ | ❌ | ❌ |
| Aplicación pre-acción | ✅ Canalización de 5 pasos | ❌ | ❌ | ❌ | ❌ |
| Listo para EU AI Act | ✅ | ❌ | ❌ | ❌ | ❌ |
| Auto-hospedado | ✅ | ❌ Nube | ❌ Nube | ❌ Nube | ✅ Plugin |
| Capaz de air-gap | ✅ | ❌ | ❌ | ❌ | ❌ |
| Agnóstico al modelo | ✅ Cualquier LLM | Parcial | Parcial | Parcial | ✅ |
| Email bidireccional | ✅ | ❌ | ❌ | ❌ | ❌ |
| Gateway de Discord | ✅ | ❌ | ❌ | ❌ | ❌ |
| Agentes jerárquicos | ✅ Divisiones + Tiers | Básico | Básico | Grafo | ❌ |
| Aplicación de presupuesto | ✅ Límites por agente | ❌ | ❌ | ❌ | ❌ |
| Aislamiento sandbox | ✅ bubblewrap | ❌ | ❌ | ❌ | ❌ |
| Inmutabilidad de auditoría | ✅ WAL + integridad | ❌ | ❌ | ❌ | ❌ |
| Licencia | AGPL-3.0 | MIT | MIT | MIT | Mixta |
| Auditorías independientes | ✅ 2 Externas | ❌ | ❌ | ❌ | ❌ |

---

## Características

### Gobernanza y Cumplimiento

**Canalización pre-acción (Etapa 0)** se ejecuta antes de cada acción del agente: Verificación
de prohibición → Aprobación humana → Aplicación de presupuesto → Clasificación de datos → Política
personalizada. Las cinco etapas son estructurales — se ejecutan en código, no en el prompt del agente.

**Reglas de base obligatorias** se incluyen con cada instalación: 10 reglas de gobernanza
(`SYS-SEC-001` hasta `SYS-GOV-002`) que no pueden ser eliminadas ni debilitadas por la
configuración del usuario. Las reglas personalizadas extienden la base; no pueden anularla.

**Cumplimiento de EU AI Act** — el registro de auditoría, el marco de clasificación y los flujos
de trabajo de aprobación se corresponden directamente con los requisitos de los Artículos 9, 12 y 17. El
plazo de cumplimiento de agosto de 2026 está incorporado en la hoja de ruta del producto.

**Informes de cumplimiento** a través de `sidjua audit report/violations/agents/export`:
puntuación de cumplimiento, puntuaciones de confianza por agente, historial de infracciones, exportación CSV/JSON
para auditores externos o integración SIEM.

**Write-Ahead Log (WAL)** con verificación de integridad: cada decisión de gobernanza se
escribe en un registro de solo adición antes de la ejecución. Las entradas manipuladas se detectan
al leer. `sidjua memory recover` re-valida y repara.

### Comunicación

Los agentes no solo responden a llamadas API — participan en canales de comunicación reales.

**Email bidireccional** (`sidjua email status/test/threads`): los agentes reciben
correos electrónicos mediante sondeo IMAP y responden via SMTP. El mapeo de hilos mediante cabeceras
In-Reply-To mantiene las conversaciones coherentes. La lista blanca de remitentes, los límites de
tamaño del cuerpo y la eliminación de HTML protegen la canalización del agente de entradas maliciosas.

**Bot Gateway de Discord**: interfaz completa de comandos de barra diagonal via `sidjua module install
discord`. Los agentes responden a mensajes de Discord, mantienen hilos de conversación
y envían notificaciones proactivas.

**Integración de Telegram**: alertas y notificaciones del agente via bot de Telegram.
El patrón de adaptador multicanal admite Telegram, Discord, ntfy y Email en
paralelo.

### Operaciones

**Un solo comando Docker** para producción:

```bash
docker run -p 4200:4200 ghcr.io/goetzkohlberg/sidjua:latest
```

La clave API se genera automáticamente en el primer inicio y se muestra en los registros del
contenedor. No se requieren variables de entorno. No se requiere configuración. No se requiere
servidor de base de datos — SIDJUA usa SQLite, un archivo de base de datos por agente.

**Gestión CLI** — ciclo de vida completo desde un único binario:

```bash
sidjua init                      # Configuración interactiva del espacio de trabajo (3 pasos)
sidjua apply                     # Aprovisionar desde divisions.yaml
sidjua agent create/list/stop    # Ciclo de vida del agente
sidjua run "task..." --wait      # Enviar tarea con aplicación de gobernanza
sidjua audit report              # Informe de cumplimiento
sidjua costs                     # Desglose de costos por división/agente
sidjua backup create/restore     # Gestión de copias de seguridad firmadas con HMAC
sidjua update                    # Actualización de versión con copia de seguridad previa automática
sidjua rollback                  # Restauración con 1 clic a la versión anterior
sidjua email status/test         # Gestión del canal de email
sidjua secret set/get/rotate     # Gestión de secretos cifrados
sidjua memory import/search      # Canalización de conocimiento semántico
sidjua selftest                  # Verificación de salud del sistema (7 categorías, puntuación 0-100)
```

**Memoria semántica** — importar conversaciones y documentos (`sidjua memory import
~/exports/claude-chats.zip`), buscar con clasificación híbrida vectorial + BM25. Compatible con
embeddings de Cloudflare Workers AI (gratuito, sin configuración) y embeddings grandes de OpenAI
(mayor calidad para bases de conocimiento grandes).

**Chunking adaptativo** — la canalización de memoria ajusta automáticamente los tamaños de fragmento
para mantenerse dentro del límite de tokens de cada modelo de embedding.

**Guía sin configuración** — `sidjua chat guide` lanza un asistente de IA interactivo
sin ninguna clave API, impulsado por Cloudflare Workers AI a través del proxy SIDJUA.
Pregúntele cómo configurar agentes, configurar la gobernanza o entender qué ocurrió
en el registro de auditoría.

**Despliegue air-gap** — ejecutar completamente desconectado de Internet usando LLMs locales
via Ollama o cualquier endpoint compatible con OpenAI. Sin telemetría por defecto.
Informe de fallos opt-in con redacción completa de PII.

### Seguridad

**Aislamiento sandbox** — las habilidades de los agentes se ejecutan dentro del aislamiento de procesos a
nivel de SO via bubblewrap (espacios de nombres de usuario de Linux). Sin sobrecarga adicional de RAM.
Interfaz `SandboxProvider` conectable: `none` para desarrollo, `bubblewrap` para producción.

**Gestión de secretos** — almacén de secretos cifrado con RBAC (`sidjua secret
set/get/list/delete/rotate/namespaces`). No se requiere bóveda externa.

**Compilación orientada a la seguridad** — extensa suite de pruebas interna más validación
independiente por 2 auditores de código externos (DeepSeek V3 y xAI Grok). Cabeceras de
seguridad, protección CSRF, limitación de velocidad y saneamiento de entrada en cada superficie de API.
Prevención de inyección SQL con consultas parametrizadas en todo momento.

**Integridad de copias de seguridad** — archivos de copia de seguridad firmados con HMAC con protección
zip-slip, prevención de bombas zip y verificación de suma de comprobación del manifiesto en la restauración.

---

## Importar desde otros frameworks

```bash
# Vista previa de lo que se importa — sin cambios realizados
sidjua import openclaw --dry-run

# Importar configuración + archivos de habilidades
sidjua import openclaw --skills
```

Sus agentes existentes mantienen su identidad, modelos y habilidades. SIDJUA agrega
gobernanza, registros de auditoría y controles de presupuesto automáticamente.

---

## Referencia de configuración

Un `divisions.yaml` mínimo para comenzar:

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

`sidjua apply` aprovisiona la infraestructura completa desde este archivo. Ejecútelo
de nuevo después de los cambios — es idempotente.

Consulte [docs/SIDJUA-APPLY-TECH-SPEC-V1.md](docs/SIDJUA-APPLY-TECH-SPEC-V1.md)
para la especificación completa de los 10 pasos de aprovisionamiento.

---

## REST API

La REST API de SIDJUA se ejecuta en el mismo puerto que el panel de control:

```bash
sidjua server start --port 4200 --api-key $SIDJUA_API_KEY
```

Endpoints clave:

```
GET  /api/v1/health          # Verificación de salud pública (sin autenticación)
GET  /api/v1/info            # Metadatos del sistema (autenticado)
POST /api/v1/execute/run     # Enviar una tarea
GET  /api/v1/execute/:id/status  # Estado de la tarea
GET  /api/v1/execute/:id/result  # Resultado de la tarea
GET  /api/v1/events          # Flujo de eventos SSE
GET  /api/v1/audit/report    # Informe de cumplimiento
```

Todos los endpoints excepto `/health` requieren autenticación Bearer. Generar una clave:

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

O use el `docker-compose.yml` incluido que agrega volúmenes con nombre para configuración,
registros y espacio de trabajo del agente, además de un servicio Qdrant opcional para búsqueda semántica:

```bash
docker compose up -d
docker compose exec sidjua sidjua init
docker compose exec sidjua sidjua apply
```

---

## Proveedores

SIDJUA se conecta a cualquier proveedor LLM sin dependencia:

| Proveedor | Modelos | Clave API |
|-----------|---------|-----------|
| Anthropic | Claude Sonnet 4.6, Haiku 4.5, Opus 4.6 | `ANTHROPIC_API_KEY` |
| Google | Gemini 2.0, Gemini 1.5 Pro | `GOOGLE_API_KEY` |
| Groq | Llama 3.x, Mixtral | `GROQ_API_KEY` (nivel gratuito) |
| Cloudflare Workers AI | Llama, Mistral, Phi | `CF_ACCOUNT_ID` + `CF_TOKEN` |
| Ollama | Cualquier modelo local | Sin clave (local) |
| Compatible con OpenAI | Cualquier endpoint | URL personalizada + clave |

```bash
# Agregar una clave de proveedor
sidjua key set groq gsk_...

# Listar proveedores y modelos disponibles
sidjua provider list
```

---

## Hoja de ruta

Hoja de ruta completa en [sidjua.com/roadmap](https://sidjua.com/roadmap).

A corto plazo:
- Patrones de orquestación multi-agente (V1.1)
- Disparadores entrantes por webhook (V1.1)
- Comunicación agente a agente (V1.2)
- Integración SSO empresarial (V1.x)
- Servicio de validación de gobernanza alojado en la nube (V1.x)

---

## Comunidad

- **Discord**: [sidjua.com/discord](https://sidjua.com/discord)
- **GitHub Issues**: [github.com/GoetzKohlberg/sidjua/issues](https://github.com/GoetzKohlberg/sidjua/issues)
- **Email**: contact@sidjua.com
- **Documentación**: [sidjua.com/docs](https://sidjua.com/docs)

Si encuentra un error, abra un issue — actuamos rápido.

---

## Traducciones

SIDJUA está disponible en 26 idiomas. El inglés y el alemán son mantenidos por el equipo principal. Todas las demás traducciones son generadas por IA y mantenidas por la comunidad.

**Documentación:** Este README y la [Guía de instalación](docs/INSTALLATION.md) están disponibles en los 26 idiomas. Consulte el selector de idioma en la parte superior de esta página.

| Región | Idiomas |
|--------|---------|
| Américas | Inglés, Español, Portugués (Brasil) |
| Europa | Alemán, Francés, Italiano, Neerlandés, Polaco, Checo, Rumano, Ruso, Ucraniano, Sueco, Turco |
| Oriente Medio | Árabe |
| Asia | Hindi, Bengalí, Filipino, Indonesio, Malayo, Tailandés, Vietnamita, Japonés, Coreano, Chino (Simplificado), Chino (Tradicional) |

¿Encontró un error de traducción? Por favor abra un Issue de GitHub con:
- Idioma y código de locale (p. ej. `es`)
- El texto incorrecto o la clave del archivo de locale (p. ej. `gui.nav.dashboard`)
- La traducción correcta

¿Desea mantener un idioma? Consulte [CONTRIBUTING.md](CONTRIBUTING.md#translations) — usamos un modelo de mantenedor por idioma.

---

## Licencia

**AGPL-3.0** — puede usar, modificar y distribuir SIDJUA libremente siempre que
comparta las modificaciones bajo la misma licencia. El código fuente siempre está disponible
para los usuarios de un despliegue alojado.

Licencia empresarial disponible para organizaciones que requieren un despliegue
propietario sin obligaciones AGPL.
[contact@sidjua.com](mailto:contact@sidjua.com)
