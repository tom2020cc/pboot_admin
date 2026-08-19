@echo off
setlocal
set "ROOT=%~dp0"
set /a PORT=5190

if not exist "%ROOT%tools\config_wizard\server.js" (
  echo ERROR: tools\config_wizard\server.js was not found.
  pause
  exit /b 1
)

:find_port
netstat -ano | findstr /R /C:":%PORT% .*LISTENING" >nul 2>nul
if errorlevel 1 goto port_ready
set /a PORT+=1
if %PORT% LEQ 5199 goto find_port
echo ERROR: Config ports 5190-5199 are all in use.
pause
exit /b 1

:port_ready
set "CONFIG_WIZARD_PORT=%PORT%"
echo Opening this project's config wizard on port %PORT%...
start "" "http://localhost:%PORT%"
cd /d "%ROOT%tools\config_wizard"
node server.js
exit /b 0
