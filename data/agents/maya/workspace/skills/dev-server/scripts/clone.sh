#!/usr/bin/env bash
# clone.sh — Clone a GitHub repo onto a dev server
# Usage: clone.sh <server-ip> <repo-url> [branch]
set -euo pipefail

SERVER_IP="${1:?Usage: clone.sh <server-ip> <repo-url> [branch]}"
REPO_URL="${2:?Usage: clone.sh <server-ip> <repo-url> [branch]}"
BRANCH="${3:-}"

MAYA_SSH_KEY="/data/agents/maya/workspace/ssh/id_ed25519"
SSH="ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 -o BatchMode=yes -i $MAYA_SSH_KEY root@$SERVER_IP"

REPO_NAME=$(basename "$REPO_URL" .git)

BRANCH_FLAG=""
if [[ -n "$BRANCH" ]]; then
  BRANCH_FLAG="--branch $BRANCH"
fi

$SSH "cd /root/workspace && git clone $BRANCH_FLAG '$REPO_URL' '$REPO_NAME' 2>&1 && \
  echo 'Cloned $REPO_NAME' && \
  cd '$REPO_NAME' && \
  echo 'Branch: '$(git branch --show-current) && \
  echo 'Files:' && ls"
