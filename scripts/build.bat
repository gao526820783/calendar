@echo off
REM ============================================================
REM  Build + Package launcher - Desktop Weather Calendar Widget
REM  Double-click this file to produce installers under dist\
REM
REM  Outputs:
REM    dist\installer\*.exe   NSIS installer
REM    dist\installer\*.msi   MSI installer
REM    dist\portable\*.exe    standalone exe (no install)
REM
REM  Internally calls build.ps1 with execution policy bypass,
REM  so you do NOT need to change the system PowerShell policy.
REM ============================================================

setlocal
set "SCRIPT_DIR=%~dp0"

echo ============================================
echo  Building Desktop Weather Calendar Widget...
echo  Baseline check -^> Vite build -^> Rust release -^> NSIS + MSI
echo  First Rust compile may take several minutes.
echo ============================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%build.ps1"

if errorlevel 1 (
    echo.
    echo [ERROR] Build failed. See messages above.
    pause
    exit /b 1
)

echo.
echo Build finished. Installers are in "dist\installer".
pause
