#!/usr/bin/env bash
# deploy-nuvex.sh — Build and deploy NUVEX production stack
#
# Usage (local, same machine as Docker):
#   bash scripts/deploy-nuvex.sh [--pull]
#
# Usage (remote Hetzner VPS via SSH):
#   bash scripts/deploy-nuvex.sh --server user@1.2.3.4 [--pull]
#
# Options:
#   --pull             Pull pre-built images instead of building locally
#   --server HOST      SSH target: copies repo + .env, runs deploy remotely
set -euo pipefail

BLUE='\033[0;34m'; GREEN='\033[0;32m'; NC='\033[0m'
log()  { echo -e "${BLUE}[deploy]${NC} $*"; }
ok()   { echo -e "${GREEN}[deploy]${NC} $*"; }

COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env"
PULL=0
SERVER=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pull)   PULL=1; shift ;;
    --server) SERVER="$2"; shift 2 ;;
    *)        echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

# ── Remote deploy mode ───────────────────────────────────────────────────────
if [[ -n "$SERVER" ]]; then
  REMOTE_DIR="/opt/nuvex"
  log "Syncing project to ${SERVER}:${REMOTE_DIR} ..."
  ssh "$SERVER" "mkdir -p ${REMOTE_DIR}"
  rsync -az --exclude='.git' --exclude='__pycache__' --exclude='*.pyc' \
    --exclude='.venv' --exclude='node_modules' \
    . "${SERVER}:${REMOTE_DIR}/"
  if [[ -f .env ]]; then
    scp .env "${SERVER}:${REMOTE_DIR}/.env"
  fi
  log "Running deploy on remote host..."
  PULL_FLAG=$([[ $PULL -eq 1 ]] && echo "--pull" || echo "")
  # shellcheck disable=SC2029
  ssh "$SERVER" "cd ${REMOTE_DIR} && bash scripts/deploy-nuvex.sh ${PULL_FLAG}"
  ok "Remote deploy complete."
  exit 0
fi

# ── Pre-flight checks ────────────────────────────────────────────────────────
if [[ ! -f .env ]]; then
  echo "ERROR: .env not found. Copy .env.nuvex.example → .env and fill in secrets." >&2
  exit 1
fi

if ! grep -q "DB_PASSWORD=" .env || grep -q "DB_PASSWORD=$" .env; then
  echo "ERROR: DB_PASSWORD is not set in .env." >&2
  exit 1
fi

# ── Run DB migrations ─────────────────────────────────────────────────────────
log "Running Alembic migrations..."
${COMPOSE} run --rm brain python -m alembic upgrade head

# ── Build or pull images ──────────────────────────────────────────────────────
if [[ $PULL -eq 1 ]]; then
  log "Pulling latest images..."
  ${COMPOSE} pull
else
  log "Building Docker images..."
  ${COMPOSE} build --parallel
fi

# ── Deploy ────────────────────────────────────────────────────────────────────
log "Starting all services..."
${COMPOSE} up -d

# ── Health check ─────────────────────────────────────────────────────────────
log "Waiting for brain to become healthy..."
for i in $(seq 1 30); do
  if ${COMPOSE} exec -T brain curl -fsS http://localhost:8100/health >/dev/null 2>&1; then
    ok "Brain is healthy."
    break
  fi
  if [[ $i -eq 30 ]]; then
    echo "ERROR: Brain did not become healthy within 60s." >&2
    ${COMPOSE} logs brain --tail 50
    exit 1
  fi
  sleep 2
done

ok "NUVEX deployed successfully."
log "Brain:     http://\${NETBIRD_IP:-127.0.0.1}:9100"
log "Dashboard: http://\${NETBIRD_IP:-127.0.0.1}:9200"
log ""
log "View logs:   docker compose -f docker-compose.prod.yml logs -f"
log "Stop:        docker compose -f docker-compose.prod.yml down"
