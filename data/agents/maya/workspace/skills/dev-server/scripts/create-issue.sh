#!/usr/bin/env bash
# create-issue.sh — Create a GitHub issue and return the issue number and URL
#
# Usage:
#   create-issue.sh <owner/repo> <github_pat> <title> <body>
#
# Outputs (to stdout, one per line):
#   ISSUE_NUMBER=<n>
#   ISSUE_URL=https://github.com/<owner/repo>/issues/<n>
#
# The issue is created under the authenticated user (owner of github_pat).
# Include "Reported by: <name>" in the body to surface the human requester.

set -euo pipefail

REPO="${1:?Usage: create-issue.sh <owner/repo> <github_pat> <title> <body>}"
GH_PAT="${2:?Missing github_pat}"
TITLE="${3:?Missing issue title}"
BODY="${4:?Missing issue body}"

API="https://api.github.com/repos/${REPO}/issues"

RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST "$API" \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer ${GH_PAT}" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  -H "Content-Type: application/json" \
  --data "$(jq -n \
    --arg title "$TITLE" \
    --arg body  "$BODY" \
    '{title: $title, body: $body}'
  )")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY_JSON=$(echo "$RESPONSE" | head -n -1)

if [[ "$HTTP_CODE" != "201" ]]; then
  echo "ERROR: GitHub API returned HTTP $HTTP_CODE" >&2
  echo "$BODY_JSON" >&2
  exit 1
fi

ISSUE_NUMBER=$(echo "$BODY_JSON" | jq -r '.number')
ISSUE_URL=$(echo "$BODY_JSON"    | jq -r '.html_url')

echo "ISSUE_NUMBER=${ISSUE_NUMBER}"
echo "ISSUE_URL=${ISSUE_URL}"
