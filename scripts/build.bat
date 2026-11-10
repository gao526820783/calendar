@echo off
REM Build launcher for Desktop Weather Calendar Widget.
REM Double-click to run. Internally calls build.ps1 with execution policy bypass,
REM so you do NOT need to change the system PowerShell execution policy.

setlocal
set "SCRIPT_DIR=%~dp0"

echo ============================================
echo  Building Desktop Weather Calendar Widget...
echo  (First Rust compile may take several minutes)
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
echo Build finished. Artifacts are in the "dist" folder at the repo root.
pause
