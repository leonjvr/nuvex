#!/usr/bin/env bash
# comment-issue.sh — Add a comment to an existing GitHub issue
#
# Usage:
#   comment-issue.sh <owner/repo> <github_pat> <issue_number> <comment_body>

set -euo pipefail

REPO="${1:?Usage: comment-issue.sh <owner/repo> <github_pat> <issue_number> <comment_body>}"
GH_PAT="${2:?Missing github_pat}"
ISSUE_NUMBER="${3:?Missing issue_number}"
COMMENT="${4:?Missing comment_body}"

API="https://api.github.com/repos/${REPO}/issues/${ISSUE_NUMBER}/comments"

RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST "$API" \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer ${GH_PAT}" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  -H "Content-Type: application/json" \
  --data "$(jq -n --arg body "$COMMENT" '{body: $body}')")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY_JSON=$(echo "$RESPONSE" | head -n -1)

if [[ "$HTTP_CODE" != "201" ]]; then
  echo "ERROR: GitHub API returned HTTP $HTTP_CODE" >&2
  echo "$BODY_JSON" >&2
  exit 1
fi

echo "COMMENT_URL=$(echo "$BODY_JSON" | jq -r '.html_url')"
