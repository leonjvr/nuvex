#!/usr/bin/env bash
# gh-login.sh — Authenticate with GitHub via browser and save the OAuth token
# to the skill .env so all dev-server scripts can use it without a keyring.
#
# Usage: gh-login.sh
#
# The script:
#  1. Installs gh CLI if missing
#  2. Runs `gh auth login --web --scopes copilot` (opens browser)
#  3. Extracts the resulting oauth_token from gh's config
#  4. Writes GH_TOKEN=<token> to the skill's shared .env file

set -euo pipefail

# Ensure standard system paths are available (container envs may have empty PATH)
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${PATH:-}"

ENV_FILE="$(dirname "$0")/../.env"

# ── Install gh CLI if missing ─────────────────────────────────────────────────
if ! command -v gh &>/dev/null; then
  echo "[gh-login] gh CLI not found — attempting install..."
  if command -v apt-get &>/dev/null; then
    export DEBIAN_FRONTEND=noninteractive
    # Install curl first if missing (needed to fetch GitHub CLI keyring)
    if ! command -v curl &>/dev/null; then
      echo "[gh-login] Installing curl..."
      apt-get update -qq && apt-get install -y -qq curl
    fi
    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg 2>/dev/null
    chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list
    apt-get update -qq && apt-get install -y -qq gh
  elif command -v brew &>/dev/null; then
    brew install gh
  else
    echo "[gh-login] ERROR: Cannot install gh CLI automatically. Install it manually." >&2
    exit 1
  fi
fi

# ── Run interactive login ─────────────────────────────────────────────────────
echo "[gh-login] Opening browser for GitHub authentication..."
echo "[gh-login] Scopes requested: repo, read:org, copilot"
echo ""
GH_CONFIG_DIR="${GH_CONFIG_DIR:-$HOME/.config/gh}"
export GH_CONFIG_DIR

# --web opens a browser with a device code; --git-protocol https avoids SSH setup
gh auth login \
  --hostname github.com \
  --git-protocol https \
  --scopes "repo,read:org,copilot" \
  --web

# ── Extract token via official gh CLI API ────────────────────────────────────
TOKEN=$(gh auth token)

if [[ -z "$TOKEN" ]]; then
  echo "[gh-login] ERROR: Failed to retrieve token: $TOKEN" >&2
  exit 1
fi

# ── Write to skill .env ───────────────────────────────────────────────────────
mkdir -p "$(dirname "$ENV_FILE")"
# Remove existing GH_TOKEN line if present
if [[ -f "$ENV_FILE" ]]; then
  grep -v "^GH_TOKEN=" "$ENV_FILE" > "${ENV_FILE}.tmp"; mv "${ENV_FILE}.tmp" "$ENV_FILE"
fi
echo "GH_TOKEN=${TOKEN}" >> "$ENV_FILE"
chmod 600 "$ENV_FILE"

echo ""
echo "[gh-login] GitHub token saved to $ENV_FILE"
echo "[gh-login] Auth status:"
GH_TOKEN="$TOKEN" gh auth status
