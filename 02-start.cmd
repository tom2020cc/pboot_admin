@echo off
setlocal
set "ROOT=%~dp0"
set "BACKEND_PORT=5000"
set "FRONTEND_PORT=5173"

echo.
echo Pboot Admin pnpm starter
echo Root: %ROOT%

where pnpm >nul 2>nul
if errorlevel 1 (
  echo ERROR: pnpm was not found. Please run 00-install.cmd first.
  pause
  exit /b 1
)

if not exist "%ROOT%backend\.env" (
  echo.
  echo ERROR: backend\.env was not found.
  echo Please run 01-config.cmd, save configuration, then run this file again.
  pause
  exit /b 1
)

for /f "usebackq tokens=1,* delims==" %%A in ("%ROOT%backend\.env") do (
  if /I "%%A"=="BACKEND_PORT" set "BACKEND_PORT=%%B"
  if /I "%%A"=="FRONTEND_PORT" set "FRONTEND_PORT=%%B"
)

if not exist "%ROOT%backend\node_modules" (
  echo.
  echo ERROR: backend dependencies were not found.
  echo Please run 00-install.cmd first.
  pause
  exit /b 1
)

if not exist "%ROOT%frontend\node_modules" (
  echo.
  echo ERROR: frontend dependencies were not found.
  echo Please run 00-install.cmd first.
  pause
  exit /b 1
)

call :check_port %BACKEND_PORT%
if "%PORT_BUSY%"=="1" (
  echo.
  echo ERROR: port %BACKEND_PORT% is already in use.
  echo Run 04-stop-ports.cmd or close the old backend window.
  pause
  exit /b 1
)

call :check_port %FRONTEND_PORT%
if "%PORT_BUSY%"=="1" (
  echo.
  echo ERROR: port %FRONTEND_PORT% is already in use.
  echo Run 04-stop-ports.cmd or close the old frontend window.
  pause
  exit /b 1
)

echo.
echo Starting backend and frontend with pnpm...
start "Pboot Admin Backend %BACKEND_PORT%" /D "%ROOT%backend" cmd /k "pnpm run start:dev"
start "Pboot Admin Frontend %FRONTEND_PORT%" /D "%ROOT%frontend" cmd /k "pnpm run dev -- --host 0.0.0.0 --port %FRONTEND_PORT%"

echo.
echo Keep both windows open.
echo Backend docs: http://localhost:%BACKEND_PORT%/api-docs
echo Frontend:     http://localhost:%FRONTEND_PORT%
timeout /t 4 /nobreak >nul
start "" "http://localhost:%FRONTEND_PORT%"
timeout /t 5 /nobreak >nul
exit /b 0

:check_port
set "PORT_BUSY=0"
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /R /C:":%~1 .*LISTENING"') do (
  set "PORT_BUSY=1"
)
exit /b 0
