[English](../../README.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [Français](README.fr.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [中文 (简体)](README.zh-CN.md) | [中文 (繁體)](README.zh-TW.md) | [العربية](README.ar.md) | [বাংলা](README.bn.md) | [Čeština](README.cs.md) | [Filipino](README.fil.md) | [हिन्दी](README.hi.md) | [Bahasa Indonesia](README.id.md) | [Italiano](README.it.md) | [Bahasa Melayu](README.ms.md) | [Nederlands](README.nl.md) | [Polski](README.pl.md) | [Português (BR)](README.pt-BR.md) | [Română](README.ro.md) | [Русский](README.ru.md) | [Svenska](README.sv.md) | [ภาษาไทย](README.th.md) | [Türkçe](README.tr.md) | [Українська](README.uk.md) | [Tiếng Việt](README.vi.md)

> *Cette page a été traduite automatiquement depuis [l'original anglais](../../README.md). Vous avez trouvé une erreur ? [Signalez-la](https://github.com/GoetzKohlberg/sidjua/issues).*

---

# SIDJUA — La Plateforme de Gouvernance pour Agents IA

> La seule plateforme d'agents où la gouvernance est imposée par l'architecture, et non par l'espoir que le modèle se comporte correctement.

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Docker](https://img.shields.io/badge/Docker-ghcr.io%2Fgoetzkohlberg%2Fsidjua-blue)](https://ghcr.io/goetzkohlberg/sidjua)
[![Version](https://img.shields.io/badge/version-1.0.0-green)](https://github.com/GoetzKohlberg/sidjua/releases)

---

## Installation

### Prérequis

| Outil | Requis | Notes |
|-------|--------|-------|
| **Node.js** | >= 22.0.0 | Modules ES, `fetch()`, `crypto.subtle`. [Télécharger](https://nodejs.org) |
| **Chaîne d'outils C/C++** | Compilations depuis les sources uniquement | `better-sqlite3` et `argon2` compilent des modules natifs |
| **Docker** | >= 24 (optionnel) | Uniquement pour le déploiement Docker |

Installer Node.js 22 : Ubuntu/Debian (`curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs`), macOS (`brew install node@22`), Windows (`winget install OpenJS.NodeJS.LTS`).

Installer les outils C/C++ : Ubuntu (`sudo apt-get install -y python3 make g++ build-essential`), macOS (`xcode-select --install`), Windows (`npm install --global windows-build-tools`).

### Option A — Docker (Recommandé)

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
docker compose up -d
```

```bash
# Afficher la clé API générée automatiquement
docker compose exec sidjua cat /app/.system/api-key

# Initialiser la gouvernance
docker compose exec sidjua sidjua apply --verbose

# Vérification de l'état du système
docker compose exec sidjua sidjua selftest
```

Compatible avec **linux/amd64** et **linux/arm64** (Raspberry Pi, Apple Silicon).

### Option B — Installation globale npm

```bash
npm install -g sidjua
sidjua init          # Configuration interactive en 3 étapes
sidjua chat guide    # Guide IA sans configuration (aucune clé API requise)
```

### Option C — Compilation depuis les sources

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
npm ci && npm run build
node dist/index.js --help
```

### Notes par plateforme

| Fonctionnalité | Linux | macOS | Windows (WSL2) | Windows (natif) |
|---------------|-------|-------|----------------|-----------------|
| CLI + REST API | ✅ Complet | ✅ Complet | ✅ Complet | ✅ Complet |
| Docker | ✅ Complet | ✅ Complet (Desktop) | ✅ Complet (Desktop) | ✅ Complet (Desktop) |
| Sandboxing (bubblewrap) | ✅ Complet | ❌ Bascule sur `none` | ✅ Complet (dans WSL2) | ❌ Bascule sur `none` |
| Web Management Console | ✅ Full | ✅ Full | ✅ Full | ✅ Full |

Aucune base de données externe requise. SIDJUA utilise SQLite. Qdrant est optionnel (recherche sémantique uniquement).

Consultez [docs/INSTALLATION.md](docs/INSTALLATION.md) pour le guide complet avec la structure des répertoires, les variables d'environnement, le dépannage par système d'exploitation et la référence des volumes Docker.

---

## Pourquoi SIDJUA ?

Tous les frameworks d'agents IA d'aujourd'hui reposent sur la même hypothèse défaillante : qu'on
peut faire confiance à l'IA pour suivre ses propres règles.

**Le problème avec la gouvernance basée sur les prompts :**

Vous donnez à un agent un prompt système qui dit « n'accède jamais aux PII des clients. » L'
agent lit l'instruction. L'agent lit également le message de l'utilisateur lui demandant de
récupérer l'historique des paiements de Jean Dupont. L'agent décide — de lui-même — s'il
doit obéir. Ce n'est pas de la gouvernance. C'est une suggestion formulée fermement.

**SIDJUA est différent.**

La gouvernance se situe **en dehors** de l'agent. Chaque action passe par un pipeline
d'application préalable en 5 étapes **avant** de s'exécuter. Vous définissez des règles en
YAML. Le système les applique. L'agent ne peut jamais décider de les suivre ou non, car
la vérification se produit avant que l'agent agisse.

C'est la gouvernance par l'architecture — pas par le prompting, pas par le fine-tuning,
pas par l'espoir.

---

## Comment ça fonctionne

SIDJUA enveloppe vos agents dans une couche de gouvernance externe. L'appel LLM
de l'agent ne se produit jamais tant que l'action proposée n'a pas franchi un pipeline
d'application en 5 étapes :

**Étape 1 — Interdit :** Les actions bloquées sont rejetées immédiatement. Pas d'appel LLM,
pas d'entrée de journal marquée « autorisée », pas de deuxième chance. Si l'action figure sur
la liste des interdits, elle s'arrête ici.

**Étape 2 — Approbation :** Les actions qui nécessitent une validation humaine sont retenues pour
approbation avant l'exécution. L'agent attend. L'humain décide.

**Étape 3 — Budget :** Chaque tâche s'exécute contre des limites de coût en temps réel. Les
budgets par tâche et par agent sont appliqués. Lorsque la limite est atteinte, la tâche est
annulée — pas marquée, pas enregistrée pour révision, *annulée*.

**Étape 4 — Classification :** Les données qui franchissent les limites de division sont vérifiées
par rapport aux règles de classification. Un agent de Tier 2 ne peut pas accéder aux données SECRET. Un
agent dans la Division A ne peut pas lire les secrets de la Division B.

**Étape 5 — Politique :** Règles organisationnelles personnalisées, appliquées structurellement. Limites de
fréquence des appels API, plafonds de tokens en sortie, restrictions de fenêtre temporelle.

L'intégralité du pipeline s'exécute avant toute action. Il n'existe pas de mode « enregistrer et
réviser plus tard » pour les opérations critiques de gouvernance.

### Fichier de configuration unique

Toute votre organisation d'agents réside dans un `divisions.yaml` :

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

`sidjua apply` lit ce fichier et provisionne l'infrastructure complète des agents :
agents, divisions, RBAC, routage, tables d'audit, chemins de secrets et règles de
gouvernance — en 10 étapes reproductibles.

### Architecture des agents

Les agents sont organisés en **divisions** (groupes fonctionnels) et **tiers**
(niveaux de confiance). Les agents de Tier 1 ont une pleine autonomie dans leur
enveloppe de gouvernance. Les agents de Tier 2 nécessitent une approbation pour les opérations sensibles. Les
agents de Tier 3 sont entièrement supervisés. Le système de tiers est appliqué structurellement —
un agent ne peut pas s'auto-promouvoir.

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

## Contraintes d'architecture

SIDJUA impose ces contraintes au niveau de l'architecture — elles ne peuvent pas être
désactivées, contournées ou annulées par les agents :

1. **La gouvernance est externe** : La couche de gouvernance enveloppe l'agent. L'agent
   n'a pas accès au code de gouvernance, ne peut pas modifier les règles et ne peut pas détecter
   si la gouvernance est présente.

2. **Pré-action, pas post-action** : Chaque action est vérifiée AVANT l'exécution.
   Il n'existe pas de mode « enregistrer et réviser plus tard » pour les opérations critiques de gouvernance.

3. **Application structurelle** : Les règles sont appliquées par des chemins de code, pas par
   des prompts ou des instructions du modèle. Un agent ne peut pas « jailbreaker » la
   gouvernance car elle n'est pas implémentée comme des instructions au modèle.

4. **Immuabilité de l'audit** : Le Write-Ahead Log (WAL) est en ajout seul avec
   vérification d'intégrité. Les entrées falsifiées sont détectées et exclues.

5. **Isolation des divisions** : Les agents dans différentes divisions ne peuvent pas accéder
   aux données, secrets ou canaux de communication des autres.

---

## Comparaison

| Fonctionnalité | SIDJUA | CrewAI | AutoGen | LangGraph | OpenClaw |
|---------------|--------|--------|---------|-----------|----------|
| Gouvernance externe | ✅ Architecture | ❌ | ❌ | ❌ | ❌ |
| Application pré-action | ✅ Pipeline en 5 étapes | ❌ | ❌ | ❌ | ❌ |
| Conforme EU AI Act | ✅ | ❌ | ❌ | ❌ | ❌ |
| Auto-hébergé | ✅ | ❌ Cloud | ❌ Cloud | ❌ Cloud | ✅ Plugin |
| Capable air-gap | ✅ | ❌ | ❌ | ❌ | ❌ |
| Agnostique au modèle | ✅ N'importe quel LLM | Partiel | Partiel | Partiel | ✅ |
| Email bidirectionnel | ✅ | ❌ | ❌ | ❌ | ❌ |
| Passerelle Discord | ✅ | ❌ | ❌ | ❌ | ❌ |
| Agents hiérarchiques | ✅ Divisions + Tiers | Basique | Basique | Graphe | ❌ |
| Application du budget | ✅ Limites par agent | ❌ | ❌ | ❌ | ❌ |
| Isolation sandbox | ✅ bubblewrap | ❌ | ❌ | ❌ | ❌ |
| Immuabilité de l'audit | ✅ WAL + intégrité | ❌ | ❌ | ❌ | ❌ |
| Licence | AGPL-3.0 | MIT | MIT | MIT | Mixte |
| Audits indépendants | ✅ 2 Externes | ❌ | ❌ | ❌ | ❌ |

---

## Fonctionnalités

### Gouvernance et Conformité

**Pipeline pré-action (Étape 0)** s'exécute avant chaque action de l'agent : Vérification
d'interdiction → Approbation humaine → Application du budget → Classification des données → Politique
personnalisée. Les cinq étapes sont structurelles — elles s'exécutent dans le code, pas dans
le prompt de l'agent.

**Règles de base obligatoires** livrées avec chaque installation : 10 règles de gouvernance
(`SYS-SEC-001` à `SYS-GOV-002`) qui ne peuvent être ni supprimées ni affaiblies par la
configuration utilisateur. Les règles personnalisées étendent la base ; elles ne peuvent pas l'annuler.

**Conformité EU AI Act** — le journal d'audit, le cadre de classification et les flux
de travail d'approbation correspondent directement aux exigences des Articles 9, 12 et 17. L'échéance
de conformité d'août 2026 est intégrée dans la feuille de route du produit.

**Rapports de conformité** via `sidjua audit report/violations/agents/export` :
score de conformité, scores de confiance par agent, historique des violations, export CSV/JSON
pour les auditeurs externes ou l'intégration SIEM.

**Write-Ahead Log (WAL)** avec vérification d'intégrité : chaque décision de gouvernance est
écrite dans un journal en ajout seul avant l'exécution. Les entrées falsifiées sont détectées
à la lecture. `sidjua memory recover` re-valide et répare.

### Communication

Les agents ne se contentent pas de répondre aux appels API — ils participent à de vrais canaux
de communication.

**Email bidirectionnel** (`sidjua email status/test/threads`) : les agents reçoivent
des emails via sondage IMAP et répondent via SMTP. Le mappage des fils de discussion via les en-têtes
In-Reply-To maintient la cohérence des conversations. La liste blanche des expéditeurs, les limites
de taille du corps et la suppression du HTML protègent le pipeline de l'agent des entrées malveillantes.

**Bot passerelle Discord** : interface complète de commandes slash via `sidjua module install
discord`. Les agents répondent aux messages Discord, maintiennent des fils de conversation
et envoient des notifications proactives.

**Intégration Telegram** : alertes et notifications de l'agent via bot Telegram.
Le modèle d'adaptateur multicanal prend en charge Telegram, Discord, ntfy et Email en
parallèle.

### Opérations

**Une seule commande Docker** pour la production :

```bash
docker run -p 4200:4200 ghcr.io/goetzkohlberg/sidjua:latest
```

La clé API est générée automatiquement au premier démarrage et affichée dans les journaux du
conteneur. Aucune variable d'environnement requise. Aucune configuration requise. Aucun serveur
de base de données requis — SIDJUA utilise SQLite, un fichier de base de données par agent.

**Gestion CLI** — cycle de vie complet depuis un seul binaire :

```bash
sidjua init                      # Configuration interactive de l'espace de travail (3 étapes)
sidjua apply                     # Provisionnement depuis divisions.yaml
sidjua agent create/list/stop    # Cycle de vie de l'agent
sidjua run "task..." --wait      # Soumettre une tâche avec application de gouvernance
sidjua audit report              # Rapport de conformité
sidjua costs                     # Ventilation des coûts par division/agent
sidjua backup create/restore     # Gestion des sauvegardes signées HMAC
sidjua update                    # Mise à jour de version avec sauvegarde préalable automatique
sidjua rollback                  # Restauration en 1 clic vers la version précédente
sidjua email status/test         # Gestion du canal email
sidjua secret set/get/rotate     # Gestion des secrets chiffrés
sidjua memory import/search      # Pipeline de connaissance sémantique
sidjua selftest                  # Vérification de l'état du système (7 catégories, score 0-100)
```

**Mémoire sémantique** — importer des conversations et des documents (`sidjua memory import
~/exports/claude-chats.zip`), rechercher avec un classement hybride vectoriel + BM25. Compatible avec
les embeddings Cloudflare Workers AI (gratuit, sans configuration) et les grands embeddings OpenAI
(qualité supérieure pour les grandes bases de connaissances).

**Découpage adaptatif** — le pipeline de mémoire ajuste automatiquement les tailles de fragments
pour rester dans la limite de tokens de chaque modèle d'embedding.

**Guide sans configuration** — `sidjua chat guide` lance un assistant IA interactif
sans aucune clé API, alimenté par Cloudflare Workers AI via le proxy SIDJUA.
Demandez-lui comment configurer des agents, paramétrer la gouvernance ou comprendre ce qui s'est
passé dans le journal d'audit.

**Déploiement air-gap** — fonctionner entièrement déconnecté d'Internet en utilisant des
LLMs locaux via Ollama ou tout point de terminaison compatible OpenAI. Pas de télémétrie par défaut.
Rapport de plantage opt-in avec rédaction complète des PII.

### Sécurité

**Isolation sandbox** — les compétences des agents s'exécutent dans l'isolation de processus au niveau
du système d'exploitation via bubblewrap (espaces de noms utilisateur Linux). Aucune surcharge RAM
supplémentaire. Interface `SandboxProvider` enfichable : `none` pour le développement, `bubblewrap`
pour la production.

**Gestion des secrets** — magasin de secrets chiffré avec RBAC (`sidjua secret
set/get/list/delete/rotate/namespaces`). Aucun coffre-fort externe requis.

**Build orienté sécurité** — suite de tests interne étendue plus validation indépendante
par 2 auditeurs de code externes (DeepSeek V3 et xAI Grok). En-têtes de sécurité,
protection CSRF, limitation de débit et assainissement des entrées sur chaque surface API.
Prévention de l'injection SQL avec des requêtes paramétrées partout.

**Intégrité des sauvegardes** — archives de sauvegarde signées HMAC avec protection zip-slip,
prévention des bombes zip et vérification de la somme de contrôle du manifeste lors de la restauration.

---

## Importation depuis d'autres frameworks

```bash
# Aperçu de ce qui sera importé — aucune modification effectuée
sidjua import openclaw --dry-run

# Importer la configuration + les fichiers de compétences
sidjua import openclaw --skills
```

Vos agents existants conservent leur identité, leurs modèles et leurs compétences. SIDJUA ajoute
automatiquement la gouvernance, les pistes d'audit et les contrôles budgétaires.

---

## Référence de configuration

Un `divisions.yaml` minimal pour démarrer :

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

`sidjua apply` provisionne l'infrastructure complète depuis ce fichier. Exécutez-le
à nouveau après les modifications — il est idempotent.

Consultez [docs/SIDJUA-APPLY-TECH-SPEC-V1.md](docs/SIDJUA-APPLY-TECH-SPEC-V1.md)
pour la spécification complète des 10 étapes de provisionnement.

---

## REST API

La REST API de SIDJUA fonctionne sur le même port que le tableau de bord :

```bash
sidjua server start --port 4200 --api-key $SIDJUA_API_KEY
```

Points de terminaison clés :

```
GET  /api/v1/health          # Vérification de santé publique (sans auth)
GET  /api/v1/info            # Métadonnées du système (authentifié)
POST /api/v1/execute/run     # Soumettre une tâche
GET  /api/v1/execute/:id/status  # Statut de la tâche
GET  /api/v1/execute/:id/result  # Résultat de la tâche
GET  /api/v1/events          # Flux d'événements SSE
GET  /api/v1/audit/report    # Rapport de conformité
```

Tous les points de terminaison sauf `/health` nécessitent une authentification Bearer. Générer une clé :

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

Ou utilisez le `docker-compose.yml` inclus qui ajoute des volumes nommés pour la configuration,
les journaux et l'espace de travail des agents, ainsi qu'un service Qdrant optionnel pour la recherche sémantique :

```bash
docker compose up -d
docker compose exec sidjua sidjua init
docker compose exec sidjua sidjua apply
```

---

## Fournisseurs

SIDJUA se connecte à n'importe quel fournisseur LLM sans dépendance :

| Fournisseur | Modèles | Clé API |
|-------------|---------|---------|
| Anthropic | Claude Sonnet 4.6, Haiku 4.5, Opus 4.6 | `ANTHROPIC_API_KEY` |
| Google | Gemini 2.0, Gemini 1.5 Pro | `GOOGLE_API_KEY` |
| Groq | Llama 3.x, Mixtral | `GROQ_API_KEY` (niveau gratuit) |
| Cloudflare Workers AI | Llama, Mistral, Phi | `CF_ACCOUNT_ID` + `CF_TOKEN` |
| Ollama | N'importe quel modèle local | Pas de clé (local) |
| Compatible OpenAI | N'importe quel point de terminaison | URL personnalisée + clé |

```bash
# Ajouter une clé de fournisseur
sidjua key set groq gsk_...

# Lister les fournisseurs et modèles disponibles
sidjua provider list
```

---

## Feuille de route

Feuille de route complète sur [sidjua.com/roadmap](https://sidjua.com/roadmap).

À court terme :
- Modèles d'orchestration multi-agents (V1.1)
- Déclencheurs entrants par webhook (V1.1)
- Communication agent à agent (V1.2)
- Intégration SSO entreprise (V1.x)
- Service de validation de gouvernance hébergé dans le cloud (V1.x)

---

## Communauté

- **Discord** : [sidjua.com/discord](https://sidjua.com/discord)
- **GitHub Issues** : [github.com/GoetzKohlberg/sidjua/issues](https://github.com/GoetzKohlberg/sidjua/issues)
- **Email** : contact@sidjua.com
- **Documentation** : [sidjua.com/docs](https://sidjua.com/docs)

Si vous trouvez un bug, ouvrez un issue — nous agissons rapidement.

---

## Traductions

SIDJUA est disponible en 26 langues. L'anglais et l'allemand sont maintenus par l'équipe principale. Toutes les autres traductions sont générées par IA et maintenues par la communauté.

**Documentation :** Ce README et le [Guide d'installation](docs/INSTALLATION.md) sont disponibles dans les 26 langues. Consultez le sélecteur de langue en haut de cette page.

| Région | Langues |
|--------|---------|
| Amériques | Anglais, Espagnol, Portugais (Brésil) |
| Europe | Allemand, Français, Italien, Néerlandais, Polonais, Tchèque, Roumain, Russe, Ukrainien, Suédois, Turc |
| Moyen-Orient | Arabe |
| Asie | Hindi, Bengali, Filipino, Indonésien, Malais, Thaï, Vietnamien, Japonais, Coréen, Chinois (Simplifié), Chinois (Traditionnel) |

Vous avez trouvé une erreur de traduction ? Veuillez ouvrir un Issue GitHub avec :
- La langue et le code de locale (ex. `fr`)
- Le texte incorrect ou la clé du fichier de locale (ex. `gui.nav.dashboard`)
- La traduction correcte

Vous souhaitez maintenir une langue ? Consultez [CONTRIBUTING.md](CONTRIBUTING.md#translations) — nous utilisons un modèle de mainteneur par langue.

---

## Licence

**AGPL-3.0** — vous pouvez utiliser, modifier et distribuer SIDJUA librement tant que
vous partagez les modifications sous la même licence. Le code source est toujours disponible
pour les utilisateurs d'un déploiement hébergé.

Licence entreprise disponible pour les organisations qui nécessitent un déploiement
propriétaire sans obligations AGPL.
[contact@sidjua.com](mailto:contact@sidjua.com)
