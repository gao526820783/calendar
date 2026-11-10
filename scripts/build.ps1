# Desktop Weather Calendar Widget - build script (Windows)
# Usage: powershell -ExecutionPolicy Bypass -File scripts\build.ps1
# Output: dist\  (NSIS .exe + MSI installers)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# Repo root = parent of scripts dir
$root = Split-Path -Parent $PSScriptRoot
$proj = Join-Path $root "desktop-widget"
$outDist = Join-Path $root "dist"

Write-Host "==> Root:    $root" -ForegroundColor Cyan
Write-Host "==> Project: $proj" -ForegroundColor Cyan

# 0) Preflight checks
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
    Push-Location $proj; npm install; Pop-Location
}

# 2) Tauri build (runs vite build + cargo build --release + bundles installers)
#    Bundle target: msi only. NSIS (.exe) requires a one-time NSIS tool download
#    that can time out offline; MSI is self-contained and reliable here.
#    Pre-clean old bundle dirs to avoid stale installers from previous product names.
$bundleMsi = Join-Path $proj "src-tauri\target\release\bundle\msi"
$bundleNsis = Join-Path $proj "src-tauri\target\release\bundle\nsis"
if (Test-Path $bundleMsi)  { Remove-Item $bundleMsi  -Recurse -Force -ErrorAction SilentlyContinue }
if (Test-Path $bundleNsis) { Remove-Item $bundleNsis -Recurse -Force -ErrorAction SilentlyContinue }

Write-Host "==> Tauri build (first Rust compile is slow) ..." -ForegroundColor Yellow
Push-Location $proj
npm run tauri -- build --bundles msi
Pop-Location

# 3) Collect artifacts into root dist/
$bundle = Join-Path $proj "src-tauri\target\release\bundle"
if (-not (Test-Path $bundle)) {
    throw "Build finished but bundle dir not found: $bundle"
}

if (Test-Path $outDist) { Remove-Item $outDist -Recurse -Force }
New-Item -ItemType Directory -Path $outDist | Out-Null

# NSIS installer (.exe)
$nsis = Join-Path $bundle "nsis"
if (Test-Path $nsis) {
    Copy-Item (Join-Path $nsis "*.exe") $outDist
}
# MSI installer
$msi = Join-Path $bundle "msi"
if (Test-Path $msi) {
    Copy-Item (Join-Path $msi "*.msi") $outDist
}

# 4) Portable build (standalone exe, no install needed)
$releaseDir = Join-Path $proj "src-tauri\target\release"
$exe = Get-ChildItem $releaseDir -Filter "mywether.exe" -ErrorAction SilentlyContinue
if ($exe) {
    $portable = Join-Path $outDist "portable"
    New-Item -ItemType Directory -Path $portable -Force | Out-Null
    Copy-Item $exe.FullName $portable
    # WebView2Loader runtime dll if present (needed alongside exe)
    Get-ChildItem $releaseDir -Filter "WebView2Loader.dll" -ErrorAction SilentlyContinue |
        ForEach-Object { Copy-Item $_.FullName $portable }
}

# 5) Summary
Write-Host ""
Write-Host "==> Build done. Artifacts in: $outDist" -ForegroundColor Green
Get-ChildItem $outDist -Recurse -File | ForEach-Object {
    $sizeMB = [math]::Round($_.Length / 1MB, 2)
    Write-Host ("    {0}  ({1} MB)" -f $_.FullName.Replace($root + "\", ""), $sizeMB)
}
