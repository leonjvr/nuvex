#!/usr/bin/env bash
# scripts/verify-watermark.sh — Verify SIDJUA watermarks in a Docker image
# INTERNAL ONLY — not committed to git (listed in .gitignore)
set -euo pipefail

IMAGE="${1:-sidjua:latest}"

echo "=== SIDJUA Watermark Verification: ${IMAGE} ==="
echo ""

echo "--- OCI Labels ---"
docker inspect --format='{{json .Config.Labels}}' "${IMAGE}" 2>/dev/null \
  | python3 -m json.tool 2>/dev/null || echo "(docker not available)"

echo ""
echo "--- Build Metadata ---"
docker run --rm "${IMAGE}" cat /app/.build-meta 2>/dev/null \
  | python3 -m json.tool 2>/dev/null || echo "(not found)"

echo ""
echo "--- NOTICE ---"
docker run --rm "${IMAGE}" head -5 /app/NOTICE 2>/dev/null || echo "(not found)"

echo ""
echo "--- Binary Strings (SIDJUA markers in dist/index.js) ---"
docker run --rm "${IMAGE}" grep -c "sidjua" /app/dist/index.js 2>/dev/null \
  | xargs -I{} echo "  {} occurrences of 'sidjua' in compiled bundle"

echo ""
echo "--- SPDX Headers in Source (if source present) ---"
docker run --rm "${IMAGE}" sh -c \
  'find /app/src -name "*.ts" 2>/dev/null | head -5 | xargs -I{} head -1 {} 2>/dev/null' \
  || echo "  (source not present in production image)"

echo ""
echo "=== Verification complete ==="
