#!/bin/bash
# SIDJUA — AI Agent Governance Platform
# Double-click to start SIDJUA on macOS.

cd "$(dirname "$0")"

echo ""
echo " ┌─────────────────────────────────────────┐"
echo " │  SIDJUA — AI Agent Governance Platform  │"
echo " │  v1.0.0                                 │"
echo " └─────────────────────────────────────────┘"
echo ""

# ------------------------------------------------------------
# 1. Check Docker is installed
# ------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
    echo " Docker Desktop is required to run SIDJUA."
    echo ""
    echo " Please follow these steps:"
    echo "  1. Download Docker Desktop from:"
    echo "     https://www.docker.com/products/docker-desktop/"
    echo "  2. Install it"
    echo "  3. Start Docker Desktop and wait until the whale icon"
    echo "     in the menu bar is steady"
    echo "  4. Then double-click this file again"
    echo ""
    read -rp " Press Enter to close..." _
    exit 1
fi

# ------------------------------------------------------------
# 2. Check Docker daemon is running
# ------------------------------------------------------------
if ! docker info >/dev/null 2>&1; then
    echo " Docker Desktop is installed but not running."
    echo ""
    echo " Please follow these steps:"
    echo "  1. Start Docker Desktop (find it in your Applications folder)"
    echo "  2. Wait until the whale icon in the menu bar is steady"
    echo "  3. Then double-click this file again"
    echo ""
    read -rp " Press Enter to close..." _
    exit 1
fi

# ------------------------------------------------------------
# 3. Stop any existing SIDJUA container (frees port 4200 for restart)
# ------------------------------------------------------------
docker compose down >/dev/null 2>&1

# ------------------------------------------------------------
# 4. Check port 4200 is free (non-SIDJUA process using it)
# ------------------------------------------------------------
if lsof -i :4200 >/dev/null 2>&1; then
    echo " ERROR: Port 4200 is already in use by another application."
    echo ""
    echo " Close the application using port 4200 and try again."
    echo ""
    read -rp " Press Enter to close..." _
    exit 1
fi

# ------------------------------------------------------------
# 5. Start SIDJUA
# ------------------------------------------------------------
echo " Starting SIDJUA..."
echo " (First run may take a few minutes to download the image)"
echo ""
if ! docker compose up -d; then
    echo ""
    echo " ERROR: Failed to start SIDJUA."
    echo " Check the output above for details."
    echo ""
    read -rp " Press Enter to close..." _
    exit 1
fi

# ------------------------------------------------------------
# 6. Wait for health check (max 60 seconds)
# ------------------------------------------------------------
echo " Waiting for SIDJUA to start..."
attempts=0
max_attempts=20

while [ $attempts -lt $max_attempts ]; do
    attempts=$((attempts + 1))
    if curl -sf http://localhost:4200/api/v1/health >/dev/null 2>&1; then
        break
    fi
    printf "."
    sleep 3
done

if [ $attempts -ge $max_attempts ]; then
    echo ""
    echo ""
    echo " ERROR: SIDJUA did not start within 60 seconds."
    echo ""
    echo " Check Docker Desktop for errors, then run:"
    echo "   docker compose logs"
    echo ""
    read -rp " Press Enter to close..." _
    exit 1
fi

echo ""
echo ""
echo " ✓ SIDJUA is running!"
echo ""
echo " Opening http://localhost:4200 ..."
open http://localhost:4200
echo ""
echo " To stop SIDJUA:  docker compose down"
echo " View logs:       docker compose logs -f"
echo ""
read -rp " Press Enter to close..." _
exit 0
