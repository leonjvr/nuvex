@echo off
chcp 65001 >nul 2>&1
cd /d "%~dp0"
title SIDJUA Launcher

echo.
echo  ┌─────────────────────────────────────────┐
echo  │  SIDJUA — AI Agent Governance Platform  │
echo  │  v1.0.0                                 │
echo  └─────────────────────────────────────────┘
echo.

:: ------------------------------------------------------------
:: 1. Check Docker is installed
:: ------------------------------------------------------------
where docker >nul 2>&1
if %errorlevel% neq 0 (
    echo  Docker Desktop is required to run SIDJUA.
    echo.
    echo  Please follow these steps:
    echo   1. Download Docker Desktop from:
    echo      https://www.docker.com/products/docker-desktop/
    echo   2. Install it
    echo   3. Start Docker Desktop and wait until the Docker icon
    echo      in the system tray is steady
    echo   4. Then double-click this file again
    echo.
    pause
    exit /b 1
)

:: ------------------------------------------------------------
:: 2. Check Docker daemon is running
:: ------------------------------------------------------------
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo  Docker Desktop is installed but not running.
    echo.
    echo  Please follow these steps:
    echo   1. Start Docker Desktop (find it in the Start menu)
    echo   2. Wait until the Docker icon in the system tray is steady
    echo   3. Then double-click this file again
    echo.
    pause
    exit /b 1
)

:: ------------------------------------------------------------
:: 3. Stop any existing SIDJUA container (frees port 4200 for restart)
:: ------------------------------------------------------------
docker compose down >nul 2>&1

:: ------------------------------------------------------------
:: 4. Check port 4200 is free (non-SIDJUA process using it)
:: ------------------------------------------------------------
netstat -an 2>nul | findstr /C:":4200 " >nul 2>&1
if %errorlevel% equ 0 (
    echo  ERROR: Port 4200 is already in use by another application.
    echo.
    echo  Close the application using port 4200 and try again.
    echo.
    pause
    exit /b 1
)

:: ------------------------------------------------------------
:: 5. Start SIDJUA
:: ------------------------------------------------------------
echo  Starting SIDJUA...
echo  (First run may take a few minutes to download the image)
echo.
docker compose up -d
if %errorlevel% neq 0 (
    echo.
    echo  ERROR: Failed to start SIDJUA.
    echo  Check the output above for details.
    echo.
    pause
    exit /b 1
)

:: ------------------------------------------------------------
:: 6. Wait for health check (max 60 seconds)
:: ------------------------------------------------------------
echo  Waiting for SIDJUA to start...
set /a attempts=0
set /a max_attempts=20

:health_loop
set /a attempts+=1
if %attempts% gtr %max_attempts% goto timeout

:: Try curl first, fall back to PowerShell
curl -sf http://localhost:4200/api/v1/health >nul 2>&1
if %errorlevel% equ 0 goto healthy

powershell -NoProfile -Command "(Invoke-WebRequest -Uri http://localhost:4200/api/v1/health -UseBasicParsing -TimeoutSec 3).StatusCode" >nul 2>&1
if %errorlevel% equ 0 goto healthy

<nul set /p "=."
timeout /t 3 /nobreak >nul 2>&1
goto health_loop

:healthy
echo.
echo.
echo  ✓ SIDJUA is running!
echo.
echo  Opening http://localhost:4200 ...
start http://localhost:4200
echo.
echo  To stop SIDJUA:  docker compose down
echo  View logs:       docker compose logs -f
echo.
pause
exit /b 0

:timeout
echo.
echo.
echo  ERROR: SIDJUA did not start within 60 seconds.
echo.
echo  Check Docker Desktop for errors, then run:
echo    docker compose logs
echo.
pause
exit /b 1
