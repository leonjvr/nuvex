#!/bin/bash
# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (c) 2026 SIDJUA. All rights reserved.
#
# Verify README.md complies with the V1.0 communication policy.
#
# Usage: ./scripts/verify-readme.sh [path/to/README.md]
#   Default: README.md in the repository root

set -e

README="${1:-$(dirname "$0")/../README.md}"

if [ ! -f "$README" ]; then
  echo "ERROR: README not found at $README"
  exit 1
fi

FAIL=0

check_absent() {
  local term="$1"
  local label="${2:-$term}"
  if grep -qi "$term" "$README"; then
    echo "FAIL: Found forbidden term: $label"
    FAIL=1
  fi
}

check_present() {
  local term="$1"
  local label="${2:-$term}"
  if ! grep -q "$term" "$README"; then
    echo "FAIL: Missing required content: $label"
    FAIL=1
  fi
}

# ---------------------------------------------------------------------------
# Forbidden internal terms
# ---------------------------------------------------------------------------

check_absent "MOODEX"
check_absent "Botworks"
check_absent "provisional patent"
check_absent "Redmine"
check_absent "ChatGPT"
check_absent "beta" "beta qualifier (CEO policy: V1.0 is not beta)"

# ---------------------------------------------------------------------------
# Forbidden: test counts (communication policy violation)
# Test counts are internal metrics only
# ---------------------------------------------------------------------------

if grep -qP '\b\d{3,},?\d*\+?\s*tests?\b' "$README"; then
  echo "FAIL: Test count found in README (communication policy violation)"
  FAIL=1
fi

# Also catch specific known test count patterns
for count in "3,670" "3670" "5373" "5,373" "5411" "5,411"; do
  if grep -q "$count" "$README"; then
    echo "FAIL: Test count '$count' found in README"
    FAIL=1
  fi
done

# ---------------------------------------------------------------------------
# Required content
# ---------------------------------------------------------------------------

check_present "docker run" "Docker quickstart"
check_present "CrewAI" "Comparison table"
check_present "AutoGen" "Comparison table (AutoGen)"
check_present "LangGraph" "Comparison table (LangGraph)"
check_present "Architecture Constraints" "Architecture Constraints section"
check_present "AGPL" "AGPL-3.0 license"
check_present "1.0.0\|latest" "Version reference (1.0.0 or latest)"
check_present "external" "External auditor mention"
check_present "governance" "Governance content"
check_present "pre-action\|pre_action\|Pre-Action\|Stage 0" "Pre-action enforcement"

# ---------------------------------------------------------------------------
# Version reference
# ---------------------------------------------------------------------------

if ! grep -qE '1\.0\.0|latest' "$README"; then
  echo "WARNING: No version reference (1.0.0 or latest) found"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

echo ""
if [ "$FAIL" -eq 0 ]; then
  echo "ALL CHECKS PASSED"
else
  echo "SOME CHECKS FAILED — see above"
  exit 1
fi
