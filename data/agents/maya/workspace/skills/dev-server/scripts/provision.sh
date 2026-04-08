#!/usr/bin/env bash
# provision.sh — Provision a Hetzner dev server with GitHub Copilot CLI ready to go.
#
# Usage: provision.sh <server-name> [--project <project-label>]
#
# Creates a cx23 (2 vCPU / 4 GB) Ubuntu 24.04 server, then configures:
#   - Basic hardening (UFW, fail2ban, no password SSH)
#   - Node.js 24 + npm
#   - Docker + Docker Compose
#   - GitHub CLI (gh) with auth copied from this machine
#   - GitHub Copilot CLI (latest)
#   - MCP servers: Context7 + Playwright
#   - Git author: Maya <maya@nuvex.co.za>
#   - /root/.devserver-meta.json with server metadata
#
# Outputs JSON to stdout: {"server_id": ..., "ip": "...", "name": "..."}
# All progress/debug goes to stderr.
set -euo pipefail

HOME="${HOME:-/root}"

# ── Load config ───────────────────────────────────────────────────────────────
for candidate in "$(dirname "$0")/../.env" "$HOME/.config/dev-server/.env" "$(dirname "$0")/../../.env"; do
  if [[ -f "$candidate" ]]; then
    set -a; source "$candidate"; set +a
    break
  fi
done

: "${HETZNER_DEV_PROJECT_API:?HETZNER_DEV_PROJECT_API must be set — add it to ~/.config/dev-server/.env}"

# ── Parse args ────────────────────────────────────────────────────────────────
SERVER_NAME="${1:?Usage: provision.sh <server-name> [--project <label>]}"
shift
PROJECT_LABEL=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) PROJECT_LABEL="$2"; shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

log() { echo "[dev-server] $*" >&2; }

