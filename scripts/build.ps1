# Desktop Weather Calendar Widget - build + package script (Windows)
# Usage: powershell -ExecutionPolicy Bypass -File scripts\build.ps1
# Outputs (under repo root dist\):
#   dist\installer\mywether_0.1.0_x64-setup.exe   (NSIS installer)
#   dist\installer\mywether_0.1.0_x64_en-US.msi   (MSI installer)
#   dist\portable\mywether.exe                    (standalone, no install)
#   dist\release\mywether.exe                     (kept in sync if not locked)
#
# NOTE: keep this file ASCII-only. Windows PowerShell 5.1 reads BOM-less
# UTF-8 as ANSI, which garbles non-ASCII output.

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$root    = Split-Path -Parent $PSScriptRoot
$proj    = Join-Path $root "desktop-widget"
$outDist = Join-Path $root "dist"

Write-Host "==> Root:    $root" -ForegroundColor Cyan
Write-Host "==> Project: $proj" -ForegroundColor Cyan

# 0) Preflight
if (-not (Test-Path (Join-Path $proj "src-tauri\tauri.conf.json"))) {
    throw "Not found: $proj\src-tauri\tauri.conf.json"
}
foreach ($cmd in @("node", "npm", "cargo")) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        throw "Missing tool: $cmd (install Node.js + Rust toolchain first)"
    }
}

# 1) Install frontend deps if needed
if (-not (Test-Path (Join-Path $proj "node_modules"))) {
    Write-Host "==> npm install ..." -ForegroundColor Yellow
    Push-Location $proj; npm install; if ($LASTEXITCODE -ne 0) { Pop-Location; throw "npm install failed" }; Pop-Location
}

# 2) Baseline contract check - fail early instead of shipping a regression
$checker = Join-Path $root "scripts\check-baseline.mjs"
if (Test-Path $checker) {
    Write-Host "==> Baseline check ..." -ForegroundColor Yellow
    Push-Location $root; node $checker; if ($LASTEXITCODE -ne 0) { Pop-Location; throw "Baseline check failed - aborting build" }; Pop-Location
}

# 3) Clean stale bundles so renamed versions cannot linger
$bundle = Join-Path $proj "src-tauri\target\release\bundle"
foreach ($sub in @("msi", "nsis")) {
    $p = Join-Path $bundle $sub
    if (Test-Path $p) { Remove-Item $p -Recurse -Force -ErrorAction SilentlyContinue }
}
# Only wipe our own output subfolders; never touch dist\release (running copy)
foreach ($sub in @("installer", "portable")) {
    $p = Join-Path $outDist $sub
    if (Test-Path $p) { Remove-Item $p -Recurse -Force -ErrorAction SilentlyContinue }
}

# 4) Tauri build: frontend + Rust release + BOTH installers
Write-Host "==> Tauri build (NSIS + MSI; first Rust compile is slow) ..." -ForegroundColor Yellow
Push-Location $proj
npm run tauri -- build --bundles nsis,msi
$buildExit = $LASTEXITCODE
Pop-Location
if ($buildExit -ne 0) { throw "Tauri build failed (exit $buildExit)" }

if (-not (Test-Path $bundle)) { throw "Build finished but bundle dir not found: $bundle" }

# 5) Collect installers
$installerDir = Join-Path $outDist "installer"
New-Item -ItemType Directory -Path $installerDir -Force | Out-Null
foreach ($sub in @("nsis", "msi")) {
    $src = Join-Path $bundle $sub
    if (Test-Path $src) {
        $pattern = if ($sub -eq "nsis") { "*.exe" } else { "*.msi" }
        Get-ChildItem $src -Filter $pattern -File | ForEach-Object {
            Copy-Item $_.FullName -Destination $installerDir -Force
        }
    }
}

# 6) Portable standalone exe
$releaseDir = Join-Path $proj "src-tauri\target\release"
$exe = Get-ChildItem $releaseDir -Filter "mywether.exe" -File -ErrorAction SilentlyContinue | Select-Object -First 1
if ($exe) {
    $portableDir = Join-Path $outDist "portable"
    New-Item -ItemType Directory -Path $portableDir -Force | Out-Null
    Copy-Item $exe.FullName -Destination $portableDir -Force
    Get-ChildItem $releaseDir -Filter "WebView2Loader.dll" -File -ErrorAction SilentlyContinue |
        ForEach-Object { Copy-Item $_.FullName -Destination $portableDir -Force }

    # 7) Refresh the working copy used by dist\release (skip if the app is running)
    $workingDir = Join-Path $outDist "release"
    New-Item -ItemType Directory -Path $workingDir -Force | Out-Null
    $workingExe = Join-Path $workingDir "mywether.exe"
    try {
        Copy-Item $exe.FullName -Destination $workingExe -Force -ErrorAction Stop
        Write-Host "==> Refreshed dist\release\mywether.exe" -ForegroundColor Green
    } catch {
        Write-Host "==> SKIPPED dist\release\mywether.exe (file locked - close the running app first)" -ForegroundColor Yellow
    }
}

# 8) Summary
Write-Host ""
Write-Host "==> Build done. Artifacts:" -ForegroundColor Green
Get-ChildItem $installerDir -File | ForEach-Object {
    Write-Host ("    {0}  ({1} MB)" -f $_.FullName.Replace($root + "\", ""), [math]::Round($_.Length / 1MB, 2))
}
if (Test-Path (Join-Path $outDist "portable")) {
    Get-ChildItem (Join-Path $outDist "portable") -File | ForEach-Object {
        Write-Host ("    {0}  ({1} MB)" -f $_.FullName.Replace($root + "\", ""), [math]::Round($_.Length / 1MB, 2))
    }
}
