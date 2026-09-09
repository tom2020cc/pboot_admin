@echo off
setlocal
set "ROOT=%~dp0.."
set "BACKEND_DIR=%ROOT%\backend"
set "BACKEND_PORT=5108"

if exist "%BACKEND_DIR%\.env" (
  for /f "usebackq tokens=1,* delims==" %%A in ("%BACKEND_DIR%\.env") do (
    if /I "%%A"=="BACKEND_PORT" set "BACKEND_PORT=%%B"
  )
)

title Pboot Admin Backend API - %BACKEND_PORT%
cd /d "%BACKEND_DIR%"

echo.
echo ============================================
echo   Pboot Admin Backend API
echo ============================================
echo Port: http://localhost:%BACKEND_PORT%/api-docs
echo Keep this window open while using the admin.
echo If the backend exits, this window will retry.
echo ============================================

:build
echo.
echo [Backend] Building latest code...
call pnpm run build
if errorlevel 1 (
  echo.
  echo [Backend] Build failed. Check the error above.
  echo [Backend] Retrying in 10 seconds. Press Ctrl+C to stop.
  timeout /t 10 /nobreak >nul
  goto build
)

:run
echo.
echo [Backend] Starting API on port %BACKEND_PORT%...
call pnpm run start:prod
echo.
echo [Backend] API process stopped. Retrying in 5 seconds. Press Ctrl+C to stop.
timeout /t 5 /nobreak >nul
goto run
