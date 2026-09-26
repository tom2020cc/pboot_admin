@echo off
setlocal
set "ROOT=%~dp0"
set "PROJECT_ROOT=%ROOT:~0,-1%"
set "BACKEND_PORT=5108"
set "FRONTEND_PORT=5278"
if exist "%ROOT%backend\.env" (
  for /f "usebackq tokens=1,* delims==" %%A in ("%ROOT%backend\.env") do (
    if /I "%%A"=="BACKEND_PORT" set "BACKEND_PORT=%%B"
    if /I "%%A"=="FRONTEND_PORT" set "FRONTEND_PORT=%%B"
  )
)

echo This will close backend/frontend ports %BACKEND_PORT% / %FRONTEND_PORT%.
echo SEO/FTP tools will be closed by this project's recorded process IDs.
echo Use this if old windows were closed but ports are still occupied.
pause

node "%ROOT%tools\stop-project-processes.js"

REM Tip: for the cleanest backend shutdown (lets it finish writing dev.sqlite),
REM press Ctrl+C (or close that window) in the BACKEND window. The backend now
REM catches that and flushes before exiting. This script can only force-kill
REM (Windows has no way to signal another console app gracefully from a script).
echo Stopping this project's backend/frontend on ports %BACKEND_PORT% / %FRONTEND_PORT%...
for %%P in (%BACKEND_PORT% %FRONTEND_PORT%) do (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%tools\project-port.ps1" -Port %%P -Root "%PROJECT_ROOT%" -Mode Stop
)

echo Done.
powershell -NoProfile -Command "Start-Sleep -Seconds 3"
