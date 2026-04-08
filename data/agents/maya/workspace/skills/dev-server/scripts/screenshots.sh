#!/usr/bin/env bash
# screenshots.sh — Fetch screenshots from a dev server
# Usage: screenshots.sh <server-ip> [--latest] [--all] [--local-dir <path>]
#
# Screenshots are taken BY COPILOT during tasks (via Playwright MCP).
# Copilot saves them to /root/screenshots/ on the dev server.
# This script fetches them to Maya's workspace for sharing with the user.
set -euo pipefail

SERVER_IP="${1:?Usage: screenshots.sh <server-ip> [--latest|--all] [--local-dir <path>]}"
shift

MODE="latest"
LOCAL_DIR="/data/agents/maya/workspace/screenshots"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --latest) MODE="latest"; shift ;;
    --all) MODE="all"; shift ;;
    --local-dir) LOCAL_DIR="$2"; shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

SSH="ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 -o BatchMode=yes -i /data/agents/maya/workspace/ssh/id_ed25519 root@$SERVER_IP"
SCP="scp -o StrictHostKeyChecking=no -i /data/agents/maya/workspace/ssh/id_ed25519"

mkdir -p "$LOCAL_DIR"

if [[ "$MODE" == "latest" ]]; then
  REMOTE_FILE=$($SSH "ls -t /root/screenshots/*.png 2>/dev/null | head -1")
  if [[ -z "$REMOTE_FILE" ]]; then
    echo "No screenshots found in /root/screenshots/ on $SERVER_IP"
    exit 1
  fi
  BASENAME=$(basename "$REMOTE_FILE")
  $SCP "root@${SERVER_IP}:${REMOTE_FILE}" "${LOCAL_DIR}/${BASENAME}"
  echo "${LOCAL_DIR}/${BASENAME}"
else
  COUNT=$($SSH "ls /root/screenshots/*.png 2>/dev/null | wc -l")
  if [[ "$COUNT" -eq 0 ]]; then
    echo "No screenshots found in /root/screenshots/ on $SERVER_IP"
    exit 1
  fi
  $SCP "root@${SERVER_IP}:/root/screenshots/*.png" "${LOCAL_DIR}/"
  echo "Fetched $COUNT screenshots to $LOCAL_DIR"
  ls -1 "${LOCAL_DIR}/"*.png 2>/dev/null
fi
