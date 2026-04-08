# NUVEX Deployment Guide

This directory contains the canonical deployment configuration for NUVEX on a Hetzner VPS.

## Files

| File | Purpose |
|------|---------|
| `docker-compose.yml` → (symlink to repo root `docker-compose.prod.yml`) | Production stack definition |
| `README.md` | This guide |

---

## Prerequisites

Run the provisioning script once on a fresh VPS:

```bash
# Copy repo to the server
rsync -az . user@<SERVER_IP>:/opt/nuvex/

# On the server: install Docker, Netbird, PostgreSQL client tools
bash /opt/nuvex/scripts/provision-nuvex.sh

# Set your Netbird setup key to enable VPN connectivity
NETBIRD_SETUP_KEY=<your-key> bash /opt/nuvex/scripts/provision-nuvex.sh
```

---

## First-Time Setup

```bash
# 1. Create .env from the example
cp .env.nuvex.example .env
# Edit .env: set DB_PASSWORD, ANTHROPIC_API_KEY, NETBIRD_IP, etc.

# 2. Deploy
bash scripts/deploy-nuvex.sh
```

---

## Remote Deploy (from dev machine)

```bash
bash scripts/deploy-nuvex.sh --server user@<SERVER_IP>
```

This will:
1. `rsync` the repo to `/opt/nuvex` on the server
2. Copy your local `.env` to the server
3. Run `deploy-nuvex.sh` on the server

---

## Daily Backup Setup

```bash
# On the server — installs /etc/cron.d/nuvex-backup (daily at 03:00)
bash /opt/nuvex/scripts/backup-nuvex-db.sh --install-cron

# Configure off-server storage in .env:
# NUVEX_BACKUP_REMOTE_SSH=backup-user@offsite.example.com:/backups/nuvex/
# -- OR --
# NUVEX_BACKUP_RCLONE_DEST=s3-backups:nuvex-db/
```

---

## Port Reference

All services bind to `${NETBIRD_IP}` (the Netbird VPN IP), not `0.0.0.0`.

| Service | Port |
|---------|------|
| Brain API | `9100` |
| WhatsApp Gateway | `9101` |
| Telegram Gateway | `9102` |
| Email Gateway | `9103` |
| Dashboard | `9200` |
| PostgreSQL | `9432` |

---

## Monitoring

```bash
# Live logs
docker compose -f docker-compose.prod.yml logs -f

# Health check
curl http://${NETBIRD_IP}:9100/health

# Service status
docker compose -f docker-compose.prod.yml ps
```

---

## Rolling Update

```bash
git pull origin main
bash scripts/deploy-nuvex.sh
```

This runs migrations automatically before restarting containers.

---

## Rollback

```bash
# Stop current stack
docker compose -f docker-compose.prod.yml down

# Check out previous version
git checkout <previous-tag>

# Downgrade DB migrations if needed
docker compose -f docker-compose.prod.yml run --rm brain python -m alembic downgrade -1

# Restart
docker compose -f docker-compose.prod.yml up -d
```
