@echo off
setlocal
set "ROOT=%~dp0.."
set "PROJECT_ROOT=%ROOT%"
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
echo ============================================

REM Pre-check: exit if this project's backend already owns the port (no duplicate window).
call :check_backend_port
if "%PORT_STATUS%"=="PROJECT" (
  echo.
  echo [Backend] Already running on port %BACKEND_PORT%. This window will not start a second instance.
  echo [Backend] Use the already-running window instead.
  timeout /t 4 /nobreak >nul
  exit /b 0
)
if "%PORT_STATUS%"=="FOREIGN" (
  echo.
  echo [Backend] Port %BACKEND_PORT% is used by another program. Cannot start this backend.
  echo [Backend] Stop that program or change BACKEND_PORT in backend\.env.
  echo [Backend] This window will close.
  timeout /t 6 /nobreak >nul
  exit /b 1
)

REM Build only when needed (dist missing or source newer than dist).
call :do_build

REM Start and keep alive. Exit if another backend instance takes over the port.
:run
echo.
echo [Backend] Starting API on port %BACKEND_PORT%...
call pnpm run start:prod

call :check_backend_port
if "%PORT_STATUS%"=="PROJECT" (
  echo.
  echo [Backend] Port %BACKEND_PORT% is now served by another backend instance. This window exits.
  timeout /t 4 /nobreak >nul
  exit /b 0
)
if "%PORT_STATUS%"=="FOREIGN" (
  echo.
  echo [Backend] Port %BACKEND_PORT% is used by another program. This window exits.
  timeout /t 4 /nobreak >nul
  exit /b 1
)

echo.
echo [Backend] API process stopped. Retrying in 5 seconds. Press Ctrl+C to stop.
timeout /t 5 /nobreak >nul
goto run

:do_build
call :needs_build
if "%NEEDS_BUILD%"=="NO" (
  echo.
  echo [Backend] dist is up to date. Skipping build.
  exit /b 0
)
:build_retry
echo.
echo [Backend] Building latest code...
call pnpm run build
if errorlevel 1 (
  echo.
  echo [Backend] Build failed. Check the error above.
  echo [Backend] Retrying in 10 seconds. Press Ctrl+C to stop.
  timeout /t 10 /nobreak >nul
  goto build_retry
)
exit /b 0

:check_backend_port
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%tools\project-port.ps1" -Port %BACKEND_PORT% -Root "%PROJECT_ROOT%" >nul 2>nul
if errorlevel 20 (set "PORT_STATUS=FOREIGN") else if errorlevel 10 (set "PORT_STATUS=PROJECT") else (set "PORT_STATUS=FREE")
exit /b 0

:needs_build
set "NEEDS_BUILD=YES"
if not exist "%BACKEND_DIR%\dist\main.js" exit /b 0
powershell -NoProfile -Command "$d=Get-Item '%BACKEND_DIR%\dist\main.js'; $new=@(Get-ChildItem '%BACKEND_DIR%\src' -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.Extension -in '.ts','.js','.json' -and $_.LastWriteTime -gt $d.LastWriteTime }); if ($new.Count -gt 0) { exit 10 } else { exit 0 }" >nul 2>nul
if errorlevel 10 (set "NEEDS_BUILD=YES") else (set "NEEDS_BUILD=NO")
exit /b 0
