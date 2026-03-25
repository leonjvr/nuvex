#!/usr/bin/env bash
# scripts/check-license-headers.sh — Verify SPDX headers in all src/*.ts files
# Returns non-zero if any file is missing the required header.
# Suitable for pre-commit hook or CI gate.
set -euo pipefail

cd "$(dirname "$0")/.."

MISSING=()
while IFS= read -r -d '' f; do
  if ! head -1 "$f" | grep -q "SPDX-License-Identifier: AGPL-3.0-only"; then
    MISSING+=("$f")
  fi
done < <(find src -name "*.ts" -print0)

if [ ${#MISSING[@]} -eq 0 ]; then
  echo "✓ All $(find src -name "*.ts" | wc -l | tr -d ' ') TypeScript files have SPDX headers."
  exit 0
else
  echo "✗ Missing SPDX header in ${#MISSING[@]} file(s):"
  for f in "${MISSING[@]}"; do
    echo "  $f"
  done
  echo ""
  echo "Add to top of each file:"
  echo "  // SPDX-License-Identifier: AGPL-3.0-only"
  echo "  // Copyright (c) 2026 SIDJUA. All rights reserved."
  exit 1
fi
