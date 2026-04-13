# Build NUVEX Desktop Agent with PyInstaller
# Run from repo root: .\scripts\build-desktop-agent.ps1

param(
    [string]$OutputDir = "dist"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ScriptDir = $PSScriptRoot
$RepoRoot  = Split-Path $ScriptDir -Parent
$AgentDir  = Join-Path $RepoRoot "src\desktop_agent"

Write-Host "=== NUVEX Desktop Agent Build ===" -ForegroundColor Cyan

# Create a virtual environment
$VenvDir = Join-Path $RepoRoot ".venv-desktop-build"
if (-not (Test-Path $VenvDir)) {
    Write-Host "Creating venv at $VenvDir"
    python -m venv $VenvDir
}

$PipExe  = Join-Path $VenvDir "Scripts\pip.exe"
$PyExe   = Join-Path $VenvDir "Scripts\python.exe"

# Install dependencies
Write-Host "Installing dependencies..."
& $PipExe install pyinstaller --quiet
& $PipExe install --quiet `
    pywinauto pywin32 mss pynput pyautogui pystray winotify `
    pyperclip websockets pillow pydantic

# Ensure assets directory exists
$AssetsDir = Join-Path $AgentDir "assets"
New-Item -ItemType Directory -Force -Path $AssetsDir | Out-Null

# Run PyInstaller
Write-Host "Running PyInstaller..."
$SpecFile = Join-Path $AgentDir "nuvex-desktop.spec"
Push-Location $AgentDir
try {
    & (Join-Path $VenvDir "Scripts\pyinstaller.exe") $SpecFile `
        --distpath (Join-Path $RepoRoot $OutputDir) `
        --workpath (Join-Path $RepoRoot "build\desktop-agent") `
        --noconfirm
} finally {
    Pop-Location
}

Write-Host "=== Build complete: $OutputDir\nuvex-desktop.exe ===" -ForegroundColor Green