# ── Load project config from registry ────────────────────────────────────────
PROJECTS_FILE="/data/agents/maya/workspace/config/projects.json"
PROJECT_REPO=""
PROJECT_STAGING_URL=""
PROJECT_PROD_URL=""
PROJECT_PAT=""
PROJECT_DEPLOYMENT_WINDOW_JSON=""
PROJECT_CONTACT_CHANNEL=""
if [[ -n "$PROJECT_LABEL" && -f "$PROJECTS_FILE" ]]; then
  PROJECT_REPO=$(python3 -c "import json; d=json.load(open('$PROJECTS_FILE')); print(d.get('$PROJECT_LABEL',{}).get('repo',''))" 2>/dev/null || true)
  PROJECT_STAGING_URL=$(python3 -c "import json; d=json.load(open('$PROJECTS_FILE')); print(d.get('$PROJECT_LABEL',{}).get('staging_url',''))" 2>/dev/null || true)
  PROJECT_PROD_URL=$(python3 -c "import json; d=json.load(open('$PROJECTS_FILE')); print(d.get('$PROJECT_LABEL',{}).get('prod_url',''))" 2>/dev/null || true)
  PROJECT_CONTACT_CHANNEL=$(python3 -c "import json; d=json.load(open('$PROJECTS_FILE')); print(d.get('$PROJECT_LABEL',{}).get('contact_channel',''))" 2>/dev/null || true)
  PROJECT_DEPLOYMENT_WINDOW_JSON=$(python3 -c "
import json
try:
  d=json.load(open('$PROJECTS_FILE'))
  w=d.get('$PROJECT_LABEL',{}).get('deployment_window')
  print(json.dumps(w) if w else '')
except: pass
" 2>/dev/null || true)
  PROJECT_PAT=$(python3 -c "
import json
try:
  d=json.load(open('$PROJECTS_FILE'))
  pat=d.get('$PROJECT_LABEL',{}).get('github_pat','')
  if pat and 'PLACEHOLDER' not in pat: print(pat)
except: pass
" 2>/dev/null || true)
  [[ -n "$PROJECT_REPO" ]] && log "Project '$PROJECT_LABEL': repo=$PROJECT_REPO staging=$PROJECT_STAGING_URL prod=$PROJECT_PROD_URL"
fi

SERVER_TYPE="cx23"
LOCATION="nbg1"
IMAGE="ubuntu-24.04"

# ── Canonical Maya SSH key (persists across container restarts via workspace mount)
MAYA_SSH_KEY="/data/agents/maya/workspace/ssh/id_ed25519"

# ── Ensure Maya's SSH key exists ──────────────────────────────────────────────
log "Ensuring Maya SSH key at $MAYA_SSH_KEY..."
if [[ ! -f "$MAYA_SSH_KEY" ]]; then
  log "Generating persistent Maya SSH key..."
  mkdir -p "$(dirname "$MAYA_SSH_KEY")" && chmod 700 "$(dirname "$MAYA_SSH_KEY")"
  ssh-keygen -t ed25519 -f "$MAYA_SSH_KEY" -N '' -q
  log "Key generated."
fi
chmod 600 "$MAYA_SSH_KEY"
LOCAL_PUB_KEY=$(cat "${MAYA_SSH_KEY}.pub")

SSH_KEY_ID=$(curl -fsSL \
  -H "Authorization: Bearer $HETZNER_DEV_PROJECT_API" \
  "https://api.hetzner.cloud/v1/ssh_keys" | \
  python3 -c "
import sys, json
data = json.load(sys.stdin)
local = '''$LOCAL_PUB_KEY'''.strip().split()[1]
for k in data['ssh_keys']:
    if local in k['public_key']:
        print(k['id'])
        import sys; sys.exit(0)
print('')
" 2>/dev/null)

if [[ -z "$SSH_KEY_ID" ]]; then
  log "Uploading SSH key to Hetzner project..."
  SSH_KEY_ID=$(python3 -c "
import json, urllib.request, urllib.error, sys
key = '''$LOCAL_PUB_KEY'''.strip()
token = '$HETZNER_DEV_PROJECT_API'
data = json.dumps({'name': 'nuvex-brain', 'public_key': key}).encode()
req = urllib.request.Request('https://api.hetzner.cloud/v1/ssh_keys', data=data,
    headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
try:
    resp = json.loads(urllib.request.urlopen(req).read())
    print(resp['ssh_key']['id'])
except urllib.error.HTTPError as e:
    if e.code == 409:
        list_req = urllib.request.Request('https://api.hetzner.cloud/v1/ssh_keys',
            headers={'Authorization': 'Bearer ' + token})
        keys = json.loads(urllib.request.urlopen(list_req).read())
        local_b64 = key.split()[1]
        for k in keys['ssh_keys']:
            if local_b64 in k['public_key']:
                print(k['id'])
                sys.exit(0)
        sys.stderr.write('409 and key not found in list\n')
        sys.exit(1)
    raise
")
fi
log "SSH key ID: $SSH_KEY_ID"

# ── Check if server already exists ────────────────────────────────────────────
log "Checking if server '$SERVER_NAME' already exists..."
EXISTING=$(curl -fsSL \
  -H "Authorization: Bearer $HETZNER_DEV_PROJECT_API" \
  "https://api.hetzner.cloud/v1/servers?name=$SERVER_NAME" | \
  python3 -c "
import sys,json
d=json.load(sys.stdin)
s=d['servers']
if s: print(f'{s[0][\"id\"]} {s[0][\"public_net\"][\"ipv4\"][\"ip\"]}')
else: print('')
" 2>/dev/null)

if [[ -n "$EXISTING" ]]; then
  EXISTING_ID=$(echo "$EXISTING" | cut -d' ' -f1)
  EXISTING_IP=$(echo "$EXISTING" | cut -d' ' -f2)
  log "Server already exists at $EXISTING_IP (id=$EXISTING_ID). Skipping creation."
  echo "{\"server_id\": $EXISTING_ID, \"ip\": \"$EXISTING_IP\", \"name\": \"$SERVER_NAME\"}"
  exit 0
fi

# ── Create server ─────────────────────────────────────────────────────────────
log "Creating server '$SERVER_NAME' ($SERVER_TYPE in $LOCATION)..."

ALL_KEY_IDS=$(curl -fsSL \
  -H "Authorization: Bearer $HETZNER_DEV_PROJECT_API" \
  "https://api.hetzner.cloud/v1/ssh_keys" | \
  python3 -c "import sys,json; print(','.join(str(k['id']) for k in json.load(sys.stdin)['ssh_keys']))")

RESPONSE=$(curl -fsSL -X POST \
  -H "Authorization: Bearer $HETZNER_DEV_PROJECT_API" \
  -H "Content-Type: application/json" \
  "https://api.hetzner.cloud/v1/servers" \
  -d "$(python3 -c "
import json
print(json.dumps({
  'name': '$SERVER_NAME',
  'server_type': '$SERVER_TYPE',
  'location': '$LOCATION',
  'image': '$IMAGE',
  'ssh_keys': [int(x) for x in '$ALL_KEY_IDS'.split(',') if x]
}))")")

SERVER_IP=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['server']['public_net']['ipv4']['ip'])")
SERVER_ID=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['server']['id'])")
log "Server created: id=$SERVER_ID ip=$SERVER_IP"

ssh-keygen -R "$SERVER_IP" -q 2>/dev/null || true

# ── Wait for SSH ──────────────────────────────────────────────────────────────
log "Waiting for SSH (initial 15s boot delay)..."
sleep 15
for i in $(seq 1 60); do
  if ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 -o BatchMode=yes -i "$MAYA_SSH_KEY" "root@$SERVER_IP" "true" 2>/dev/null; then
    log "SSH ready."
    break
  fi
  [[ $i -eq 60 ]] && { log "ERROR: SSH not available after 300s"; exit 1; }
  sleep 5
done

SSH="ssh -o StrictHostKeyChecking=no -o BatchMode=yes -i $MAYA_SSH_KEY root@$SERVER_IP"

# ── Phase 1: System packages + hardening ──────────────────────────────────────
log "Phase 1/7: System update + hardening..."
$SSH bash <<'REMOTE'
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a
apt-get update -qq
apt-get upgrade -y -qq
apt-get install -y -qq ufw fail2ban
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
echo "y" | ufw enable
cat > /etc/fail2ban/jail.local <<'F2B'
[sshd]
enabled = true
port = ssh
maxretry = 5
bantime = 3600
F2B
systemctl enable --now fail2ban
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#\?ChallengeResponseAuthentication.*/ChallengeResponseAuthentication no/' /etc/ssh/sshd_config
systemctl reload ssh || systemctl reload sshd || true
echo "phase1-done"
REMOTE

# ── Phase 2: Node.js 24 ──────────────────────────────────────────────────────
log "Phase 2/7: Node.js 24..."
$SSH bash <<'REMOTE'
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt-get install -y -qq nodejs
echo "node=$(node --version) npm=$(npm --version)"
REMOTE

# ── Phase 3: Docker ───────────────────────────────────────────────────────────
log "Phase 3/7: Docker..."
$SSH bash <<'REMOTE'
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
apt-get update -qq
apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
docker --version && docker compose version
REMOTE

# ── Phase 4: GitHub CLI + auth ────────────────────────────────────────────────
log "Phase 4/7: GitHub CLI + auth..."
$SSH bash <<'REMOTE'
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg 2>/dev/null
chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list
apt-get update -qq
apt-get install -y -qq gh
REMOTE

GITHUB_USER=$(echo "$PROJECT_REPO" | cut -d'/' -f1)
[[ -z "$GITHUB_USER" ]] && GITHUB_USER="leonjvr"
log "GitHub user: $GITHUB_USER"

# ── Resolve GH_TOKEN ──────────────────────────────────────────────────────────
# Priority: GH_TOKEN env var > skill .env > hosts.yml fallback
SKILL_ENV="$(dirname "$0")/../.env"
if [[ -z "${GH_TOKEN:-}" && -f "$SKILL_ENV" ]]; then
  GH_TOKEN=$(grep "^GH_TOKEN=" "$SKILL_ENV" | cut -d= -f2- || true)
fi
if [[ -z "${GH_TOKEN:-}" ]]; then
  GH_HOSTS="/root/.openclaw/gh-config/hosts.yml"
  if [[ -f "$GH_HOSTS" ]]; then
    log "Falling back to hosts.yml extraction for GH_TOKEN..."
    GH_TOKEN=$(python3 -c "
import sys
try:
    import yaml
    d = yaml.safe_load(open('$GH_HOSTS'))
    users = d.get('github.com', {}).get('users', {})
    print(list(users.values())[0].get('oauth_token', '') if users else '')
except ImportError:
    import re
    m = re.search(r'oauth_token:\s*(\S+)', open('$GH_HOSTS').read())
    if m: print(m.group(1))
except Exception as e:
    sys.stderr.write(str(e) + '\n')
" 2>/dev/null || true)
  fi
fi
if [[ -z "${GH_TOKEN:-}" ]]; then
  log "ERROR: No GH_TOKEN available. Run the 'gh-login' script from the Skills settings panel to authenticate with GitHub."
  exit 1
fi
log "GH_TOKEN resolved."

# Fall back to project PAT if GH_TOKEN is still empty (should not reach here due to exit above)
GH_TOKEN_VALUE="${GH_TOKEN:-}"
if [[ -z "$GH_TOKEN_VALUE" && -n "${PROJECT_PAT:-}" ]]; then
  GH_TOKEN_VALUE="$PROJECT_PAT"
fi

if [[ -n "$GH_TOKEN_VALUE" ]]; then
  log "Setting GH_TOKEN on server for headless gh auth..."
  $SSH "echo 'export GH_TOKEN=$GH_TOKEN_VALUE' >> /root/.profile && \
        echo 'export GH_TOKEN=$GH_TOKEN_VALUE' >> /root/.bashrc && \
        echo 'GH_TOKEN=$GH_TOKEN_VALUE' >> /etc/environment"
  # Verify auth works with GH_TOKEN
  $SSH "GH_TOKEN=$GH_TOKEN_VALUE gh auth status" >&2
  log "gh auth: OK (GH_TOKEN)"
else
  log "WARNING: No GH_TOKEN available — gh copilot will not work without manual auth"
fi

# Configure git credential store from projects.json PAT (headless servers don't have keyring)
if [[ -n "$PROJECT_PAT" ]]; then
  log "Configuring git credential store..."
  $SSH "git config --global credential.helper store"
  printf "https://%s:%s@github.com\n" "${GITHUB_USER}" "${PROJECT_PAT}" | \
    $SSH "cat > /root/.git-credentials && chmod 600 /root/.git-credentials"
  log "Git credential store configured."
fi

# ── Phase 5: Copilot CLI ──────────────────────────────────────────────────────
log "Phase 5/7: GitHub Copilot CLI..."
# Download the GitHub Copilot CLI binary from the public github/copilot-cli releases.
# gh copilot (v2.89+) looks for it at ~/.local/share/gh/copilot/copilot.
# The interactive TTY download prompt doesn't fire in non-interactive SSH, so we fetch manually.
$SSH bash <<'REMOTE'
set -euo pipefail
COPILOT_BIN=/root/.local/share/gh/copilot/copilot
mkdir -p "$(dirname "$COPILOT_BIN")"
if [[ -x "$COPILOT_BIN" ]] && "$COPILOT_BIN" --version >/dev/null 2>&1; then
  echo "gh copilot binary already installed: $("$COPILOT_BIN" --version 2>&1 | head -1)"
else
  echo "Downloading GitHub Copilot CLI from github/copilot-cli releases..."
  curl -fsSL -o /tmp/copilot.tar.gz \
    https://github.com/github/copilot-cli/releases/latest/download/copilot-linux-x64.tar.gz
  mkdir -p /tmp/copilot-extract
  tar -xzf /tmp/copilot.tar.gz -C /tmp/copilot-extract
  cp /tmp/copilot-extract/copilot "$COPILOT_BIN"
  chmod +x "$COPILOT_BIN"
  rm -rf /tmp/copilot.tar.gz /tmp/copilot-extract
  echo "Installed: $("$COPILOT_BIN" --version 2>&1 | head -1)"
fi
gh copilot --version >/dev/null 2>&1 && echo "gh copilot: OK" || { echo "ERROR: gh copilot not available after install"; exit 1; }
REMOTE

# ── Phase 6: MCP config + Playwright browser pre-install ─────────────────────
log "Phase 6/7: MCP servers (Context7 + Playwright) + Chromium..."
$SSH bash <<'REMOTE'
set -euo pipefail
mkdir -p /root/.copilot
cat > /root/.copilot/mcp-config.json <<'MCPCFG'
{
  "mcpServers": {
    "context7": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp@latest"]
    },
    "playwright": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@playwright/mcp@latest"]
    }
  }
}
MCPCFG
# Pre-cache MCP packages so first copilot run doesn't download them
npx -y @upstash/context7-mcp@latest --version 2>/dev/null || true
npx -y @playwright/mcp@latest --version 2>/dev/null || true
# Pre-install Chromium so playwright screenshots work immediately without downloading on first use
npx -y playwright install chromium --with-deps 2>&1 | tail -5 || true
echo "mcp-done"
REMOTE

# ── Phase 7: Git config + workspace + metadata ───────────────────────────────
log "Phase 7/7: Git config + metadata..."
CREATED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
$SSH bash <<REMOTE
set -euo pipefail
git config --global user.name "Maya"
git config --global user.email "maya@nuvex.co.za"
git config --global init.defaultBranch main
mkdir -p /root/workspace /root/screenshots
cat > /root/.devserver-meta.json <<EOF
{
  "server_id": $SERVER_ID,
  "name": "$SERVER_NAME",
  "ip": "$SERVER_IP",
  "project": "$PROJECT_LABEL",
  "created_at": "$CREATED_AT",
  "min_lifetime_hours": 0.25,
  "status": "ready",
  "mcp_servers": ["context7", "playwright"]
}
EOF
cat > /root/.devserver-context.json <<EOF
{
  "project": "$PROJECT_LABEL",
  "repo": "$PROJECT_REPO",
  "staging_url": "$PROJECT_STAGING_URL",
  "prod_url": "$PROJECT_PROD_URL",
  "contact_channel": "$PROJECT_CONTACT_CHANNEL",
  "deployment_window": $( [[ -n "$PROJECT_DEPLOYMENT_WINDOW_JSON" ]] && echo "$PROJECT_DEPLOYMENT_WINDOW_JSON" || echo "null" )
}
EOF
REMOTE

# ── Done ──────────────────────────────────────────────────────────────────────
log "Server '$SERVER_NAME' is fully provisioned and ready."
log "  IP: $SERVER_IP"
log "  SSH: ssh root@$SERVER_IP"
echo "{\"server_id\": $SERVER_ID, \"ip\": \"$SERVER_IP\", \"name\": \"$SERVER_NAME\"}"
