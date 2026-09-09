@echo off
setlocal
set "ROOT=%~dp0"
set "FRONTEND_PORT=5278"

if exist "%ROOT%backend\.env" (
  for /f "usebackq tokens=1,* delims==" %%A in ("%ROOT%backend\.env") do (
    if /I "%%A"=="FRONTEND_PORT" set "FRONTEND_PORT=%%B"
  )
)

call "%ROOT%02-start.cmd" --no-browser
if errorlevel 1 exit /b 1

powershell -NoProfile -Command "Start-Sleep -Seconds 4"
start "" "http://localhost:%FRONTEND_PORT%/#/sites"
exit /b 0
