# Builds the installable Windows release end to end:
#   1. freezes the Python sidecar into a standalone habit-sidecar.exe (PyInstaller)
#   2. copies it into src-tauri/binaries/ so Tauri bundles it as a resource
#   3. runs the Tauri build → installer under src-tauri/target/release/bundle/
#
# RUN IT AS A FILE (do NOT paste the lines into a prompt — $PSScriptRoot is only set for a file):
#   powershell -ExecutionPolicy Bypass -File apps\desktop\scripts\build-release.ps1
#
# Only changed Rust/frontend (not the Python sidecar)? Skip the slow freeze:
#   powershell -ExecutionPolicy Bypass -File apps\desktop\scripts\build-release.ps1 -SkipFreeze
param([switch]$SkipFreeze)
$ErrorActionPreference = "Stop"

# $PSScriptRoot is empty when lines are pasted interactively — fail with a clear message instead of
# a confusing chain of null-path errors.
if (-not $PSScriptRoot) {
    throw "Run this as a file, not by pasting: powershell -ExecutionPolicy Bypass -File apps\desktop\scripts\build-release.ps1"
}

$repo     = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
$pipeline = Join-Path $repo "services\pipeline"
$desktop  = Join-Path $repo "apps\desktop"
$binaries = Join-Path $desktop "src-tauri\binaries"

if ($SkipFreeze) {
    Write-Host "==> Skipping freeze (reusing existing binaries\habit-sidecar.exe)" -ForegroundColor Yellow
    if (-not (Test-Path (Join-Path $binaries "habit-sidecar.exe"))) {
        throw "-SkipFreeze given but no sidecar at $binaries\habit-sidecar.exe. Run once without -SkipFreeze."
    }
} else {
    Write-Host "==> Freezing sidecar with PyInstaller..." -ForegroundColor Cyan
    Push-Location $pipeline
    try {
        uv run --with pyinstaller pyinstaller --onefile --name habit-sidecar --noconfirm `
            --paths . `
            --collect-submodules uvicorn `
            --collect-all cv2 `
            --hidden-import multipart `
            api/main.py
    } finally {
        Pop-Location
    }

    $frozen = Join-Path $pipeline "dist\habit-sidecar.exe"
    if (-not (Test-Path $frozen)) { throw "PyInstaller did not produce $frozen" }

    Write-Host "==> Copying sidecar into $binaries" -ForegroundColor Cyan
    New-Item -ItemType Directory -Force -Path $binaries | Out-Null
    Copy-Item $frozen (Join-Path $binaries "habit-sidecar.exe") -Force
}

Write-Host "==> Building Tauri installer..." -ForegroundColor Cyan
Push-Location $desktop
try {
    # npm.cmd (not `npm`) so a restricted PowerShell execution policy that blocks npm.ps1 can't stop us.
    npm.cmd run tauri build
    if ($LASTEXITCODE -ne 0) { throw "tauri build failed (exit $LASTEXITCODE)" }
} finally {
    Pop-Location
}

Write-Host "==> Done. Installer(s) under $desktop\src-tauri\target\release\bundle\" -ForegroundColor Green
