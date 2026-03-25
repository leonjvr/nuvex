> Ce document a été traduit par IA depuis [l'original anglais](../INSTALLATION.md). Vous avez trouvé une erreur ? [Signalez-la](https://github.com/GoetzKohlberg/sidjua/issues).

# Guide d'Installation SIDJUA

SIDJUA version : 1.0.0 | Licence : AGPL-3.0-only | Mis à jour : 2026-03-25

## Table des Matières

1. [Matrice de Compatibilité des Plateformes](#1-matrice-de-compatibilité-des-plateformes)
2. [Prérequis](#2-prérequis)
3. [Méthodes d'Installation](#3-méthodes-dinstallation)
4. [Structure des Répertoires](#4-structure-des-répertoires)
5. [Variables d'Environnement](#5-variables-denvironnement)
6. [Configuration des Fournisseurs](#6-configuration-des-fournisseurs)
7. [Interface Graphique de Bureau (Optionnel)](#7-interface-graphique-de-bureau-optionnel)
8. [Sandboxing des Agents](#8-sandboxing-des-agents)
9. [Recherche Sémantique (Optionnel)](#9-recherche-sémantique-optionnel)
10. [Résolution des Problèmes](#10-résolution-des-problèmes)
11. [Référence des Volumes Docker](#11-référence-des-volumes-docker)
12. [Mise à Jour](#12-mise-à-jour)
13. [Prochaines Étapes](#13-prochaines-étapes)

---

## 1. Matrice de Compatibilité des Plateformes

| Fonctionnalité | Linux | macOS | Windows WSL2 | Windows (natif) |
|---------|-------|-------|--------------|------------------|
| CLI + REST API | ✅ Complet | ✅ Complet | ✅ Complet | ✅ Complet |
| Docker | ✅ Complet | ✅ Docker Desktop | ✅ Docker Desktop | ✅ Docker Desktop |
| Sandboxing (bubblewrap) | ✅ Complet | ❌ Repli sur `none` | ✅ Complet (dans WSL2) | ❌ Repli sur `none` |
| Web Management Console | ✅ Full | ✅ Full | ✅ Full | ✅ Full |
| Recherche Sémantique (Qdrant) | ✅ | ✅ | ✅ | ✅ |

**Note sur bubblewrap :** Sandboxing par espace de noms utilisateur Linux. macOS et Windows natif basculent automatiquement vers le mode sandbox `none` — aucune configuration requise.

---

## 2. Prérequis

### Node.js >= 22.0.0

**Pourquoi :** SIDJUA utilise les modules ES, le `fetch()` natif et `crypto.subtle` — tout cela nécessite Node.js 22+.

**Ubuntu / Debian :**
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

**Fedora / RHEL / CentOS :**
```bash
curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
sudo dnf install -y nodejs
```

**Arch Linux :**
```bash
sudo pacman -S nodejs npm
```

**macOS (Homebrew) :**
```bash
brew install node@22
echo 'export PATH="/opt/homebrew/opt/node@22/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

**macOS (installateur .pkg) :** Télécharger depuis [nodejs.org/en/download](https://nodejs.org/en/download).

**Windows (winget) :**
```powershell
winget install OpenJS.NodeJS.LTS
```

**Windows (.msi) :** Télécharger depuis [nodejs.org/en/download](https://nodejs.org/en/download).

**WSL2 :** Utilisez les instructions Ubuntu/Debian ci-dessus dans votre terminal WSL2.

Vérification :
```bash
node --version   # doit être >= 22.0.0
npm --version    # doit être >= 10.0.0
```

---

### Chaîne d'Outils C/C++ (uniquement pour les compilations depuis les sources)

**Pourquoi :** `better-sqlite3` et `argon2` compilent des modules complémentaires natifs Node.js pendant `npm ci`. Les utilisateurs Docker peuvent ignorer cette étape.

**Ubuntu / Debian :**
```bash
sudo apt-get install -y python3 make g++ build-essential linux-headers-$(uname -r)
```

**Fedora / RHEL :**
```bash
sudo dnf groupinstall "Development Tools"
sudo dnf install python3
```

**Arch Linux :**
```bash
sudo pacman -S base-devel python
```

**macOS :**
```bash
xcode-select --install
```

**Windows :** Installez [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) avec la charge de travail **Développement Desktop en C++**, puis :
```powershell
npm install --global windows-build-tools
```

**Alpine Linux :**
```bash
apk add python3 make g++ build-base linux-headers
```

---

### Docker >= 24 (optionnel)

Requis uniquement pour la méthode d'installation Docker. Le plugin Docker Compose V2 (`docker compose`) doit être disponible.

**Linux :** Suivez les instructions sur [docs.docker.com/engine/install](https://docs.docker.com/engine/install/).
Docker Compose V2 est inclus avec Docker Engine >= 24.

**macOS / Windows :** Installez [Docker Desktop](https://www.docker.com/products/docker-desktop/) (inclut Docker Compose V2).

Vérification :
```bash
docker --version          # doit être >= 24.0.0
docker compose version    # doit afficher v2.x.x
```

---

### Git

Toute version récente. Installez via votre gestionnaire de paquets de système d'exploitation ou [git-scm.com](https://git-scm.com).

---

## 3. Méthodes d'Installation

### Méthode A — Docker (Recommandé)

La méthode la plus rapide pour obtenir une installation SIDJUA fonctionnelle. Toutes les dépendances sont regroupées dans l'image.

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
docker compose up -d
```

Attendez que les services soient opérationnels (jusqu'à ~60 secondes lors de la première compilation) :

```bash
docker compose ps
# NAME              STATUS
# sidjua            Up X seconds (healthy)
# sidjua-qdrant     Up X seconds (healthy)
```

Récupérer la clé API générée automatiquement :

```bash
docker compose exec sidjua cat /app/.system/api-key
```

Initialiser la gouvernance depuis votre `divisions.yaml` :

```bash
docker compose exec sidjua sidjua apply --verbose
```

Exécuter la vérification de santé du système :

```bash
docker compose exec sidjua sidjua selftest
```

**Note ARM64 :** L'image Docker est construite sur `node:22-alpine` qui prend en charge `linux/amd64` et `linux/arm64`. Raspberry Pi (64 bits) et les Macs Apple Silicon (via Docker Desktop) sont pris en charge nativement.

**Bubblewrap dans Docker :** Pour activer le sandboxing des agents à l'intérieur du conteneur, ajoutez `--cap-add=SYS_ADMIN` à votre commande Docker run ou définissez-le dans `docker-compose.yml` :
```yaml
cap_add:
  - SYS_ADMIN
```

---

### Méthode B — Installation Globale npm

```bash
npm install -g sidjua
```

Exécuter l'assistant de configuration interactif (3 étapes : emplacement de l'espace de travail, fournisseur, premier agent) :
```bash
sidjua init
```

Pour les environnements CI ou conteneurs non interactifs :
```bash
sidjua init --yes
```

Démarrer le guide IA sans configuration (aucune clé API requise) :
```bash
sidjua chat guide
```

---

### Méthode C — Compilation depuis les Sources

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
npm ci
npm run build
```

Le processus de compilation utilise `tsup` pour compiler `src/index.ts` en :
- `dist/index.js` (ESM)
- `dist/index.cjs` (CommonJS)

Les étapes post-compilation copient les fichiers de paramètres régionaux i18n, les rôles par défaut, les divisions et les modèles de base de connaissances dans `dist/`.

Exécuter depuis les sources :
```bash
node dist/index.js --help
```

Exécuter la suite de tests :
```bash
npm test                    # tous les tests
npm run test:coverage       # avec rapport de couverture
npx tsc --noEmit            # vérification de types uniquement
```

---

## 4. Structure des Répertoires

### Chemins de Déploiement Docker

| Chemin | Volume Docker | Objectif | Géré par |
|------|---------------|---------|------------|
| `/app/dist/` | Couche d'image | Application compilée | SIDJUA |
| `/app/node_modules/` | Couche d'image | Dépendances Node.js | SIDJUA |
| `/app/system/` | Couche d'image | Valeurs par défaut et modèles intégrés | SIDJUA |
| `/app/defaults/` | Couche d'image | Fichiers de configuration par défaut | SIDJUA |
| `/app/docs/` | Couche d'image | Documentation incluse | SIDJUA |
| `/app/data/` | `sidjua-data` | Bases de données SQLite, sauvegardes, collections de connaissances | Utilisateur |
| `/app/config/` | `sidjua-config` | `divisions.yaml` et configuration personnalisée | Utilisateur |
| `/app/logs/` | `sidjua-logs` | Fichiers journaux structurés | Utilisateur |
| `/app/.system/` | `sidjua-system` | Clé API, état de mise à jour, verrou de processus | Géré par SIDJUA |
| `/app/agents/` | `sidjua-workspace` | Définitions d'agents, compétences, modèles | Utilisateur |
| `/app/governance/` | `sidjua-governance` | Piste d'audit, instantanés de gouvernance | Utilisateur |

---

### Chemins d'Installation Manuelle / npm

Après `sidjua init`, votre espace de travail est organisé comme suit :

```
~/sidjua-workspace/           # ou SIDJUA_CONFIG_DIR
├── divisions.yaml            # Votre configuration de gouvernance
├── .sidjua/                  # État interne (WAL, tampon de télémétrie)
│   └── telemetry.db
├── data/
│   ├── sidjua.db             # Base de données principale (agents, tâches, audit, coûts)
│   ├── knowledge/            # Bases de données de connaissances par agent
│   │   └── <agent-id>.db
│   └── backups/              # Archives de sauvegarde signées HMAC
├── agents/                   # Répertoires de compétences des agents
├── governance/               # Piste d'audit (ajout uniquement)
├── logs/                     # Journaux d'application
└── system/                   # État d'exécution
```

---

### Bases de Données SQLite

| Base de Données | Chemin | Contenu |
|----------|------|----------|
| Principale | `data/sidjua.db` | Agents, tâches, coûts, instantanés de gouvernance, clés API, journal d'audit |
| Télémétrie | `.sidjua/telemetry.db` | Rapports d'erreurs optionnels avec consentement (avec PII supprimé) |
| Connaissances | `data/knowledge/<agent-id>.db` | Embeddings vectoriels par agent et index BM25 |

Les bases de données SQLite sont des fichiers uniques, multiplateformes et portables. Sauvegardez-les avec `sidjua backup create`.

---

## 5. Variables d'Environnement

Copiez `.env.example` vers `.env` et personnalisez. Toutes les variables sont optionnelles sauf indication contraire.

### Serveur

| Variable | Par Défaut | Description |
|----------|---------|-------------|
| `SIDJUA_PORT` | `3000` | Port d'écoute de la REST API |
| `SIDJUA_HOST` | `127.0.0.1` | Adresse de liaison de la REST API. Utilisez `0.0.0.0` pour l'accès distant |
| `NODE_ENV` | `production` | Mode d'exécution (`production` ou `development`) |
| `SIDJUA_API_KEY` | Généré automatiquement | Jeton bearer de la REST API. Créé automatiquement au premier démarrage si absent |
| `SIDJUA_MAX_BODY_SIZE` | `2097152` (2 MiB) | Taille maximale du corps de la requête entrante en octets |

### Remplacements de Répertoires

| Variable | Par Défaut | Description |
|----------|---------|-------------|
| `SIDJUA_DATA_DIR` | `<workspace>/data` | Remplacer l'emplacement du répertoire de données |
| `SIDJUA_CONFIG_DIR` | `<workspace>` | Remplacer l'emplacement du répertoire de configuration |
| `SIDJUA_LOG_DIR` | `<workspace>/logs` | Remplacer l'emplacement du répertoire des journaux |

### Recherche Sémantique

| Variable | Par Défaut | Description |
|----------|---------|-------------|
| `SIDJUA_QDRANT_URL` | `http://localhost:6333` | Point de terminaison de la base de données vectorielle Qdrant. Par défaut Docker : `http://qdrant:6333` |
| `OPENAI_API_KEY` | — | Requis pour les embeddings `text-embedding-3-large` d'OpenAI |
| `SIDJUA_CF_ACCOUNT_ID` | — | ID de compte Cloudflare pour les embeddings gratuits |
| `SIDJUA_CF_TOKEN` | — | Jeton API Cloudflare pour les embeddings gratuits |

### Fournisseurs LLM

| Variable | Fournisseur |
|----------|----------|
| `ANTHROPIC_API_KEY` | Anthropic (Claude) |
| `OPENAI_API_KEY` | OpenAI (GPT-4, embeddings) |
| `GOOGLE_AI_API_KEY` | Google AI (Gemini) |
| `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` | Cloudflare Workers AI (niveau gratuit) |
| `GROQ_API_KEY` | Groq (inférence rapide, niveau gratuit disponible) |
| `DEEPSEEK_API_KEY` | DeepSeek |

---

## 6. Configuration des Fournisseurs

### Option Sans Configuration

`sidjua chat guide` fonctionne sans aucune clé API. Il se connecte à Cloudflare Workers AI via le proxy SIDJUA. Limité en débit mais adapté à l'évaluation et à l'intégration.

### Ajouter Votre Premier Fournisseur

**Groq (niveau gratuit, aucune carte de crédit requise) :**
```bash
sidjua key set groq <your-groq-api-key>
sidjua provider list
```
Obtenez une clé gratuite sur [console.groq.com](https://console.groq.com).

**Anthropic (recommandé pour la production) :**
```bash
export ANTHROPIC_API_KEY=sk-ant-...
sidjua key set anthropic $ANTHROPIC_API_KEY
```

**Ollama (déploiement isolé / local) :**
```bash
sidjua provider add-custom \
  --id ollama \
  --name "Ollama (local)" \
  --base-url http://localhost:11434/v1 \
  --model llama3.2
```

Valider tous les fournisseurs configurés :
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

## 8. Sandboxing des Agents

SIDJUA utilise une interface `SandboxProvider` enfichable. Le sandbox enveloppe l'exécution des compétences des agents dans un isolement de processus au niveau du système d'exploitation.

### Prise en Charge du Sandbox par Plateforme

| Plateforme | Fournisseur de Sandbox | Notes |
|----------|-----------------|-------|
| Linux (natif) | `bubblewrap` | Isolation complète par espace de noms utilisateur |
| Docker (conteneur Linux) | `bubblewrap` | Nécessite `--cap-add=SYS_ADMIN` |
| macOS | `none` (repli automatique) | macOS ne prend pas en charge les espaces de noms utilisateur Linux |
| Windows WSL2 | `bubblewrap` | Installer comme sur Linux dans WSL2 |
| Windows (natif) | `none` (repli automatique) | |

### Installation de bubblewrap (Linux)

**Ubuntu / Debian :**
```bash
sudo apt-get install -y bubblewrap socat
```

**Fedora / RHEL :**
```bash
sudo dnf install -y bubblewrap socat
```

**Arch Linux :**
```bash
sudo pacman -S bubblewrap socat
```

### Configuration

Dans `divisions.yaml` :
```yaml
governance:
  sandbox: bubblewrap    # ou : none
```

Vérifier la disponibilité du sandbox :
```bash
sidjua sandbox check
```

---

## 9. Recherche Sémantique (Optionnel)

La recherche sémantique alimente `sidjua memory search` et la récupération de connaissances des agents. Elle nécessite une base de données vectorielle Qdrant et un fournisseur d'embeddings.

### Profil Docker Compose

Le `docker-compose.yml` inclus possède un profil `semantic-search` :
```bash
docker compose --profile semantic-search up -d
```
Cela démarre un conteneur Qdrant aux côtés de SIDJUA.

### Qdrant Autonome

```bash
docker run -d \
  --name sidjua-qdrant \
  -p 6333:6333 \
  -v qdrant-storage:/qdrant/storage \
  qdrant/qdrant:v1.13.2
```

Définir le point de terminaison :
```bash
export SIDJUA_QDRANT_URL=http://localhost:6333
```

### Sans Qdrant

Si Qdrant n'est pas disponible, `sidjua memory import` et `sidjua memory search` sont désactivés. Toutes les autres fonctionnalités SIDJUA (CLI, REST API, exécution des agents, gouvernance, audit) fonctionnent normalement. Le système bascule vers la recherche par mots-clés BM25 pour toutes les requêtes de connaissances.

---

## 10. Résolution des Problèmes

### Toutes les Plateformes

**`npm ci` échoue avec des erreurs `node-pre-gyp` ou `node-gyp` :**
```
gyp ERR! build error
```
Installez la chaîne d'outils C/C++ (voir la section Prérequis). Sur Ubuntu : `sudo apt-get install -y python3 make g++ build-essential`.

**`Cannot find divisions.yaml` :**
Vérifiez `SIDJUA_CONFIG_DIR`. Le fichier doit se trouver à `$SIDJUA_CONFIG_DIR/divisions.yaml`. Exécutez `sidjua init` pour créer la structure de l'espace de travail.

**La REST API retourne 401 Unauthorized :**
Vérifiez l'en-tête `Authorization: Bearer <key>`. Récupérez la clé générée automatiquement avec :
```bash
cat ~/.sidjua/.system/api-key          # installation manuelle
docker compose exec sidjua cat /app/.system/api-key  # Docker
```

**Port 3000 déjà utilisé :**
```bash
SIDJUA_PORT=3001 sidjua server start
# ou définir dans .env : SIDJUA_PORT=3001
```

---

### Ubuntu / Debian

**`better-sqlite3` ne compile pas, `futex.h` introuvable :**
```bash
sudo apt-get install -y linux-headers-$(uname -r)
```

---

### Fedora / RHEL

**SELinux bloque les montages de volumes Docker :**
```yaml
# Ajouter l'étiquette :Z pour le contexte SELinux
volumes:
  - ./my-config:/app/config:Z
```
Ou définir le contexte SELinux manuellement :
```bash
chcon -Rt svirt_sandbox_file_t ./my-config
```

---

### Arch Linux

**Version de Node.js trop ancienne :**
Utilisez `nvm` pour installer Node.js 22 :
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
nvm install 22
nvm use 22
```

---

### macOS

**`xcrun: error: invalid active developer path` :**
```bash
xcode-select --install
```

**Docker Desktop manque de mémoire :**
Ouvrez Docker Desktop → Paramètres → Ressources → Mémoire. Augmentez à au moins 4 Go.

**Apple Silicon — incompatibilité d'architecture :**
Vérifiez que votre installation Node.js est native ARM64 (pas Rosetta) :
```bash
node -e "console.log(process.arch)"
# attendu : arm64
```
Si `x64` s'affiche, réinstallez Node.js avec le programme d'installation ARM64 depuis nodejs.org.

---

### Windows (natif)

**`MSBuild` ou `cl.exe` introuvable :**
Installez [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) et sélectionnez la charge de travail **Développement Desktop en C++**. Puis exécutez :
```powershell
npm install --global windows-build-tools
```

**Erreurs de chemin long (`ENAMETOOLONG`) :**
Activez la prise en charge des chemins longs dans le registre Windows :
```powershell
# Exécuter en tant qu'Administrateur
Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" `
  -Name LongPathsEnabled -Value 1
```

**Commande `sidjua` introuvable après `npm install -g` :**
Ajoutez le répertoire bin global npm à votre PATH :
```powershell
npm config get prefix  # affiche par ex. C:\Users\you\AppData\Roaming\npm
# Ajoutez ce chemin aux Variables d'environnement système → Chemin
```

---

### Windows WSL2

**Docker ne démarre pas dans WSL2 :**
Ouvrez Docker Desktop → Paramètres → Général → activez **Utiliser le moteur basé sur WSL 2**.
Puis redémarrez Docker Desktop et votre terminal WSL2.

**Erreurs de permissions sur les fichiers sous `/mnt/c/` :**
Les volumes Windows NTFS montés dans WSL2 ont des permissions restreintes. Déplacez votre espace de travail vers un chemin Linux natif :
```bash
mkdir ~/sidjua-workspace
cd ~/sidjua-workspace
sidjua init
```

---

### Raspberry Pi / ARM64

**`npm ci` est très lent (5-10 minutes) :**
C'est normal. La compilation des modules complémentaires natifs sur ARM64 prend plus de temps. Envisagez plutôt d'utiliser l'image Docker :
```bash
docker pull sidjua/sidjua:latest-arm64
```

**Mémoire insuffisante pendant la compilation :**
Ajouter de l'espace d'échange :
```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

---

## 11. Référence des Volumes Docker

### Volumes Nommés

| Nom du Volume | Chemin du Conteneur | Objectif |
|-------------|---------------|---------|
| `sidjua-data` | `/app/data` | Bases de données SQLite, archives de sauvegarde, collections de connaissances |
| `sidjua-config` | `/app/config` | `divisions.yaml`, configuration personnalisée |
| `sidjua-logs` | `/app/logs` | Journaux d'application structurés |
| `sidjua-system` | `/app/.system` | Clé API, état de mise à jour, fichier de verrou de processus |
| `sidjua-workspace` | `/app/agents` | Répertoires de compétences des agents, définitions, modèles |
| `sidjua-governance` | `/app/governance` | Piste d'audit immuable, instantanés de gouvernance |
| `qdrant-storage` | `/qdrant/storage` | Index vectoriel Qdrant (profil de recherche sémantique uniquement) |

### Utiliser un Répertoire Hôte

Pour monter votre propre `divisions.yaml` au lieu de le modifier à l'intérieur du conteneur :

```yaml
# docker-compose.override.yml
services:
  sidjua:
    volumes:
      - ./my-config:/app/config   # remplace le volume nommé sidjua-config
```

### Sauvegarde

```bash
sidjua backup create                    # depuis l'intérieur du conteneur
# ou
docker compose exec sidjua sidjua backup create
```

Les sauvegardes sont des archives signées HMAC stockées dans `/app/data/backups/`.

---

## 12. Mise à Jour

### Docker

```bash
git pull
docker compose build --no-cache
docker compose up -d
docker compose exec sidjua sidjua apply    # exécuter les migrations de schéma
```

`sidjua apply` est idempotent — toujours sûr à réexécuter après une mise à jour.

### Installation Globale npm

```bash
npm update -g sidjua
sidjua apply    # exécuter les migrations de schéma
```

### Compilation depuis les Sources

```bash
git pull
npm ci
npm run build
node dist/index.js apply    # exécuter les migrations de schéma
```

### Retour en Arrière

SIDJUA crée un instantané de gouvernance avant chaque `sidjua apply`. Pour revenir en arrière :

```bash
sidjua rollback list
sidjua rollback <version>
```

---

## 13. Prochaines Étapes

| Ressource | Commande / Lien |
|----------|---------------|
| Démarrage Rapide | [docs/QUICK-START.md](QUICK-START.md) |
| Référence CLI | [docs/CLI-REFERENCE.md](CLI-REFERENCE.md) |
| Exemples de Gouvernance | [docs/GOVERNANCE-EXAMPLES.md](GOVERNANCE-EXAMPLES.md) |
| Guide des Fournisseurs LLM Gratuits | [docs/FREE-LLM-PROVIDER-GUIDE.md](FREE-LLM-PROVIDER-GUIDE.md) |
| Résolution des Problèmes | [docs/TROUBLESHOOTING.md](TROUBLESHOOTING.md) |

Premières commandes à exécuter après l'installation :

```bash
sidjua chat guide    # guide IA sans configuration — aucune clé API requise
sidjua selftest      # vérification de santé du système (7 catégories, score 0-100)
sidjua apply         # provisionner les agents depuis divisions.yaml
```
