#!/usr/bin/env bash
# provision-nuvex.sh — Bootstrap a fresh VPS with NUVEX prerequisites
# Requirements: Debian 12 / Ubuntu 22+
# Usage: bash scripts/provision-nuvex.sh
set -euo pipefail

BLUE='\033[0;34m'; NC='\033[0m'
log() { echo -e "${BLUE}[provision]${NC} $*"; }

# ── Docker ───────────────────────────────────────────────────────────────────
if ! command -v docker &>/dev/null; then
  log "Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
else
  log "Docker already installed: $(docker --version)"
fi

# ── Docker Compose plugin ────────────────────────────────────────────────────
if ! docker compose version &>/dev/null 2>&1; then
  log "Installing Docker Compose plugin..."
  LATEST=$(curl -fsSL https://api.github.com/repos/docker/compose/releases/latest | grep '"tag_name"' | cut -d'"' -f4)
  mkdir -p /usr/local/lib/docker/cli-plugins
  curl -fsSL "https://github.com/docker/compose/releases/download/${LATEST}/docker-compose-linux-x86_64" \
    -o /usr/local/lib/docker/cli-plugins/docker-compose
  chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
else
  log "Docker Compose already installed: $(docker compose version)"
fi

# ── curl (for healthcheck probes) ────────────────────────────────────────────
if ! command -v curl &>/dev/null; then
  log "Installing curl..."
  apt-get update -qq && apt-get install -y --no-install-recommends curl
fi

# ── PostgreSQL client tools (pg_dump, psql) ───────────────────────────────────
if ! command -v psql &>/dev/null; then
  log "Installing PostgreSQL client tools..."
  apt-get update -qq && apt-get install -y --no-install-recommends postgresql-client
else
  log "PostgreSQL client already installed: $(psql --version)"
fi

# ── Netbird (WireGuard VPN) ───────────────────────────────────────────────────
if ! command -v netbird &>/dev/null; then
  if [[ -n "${NETBIRD_SETUP_KEY:-}" ]]; then
    log "Installing Netbird..."
    curl -fsSL https://pkgs.netbird.io/install.sh | sh
    netbird up --setup-key "${NETBIRD_SETUP_KEY}"
    log "Netbird started. IP: $(netbird status | grep 'NetbirdIP' | awk '{print $2}')"
  else
    log "NETBIRD_SETUP_KEY not set — skipping Netbird install."
    log "Set it in .env and re-run, or install manually: https://netbird.io/docs"
  fi
else
  log "Netbird already installed."
fi

# ── Firewall: block everything except SSH + Netbird ──────────────────────────
if command -v ufw &>/dev/null; then
  log "Configuring UFW..."
  ufw --force reset
  ufw default deny incoming
  ufw default allow outgoing
  ufw allow 22/tcp comment 'SSH'
  # Netbird WireGuard port
  ufw allow 51820/udp comment 'Netbird/WireGuard'
  ufw --force enable
  log "UFW enabled. All NUVEX services are Netbird-only (no public ports)."
fi

log "Provisioning complete. Next: copy files and run deploy-nuvex.sh"
