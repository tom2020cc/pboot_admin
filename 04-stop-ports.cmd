@echo off
setlocal
set "ROOT=%~dp0"
set "BACKEND_PORT=5000"
set "FRONTEND_PORT=5173"
set "CONFIG_WIZARD_PORT=5190"
if exist "%ROOT%backend\.env" (
  for /f "usebackq tokens=1,* delims==" %%A in ("%ROOT%backend\.env") do (
    if /I "%%A"=="BACKEND_PORT" set "BACKEND_PORT=%%B"
    if /I "%%A"=="FRONTEND_PORT" set "FRONTEND_PORT=%%B"
    if /I "%%A"=="CONFIG_WIZARD_PORT" set "CONFIG_WIZARD_PORT=%%B"
  )
)

echo This will close backend/frontend/config-wizard ports %BACKEND_PORT% / %FRONTEND_PORT% / %CONFIG_WIZARD_PORT%.
echo SEO/FTP tools will be closed by this project's recorded process IDs.
echo Use this if old windows were closed but ports are still occupied.
pause

node "%ROOT%tools\stop-project-processes.js"

REM Tip: for the cleanest backend shutdown (lets it finish writing dev.sqlite),
REM press Ctrl+C (or close that window) in the BACKEND window. The backend now
REM catches that and flushes before exiting. This script can only force-kill
REM (Windows has no way to signal another console app gracefully from a script).
echo Stopping backend/frontend/config-wizard on ports %BACKEND_PORT% / %FRONTEND_PORT% / %CONFIG_WIZARD_PORT%...
for %%P in (%BACKEND_PORT% %FRONTEND_PORT% %CONFIG_WIZARD_PORT%) do (
  for /f "tokens=5" %%A in ('netstat -ano ^| findstr /R /C:":%%P .*LISTENING"') do (
    echo Killing PID %%A on port %%P
    taskkill /PID %%A /F >nul 2>&1
  )
)

echo Done.
timeout /t 3 /nobreak >nul
