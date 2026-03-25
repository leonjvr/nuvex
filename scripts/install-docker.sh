#!/usr/bin/env bash
# scripts/install-docker.sh — Install SIDJUA from a pre-built platform archive
#
# Usage:
#   ./scripts/install-docker.sh                      # auto-detect arch, latest version
#   ./scripts/install-docker.sh 1.0.0                # specific version
#   ./scripts/install-docker.sh 1.0.0 linux/arm64    # specific version + arch
#
# The script:
#   1. Auto-detects CPU architecture (amd64 / arm64)
#   2. Loads the matching sidjua-<version>-<arch>.tar.gz into Docker
#   3. Creates a canonical :version tag (sidjua:<version>)
#   4. Prints a ready-to-run docker command
set -euo pipefail

VERSION="${1:-}"
PLATFORM_ARG="${2:-}"

# ---------------------------------------------------------------------------
# Version resolution
# ---------------------------------------------------------------------------

if [ -z "${VERSION}" ]; then
  # Try to read from package.json in the current or parent directory
  for PKG in ./package.json ../package.json; do
    if [ -f "${PKG}" ]; then
      VERSION=$(node -p "require('${PKG}').version" 2>/dev/null || true)
      break
    fi
  done
  if [ -z "${VERSION}" ]; then
    echo "Error: could not determine version. Pass it as the first argument." >&2
    echo "Usage: $0 <version> [platform]" >&2
    exit 1
  fi
fi

# ---------------------------------------------------------------------------
# Architecture detection
# ---------------------------------------------------------------------------

if [ -n "${PLATFORM_ARG}" ]; then
  ARCH="${PLATFORM_ARG##*/}"
else
  RAW_ARCH="$(uname -m)"
  case "${RAW_ARCH}" in
    x86_64|amd64)   ARCH="amd64" ;;
    aarch64|arm64)  ARCH="arm64" ;;
    *)
      echo "Error: unsupported architecture '${RAW_ARCH}'." >&2
      echo "Supported: x86_64 (amd64), aarch64 (arm64)" >&2
      exit 1
      ;;
  esac
fi

ARCHIVE="sidjua-${VERSION}-${ARCH}.tar.gz"
ARCH_TAG="sidjua:${VERSION}-${ARCH}"
CANONICAL_TAG="sidjua:${VERSION}"

# ---------------------------------------------------------------------------
# Verify archive exists
# ---------------------------------------------------------------------------

if [ ! -f "${ARCHIVE}" ]; then
  echo "Error: archive not found: ${ARCHIVE}" >&2
  echo "Build it first with:  ./scripts/build-docker.sh" >&2
  exit 1
fi

# Optional checksum verification
CHECKSUM_FILE="${ARCHIVE}.sha256"
if [ -f "${CHECKSUM_FILE}" ]; then
  echo "Verifying checksum …"
  sha256sum --check --status "${CHECKSUM_FILE}" || {
    echo "Error: checksum mismatch for ${ARCHIVE}" >&2
    exit 1
  }
  echo "  Checksum OK"
fi

# ---------------------------------------------------------------------------
# Load image
# ---------------------------------------------------------------------------

echo "Loading ${ARCHIVE} into Docker …"
docker load < "${ARCHIVE}"

# Retag to canonical version (strip arch suffix)
echo "Tagging ${ARCH_TAG} → ${CANONICAL_TAG} …"
docker tag "${ARCH_TAG}" "${CANONICAL_TAG}"

# ---------------------------------------------------------------------------
# Usage hint
# ---------------------------------------------------------------------------

echo ""
echo "Image ready: ${CANONICAL_TAG}"
echo ""
echo "Run:"
echo "  docker run -d \\"
echo "    --name sidjua \\"
echo "    --security-opt no-new-privileges \\"
echo "    --cap-drop ALL \\"
echo "    -p 4200:4200 \\"
echo "    -v sidjua-data:/data \\"
echo "    ${CANONICAL_TAG}"
echo ""
echo "Open:  http://localhost:4200"
echo "Logs:  docker logs -f sidjua"
