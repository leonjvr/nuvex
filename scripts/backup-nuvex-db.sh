#!/usr/bin/env bash
# scripts/backup-nuvex-db.sh — Daily pg_dump backup for the NUVEX database.
#
# Usage:
#   ./scripts/backup-nuvex-db.sh [backup_dir]
#   ./scripts/backup-nuvex-db.sh --install-cron   # install daily cron job
#
# Environment variables (read from .env if present):
#   DATABASE_URL             Full PostgreSQL DSN (overrides component vars below)
#   NUVEX_DB_HOST            PostgreSQL host (default: 127.0.0.1)
#   NUVEX_DB_PORT            PostgreSQL port (default: 9432)
#   NUVEX_DB_NAME            Database name   (default: nuvex)
#   NUVEX_DB_USER            PostgreSQL user  (default: nuvex)
#   NUVEX_DB_PASS            PostgreSQL password
#   NUVEX_BACKUP_DIR         Target directory for backup files (default: ./backups/db)
#   NUVEX_BACKUP_RETAIN      Number of backup files to keep  (default: 14)
#
# Off-server storage (optional — configure one of the following):
#   NUVEX_BACKUP_REMOTE_SSH  SCP destination, e.g. "user@host:/backups/nuvex/"
#   NUVEX_BACKUP_RCLONE_DEST rclone remote path, e.g. "s3-backups:nuvex-db/"

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Install cron job and exit ───────────────────────────────────────────────
if [[ "${1:-}" == "--install-cron" ]]; then
    SCRIPT_ABS="$(realpath "${BASH_SOURCE[0]}")"
    LOG_FILE="/var/log/nuvex-backup.log"
    CRON_LINE="0 3 * * * root bash ${SCRIPT_ABS} >> ${LOG_FILE} 2>&1"
    CRON_FILE="/etc/cron.d/nuvex-backup"
    echo "$CRON_LINE" > "$CRON_FILE"
    chmod 644 "$CRON_FILE"
    echo "[backup] Cron job installed: ${CRON_FILE}"
    echo "[backup] Schedule: daily at 03:00, logs → ${LOG_FILE}"
    exit 0
fi

# Load .env if it exists
if [[ -f "${SCRIPT_DIR}/../.env" ]]; then
    set -o allexport
    # shellcheck disable=SC1091
    source "${SCRIPT_DIR}/../.env"
    set +o allexport
fi

# Resolve DB connection params from DATABASE_URL or individual vars
if [[ -n "${DATABASE_URL:-}" ]]; then
    # Parse postgresql://user:pass@host:port/dbname
    DB_USER=$(echo "$DATABASE_URL" | sed -E 's|postgresql(\+[^:]*)?://([^:]+):.*|\2|')
    DB_PASS=$(echo "$DATABASE_URL" | sed -E 's|postgresql(\+[^:]*)?://[^:]+:([^@]+)@.*|\2|')
    DB_HOST=$(echo "$DATABASE_URL" | sed -E 's|postgresql(\+[^:]*)?://[^@]+@([^:/]+).*|\2|')
    DB_PORT=$(echo "$DATABASE_URL" | sed -E 's|postgresql(\+[^:]*)?://[^@]+@[^:]+:([0-9]+)/.*|\2|')
    DB_NAME=$(echo "$DATABASE_URL" | sed -E 's|postgresql(\+[^:]*)?://[^/]+/([^?]+).*|\2|')
else
    DB_HOST="${NUVEX_DB_HOST:-127.0.0.1}"
    DB_PORT="${NUVEX_DB_PORT:-9432}"
    DB_NAME="${NUVEX_DB_NAME:-nuvex}"
    DB_USER="${NUVEX_DB_USER:-nuvex}"
    DB_PASS="${NUVEX_DB_PASS:-nuvex}"
fi

BACKUP_DIR="${1:-${NUVEX_BACKUP_DIR:-${SCRIPT_DIR}/../backups/db}}"
RETAIN="${NUVEX_BACKUP_RETAIN:-14}"

mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +"%Y-%m-%dT%H-%M-%S")
BACKUP_FILE="${BACKUP_DIR}/nuvex-${TIMESTAMP}.dump"

echo "[backup] PostgreSQL → ${BACKUP_FILE}"

PGPASSWORD="$DB_PASS" pg_dump \
    --host="$DB_HOST" \
    --port="$DB_PORT" \
    --username="$DB_USER" \
    --dbname="$DB_NAME" \
    --format=custom \
    --compress=9 \
    --no-password \
    --file="$BACKUP_FILE"

echo "[backup] Backup complete: $(du -h "$BACKUP_FILE" | cut -f1)"

# Prune old backups (keep most recent N)
BACKUP_COUNT=$(find "$BACKUP_DIR" -name "nuvex-*.dump" | wc -l)
if (( BACKUP_COUNT > RETAIN )); then
    TO_DELETE=$(( BACKUP_COUNT - RETAIN ))
    echo "[backup] Pruning ${TO_DELETE} old backup(s) (retain=${RETAIN})"
    find "$BACKUP_DIR" -name "nuvex-*.dump" -printf "%T+ %p\n" \
        | sort \
        | head -n "$TO_DELETE" \
        | awk '{print $2}' \
        | xargs rm -f
fi

echo "[backup] Done. Backups in ${BACKUP_DIR}:"
ls -lh "${BACKUP_DIR}"/nuvex-*.dump 2>/dev/null | tail -5 || true

# ── Off-server transfer ───────────────────────────────────────────────────────
if [[ -n "${NUVEX_BACKUP_REMOTE_SSH:-}" ]]; then
    echo "[backup] Uploading to ${NUVEX_BACKUP_REMOTE_SSH} via scp..."
    scp -q "$BACKUP_FILE" "${NUVEX_BACKUP_REMOTE_SSH}"
    echo "[backup] Remote transfer complete."
elif [[ -n "${NUVEX_BACKUP_RCLONE_DEST:-}" ]]; then
    if command -v rclone &>/dev/null; then
        echo "[backup] Uploading to ${NUVEX_BACKUP_RCLONE_DEST} via rclone..."
        rclone copy "$BACKUP_FILE" "${NUVEX_BACKUP_RCLONE_DEST}" --quiet
        echo "[backup] rclone transfer complete."
    else
        echo "[backup] WARNING: NUVEX_BACKUP_RCLONE_DEST is set but rclone is not installed." >&2
        echo "[backup] Install rclone: https://rclone.org/install/" >&2
    fi
fi
