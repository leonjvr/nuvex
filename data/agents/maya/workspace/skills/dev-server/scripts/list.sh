#!/usr/bin/env bash
# list.sh — List all running dev servers with project, age, and status
# Usage: list.sh
set -euo pipefail

HOME="${HOME:-/root}"

for candidate in "$(dirname "$0")/../.env" "$HOME/.config/dev-server/.env" "$(dirname "$0")/../../.env"; do
  if [[ -f "$candidate" ]]; then set -a; source "$candidate"; set +a; break; fi
done
: "${HETZNER_DEV_PROJECT_API:?}"

SERVERS_JSON=$(curl -fsSL \
  -H "Authorization: Bearer $HETZNER_DEV_PROJECT_API" \
  "https://api.hetzner.cloud/v1/servers")

python3 - "$SERVERS_JSON" <<'PYEOF'
import sys, json
from datetime import datetime, timezone

data = json.loads(sys.argv[1])
servers = data.get("servers", [])

if not servers:
    print("No dev servers running.")
    sys.exit(0)

print(f"{'Name':<30} {'IP':<18} {'Project':<20} {'Age':<12} {'Status':<10}")
print("-" * 90)

for s in servers:
    name = s["name"]
    ip = s["public_net"]["ipv4"]["ip"]
    created = datetime.fromisoformat(s["created"].replace("Z", "+00:00"))
    age = datetime.now(timezone.utc) - created
    hours = int(age.total_seconds() // 3600)
    mins = int((age.total_seconds() % 3600) // 60)
    age_str = f"{hours}h {mins}m"
    status = s["status"]
    project = s.get("labels", {}).get("project", "-")
    print(f"{name:<30} {ip:<18} {project:<20} {age_str:<12} {status:<10}")
PYEOF
