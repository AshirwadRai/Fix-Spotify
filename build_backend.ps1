$ErrorActionPreference = "Stop"

Write-Host "Building Python Backend with PyInstaller..." -ForegroundColor Cyan

# Ensure we're in the right directory (project root)
$projectRoot = $PSScriptRoot
Set-Location $projectRoot

# Step 1: Run PyInstaller
Write-Host "Running PyInstaller..."
C:\Users\Ashir\AppData\Local\hermes\hermes-agent\venv\Scripts\pyinstaller.exe backend.spec --clean --noconfirm

if ($LASTEXITCODE -ne 0) {
    Write-Host "PyInstaller failed with exit code $LASTEXITCODE" -ForegroundColor Red
    exit $LASTEXITCODE
}

# Step 2: Copy and rename the sidecar executable for Tauri
$targetTriple = "x86_64-pc-windows-msvc"
$sourceExe = Join-Path -Path "dist" -ChildPath "backend.exe"
$destExe = Join-Path -Path "frontend" -ChildPath "src-tauri" | Join-Path -ChildPath "backend-$targetTriple.exe"

Write-Host "Copying backend.exe to Tauri sidecar directory ($destExe)..." -ForegroundColor Yellow

# Create directory if it doesn't exist
$destDir = Split-Path -Path $destExe -Parent
if (-not (Test-Path -Path $destDir)) {
    New-Item -ItemType Directory -Force -Path $destDir | Out-Null
}

Copy-Item -Path $sourceExe -Destination $destExe -Force

Write-Host "Done! The Python sidecar is ready to be bundled with Tauri." -ForegroundColor Green
Write-Host "To build the final MSI/EXE, run: cd frontend; npm run tauri build" -ForegroundColor Green
