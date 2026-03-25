#!/bin/sh
set -e

# Ensure data directories exist (volumes may be freshly mounted)
mkdir -p /app/data/backups /app/data/knowledge /app/data/governance-snapshots
mkdir -p /app/config /app/logs /data/logs

# Error log with PII redaction (written by the Node.js process)
export SIDJUA_ERROR_LOG="/data/logs/sidjua-error.log"

# First-run detection: copy bundled default config if none exists
if [ ! -f /app/config/divisions.yaml ]; then
  echo "First run detected — creating default divisions.yaml"
  cp /app/defaults/divisions.yaml /app/config/divisions.yaml 2>/dev/null || true
fi

# Ensure divisions.yaml is available at /app/divisions.yaml (default config path for `sidjua apply`)
if [ ! -f /app/divisions.yaml ]; then
  cp /app/defaults/divisions.yaml /app/divisions.yaml 2>/dev/null || true
fi

# --- Zero-Config API Key Auto-Generation ---
API_KEY_FILE="/app/.system/api-key"

if [ -n "$SIDJUA_API_KEY" ]; then
  # Explicit env var takes priority
  echo "Using SIDJUA_API_KEY from environment"
elif [ -f "$API_KEY_FILE" ]; then
  # Reuse previously generated key
  export SIDJUA_API_KEY=$(cat "$API_KEY_FILE")
  echo "Using stored API key from $API_KEY_FILE"
else
  # First run — auto-generate
  GENERATED_KEY="sk-sidjua-$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")"
  echo "$GENERATED_KEY" > "$API_KEY_FILE"
  chmod 600 "$API_KEY_FILE"
  export SIDJUA_API_KEY="$GENERATED_KEY"
  MASKED_KEY="${GENERATED_KEY:0:10}...${GENERATED_KEY: -6}"
  echo ""
  echo "============================================"
  echo "  SIDJUA API Key (auto-generated)"
  echo "  $MASKED_KEY"
  echo ""
  echo "  Full key stored at: $API_KEY_FILE"
  echo "  Retrieve with: docker exec <container> cat $API_KEY_FILE"
  echo "  Or set SIDJUA_API_KEY env var to override."
  echo "============================================"
  echo ""
fi
# --- End Zero-Config API Key ---

# --- Error Logging Transparency Notice ---
echo ""
echo "  Error logging is enabled in V1.0.0 to help us improve stability."
echo "  - API keys and secrets are automatically redacted (never stored in full)"
echo "  - Logs are stored locally at ${SIDJUA_ERROR_LOG}"
echo "  - Logging will be user-configurable in V1.0.1"
echo "  - To disable now: set SIDJUA_LOG_LEVEL=none"
echo ""

# --- Startup Info ---
# Security check: warn if running as root
if [ "$(id -u)" = "0" ]; then
  echo "[WARN] Running as root is not recommended. Use: docker run --user 1001:1001"
fi
echo "[INFO] Platform: $(uname -m)"
echo "[INFO] SIDJUA ${SIDJUA_VERSION:-unknown} starting on port ${SIDJUA_PORT:-4200}"

# --- First-Run Provisioning ---
# Apply divisions + agents on every startup (idempotent).
# Ensures starter agents are registered in the DB even on first boot.
echo "[INFO] Running provisioning (sidjua apply)..."
sidjua apply --force --work-dir /app 2>&1 || {
  echo "[WARN] Provisioning failed — server will start but agents may be missing"
}

# Inject --port from SIDJUA_PORT env var when starting the API server.
# This lets operators override the port without rebuilding the image:
#   docker run -e SIDJUA_PORT=8080 -p 8080:8080 sidjua/sidjua:1.0.0
PORT="${SIDJUA_PORT:-4200}"

# Only inject --port when the CMD looks like a server start invocation.
# Direct `docker exec` calls (sidjua --version, sidjua init, etc.) bypass this script.
case "$*" in
  *"server start"*)
    exec "$@" --port "$PORT"
    ;;
  *)
    exec "$@"
    ;;
esac
