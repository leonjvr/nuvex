#!/usr/bin/env bash
# copilot.sh — Send a task to GitHub Copilot CLI on a dev server
# Usage: copilot.sh <server-ip> "<prompt>" [--dir <workspace-subdir>]
set -euo pipefail

SERVER_IP="${1:?Usage: copilot.sh <server-ip> \"<prompt>\" [--dir <subdir>]}"
PROMPT="${2:?Usage: copilot.sh <server-ip> \"<prompt>\" [--dir <subdir>]}"
shift 2

WORK_DIR="/root/workspace"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir) WORK_DIR="/root/workspace/$2"; shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

MAYA_SSH_KEY="/data/agents/maya/workspace/ssh/id_ed25519"
SSH="ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 -o BatchMode=yes -i $MAYA_SSH_KEY root@$SERVER_IP"

# Read GH_TOKEN from /etc/environment (set by provision.sh; works in non-interactive SSH)
GH_TOKEN=$($SSH 'grep "^GH_TOKEN=" /etc/environment | cut -d= -f2-' 2>/dev/null || true)
if [[ -z "$GH_TOKEN" ]]; then
  echo "ERROR: GH_TOKEN not found on server — was this server provisioned with the current provision.sh?" >&2
  exit 1
fi

# Escape the prompt for safe shell transmission
ESCAPED_PROMPT=$(printf '%s' "$PROMPT" | sed "s/'/'\\\\''/g")

$SSH "export GH_TOKEN=$GH_TOKEN && cd $WORK_DIR && gh copilot -- --allow-all -p '${ESCAPED_PROMPT}' 2>&1"
