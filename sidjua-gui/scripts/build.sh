#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# SIDJUA Desktop GUI — build script
#
# Usage:
#   ./scripts/build.sh [--target linux|macos|windows] [--debug]
#
# Produces platform bundles in src-tauri/target/release/bundle/
# ---------------------------------------------------------------------------

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GUI_DIR="$(dirname "$SCRIPT_DIR")"

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------

TARGET=""
DEBUG=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)
      TARGET="$2"; shift 2 ;;
    --debug)
      DEBUG=1; shift ;;
    *)
      echo "Unknown argument: $1" >&2
      echo "Usage: $0 [--target linux|macos|windows] [--debug]" >&2
      exit 1 ;;
  esac
done

# ---------------------------------------------------------------------------
# Detect host platform if no --target specified
# ---------------------------------------------------------------------------

if [[ -z "$TARGET" ]]; then
  case "$(uname -s)" in
    Linux*)  TARGET="linux"   ;;
    Darwin*) TARGET="macos"   ;;
    MINGW*|CYGWIN*|MSYS*) TARGET="windows" ;;
    *) echo "Unsupported OS: $(uname -s)" >&2; exit 1 ;;
  esac
fi

echo "==> Building SIDJUA GUI for: $TARGET (debug=$DEBUG)"

cd "$GUI_DIR"

# ---------------------------------------------------------------------------
# Prerequisites check
# ---------------------------------------------------------------------------

command -v node  >/dev/null 2>&1 || { echo "node not found" >&2; exit 1; }
command -v npm   >/dev/null 2>&1 || { echo "npm not found"  >&2; exit 1; }
command -v cargo >/dev/null 2>&1 || { echo "cargo not found (install Rust from https://rustup.rs)" >&2; exit 1; }

echo "==> Installing npm dependencies"
npm ci --prefer-offline 2>/dev/null || npm install

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------

if [[ "$DEBUG" -eq 1 ]]; then
  echo "==> Running tauri build (debug)"
  npx tauri build --debug
else
  echo "==> Running tauri build (release)"
  npx tauri build
fi

# ---------------------------------------------------------------------------
# Summarise artifacts
# ---------------------------------------------------------------------------

BUNDLE_DIR="$GUI_DIR/src-tauri/target/release/bundle"
[[ "$DEBUG" -eq 1 ]] && BUNDLE_DIR="$GUI_DIR/src-tauri/target/debug/bundle"

echo ""
echo "==> Build complete. Artifacts:"

case "$TARGET" in
  linux)
    find "$BUNDLE_DIR" \( -name "*.deb" -o -name "*.rpm" -o -name "*.AppImage" \) 2>/dev/null \
      | while read -r f; do echo "    $f ($(du -sh "$f" | cut -f1))"; done ;;
  macos)
    find "$BUNDLE_DIR" \( -name "*.dmg" -o -name "*.app" \) -maxdepth 3 2>/dev/null \
      | while read -r f; do echo "    $f ($(du -sh "$f" | cut -f1))"; done ;;
  windows)
    find "$BUNDLE_DIR" \( -name "*.msi" -o -name "*.exe" \) 2>/dev/null \
      | while read -r f; do echo "    $f ($(du -sh "$f" | cut -f1))"; done ;;
esac

echo ""
echo "Done."
