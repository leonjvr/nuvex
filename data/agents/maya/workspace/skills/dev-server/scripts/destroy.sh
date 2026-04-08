#!/usr/bin/env bash
# destroy.sh — Destroy a Hetzner dev server by name or ID.
# Enforces minimum 15-minute lifetime from creation.
#
# Usage: destroy.sh <server-name-or-id> [--force]
set -euo pipefail

HOME="${HOME:-/root}"

for candidate in "$(dirname "$0")/../.env" "$HOME/.config/dev-server/.env" "$(dirname "$0")/../../.env"; do
  if [[ -f "$candidate" ]]; then set -a; source "$candidate"; set +a; break; fi
done
: "${HETZNER_DEV_PROJECT_API:?HETZNER_DEV_PROJECT_API must be set}"

MAYA_SSH_KEY="/data/agents/maya/workspace/ssh/id_ed25519"

TARGET="${1:?Usage: destroy.sh <server-name-or-id> [--force]}"
FORCE="${2:-}"

# Resolve server name → ID + IP
if [[ "$TARGET" =~ ^[0-9]+$ ]]; then
  SERVER_ID="$TARGET"
else
  SERVER_ID=$(curl -fsSL -H "Authorization: Bearer $HETZNER_DEV_PROJECT_API" \
    "https://api.hetzner.cloud/v1/servers?name=$TARGET" | \
    python3 -c "import sys,json; d=json.load(sys.stdin); print(d['servers'][0]['id'] if d.get('servers') else '')" 2>/dev/null || true)
  if [[ -z "$SERVER_ID" ]]; then
    echo "ERROR: No server found with name '$TARGET'" >&2
    exit 1
  fi
fi

SERVER_INFO=$(curl -fsSL -H "Authorization: Bearer $HETZNER_DEV_PROJECT_API" \
  "https://api.hetzner.cloud/v1/servers/$SERVER_ID")
SERVER_IP=$(echo "$SERVER_INFO" | python3 -c "import sys,json; print(json.load(sys.stdin)['server']['public_net']['ipv4']['ip'])")
SERVER_NAME=$(echo "$SERVER_INFO" | python3 -c "import sys,json; print(json.load(sys.stdin)['server']['name'])")

echo "Server: $SERVER_NAME (id=$SERVER_ID, ip=$SERVER_IP)"

# Enforce minimum lifetime (15 minutes)
if [[ "$FORCE" != "--force" ]]; then
  CREATED_AT=$(ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 -o BatchMode=yes -i "$MAYA_SSH_KEY" \
    "root@$SERVER_IP" "python3 -c \"import json; print(json.load(open('/root/.devserver-meta.json'))['created_at'])\"" 2>/dev/null || true)
  if [[ -n "$CREATED_AT" ]]; then
    AGE_MINS=$(python3 -c "
from datetime import datetime, timezone
created = datetime.fromisoformat('$CREATED_AT'.replace('Z','+00:00'))
age = (datetime.now(timezone.utc) - created).total_seconds() / 60
print(int(age))
")
    if [[ $AGE_MINS -lt 15 ]]; then
      echo "ERROR: Server is only ${AGE_MINS}m old. Minimum lifetime is 15 minutes." >&2
      echo "Use --force to override." >&2
      exit 1
    fi
  fi
fi

echo "Deleting server $SERVER_NAME ($SERVER_ID)..."
curl -fsSL -X DELETE \
  -H "Authorization: Bearer $HETZNER_DEV_PROJECT_API" \
  "https://api.hetzner.cloud/v1/servers/$SERVER_ID" > /dev/null
echo "Server $SERVER_NAME deleted."
