@echo off
setlocal
set "ROOT=%~dp0"
set "PROJECT_ROOT=%ROOT:~0,-1%"
set "BACKEND_PORT=5108"
set "FRONTEND_PORT=5278"

echo.
echo ============================================
echo   Pboot Admin - Start management service
echo ============================================

where pnpm >nul 2>nul
if errorlevel 1 (
  echo ERROR: pnpm was not found. Run 00-install.cmd first.
  pause
  exit /b 1
)

if not exist "%ROOT%backend\.env" (
  if not exist "%ROOT%backend\.env.example" (
    echo ERROR: backend\.env.example was not found.
    pause
    exit /b 1
  )
  echo Creating backend\.env from the system defaults...
  copy /Y "%ROOT%backend\.env.example" "%ROOT%backend\.env" >nul
)

for /f "usebackq tokens=1,* delims==" %%A in ("%ROOT%backend\.env") do (
  if /I "%%A"=="BACKEND_PORT" set "BACKEND_PORT=%%B"
  if /I "%%A"=="FRONTEND_PORT" set "FRONTEND_PORT=%%B"
)

if not exist "%ROOT%backend\node_modules" (
  echo ERROR: backend dependencies are missing. Run 00-install.cmd first.
  pause
  exit /b 1
)
if not exist "%ROOT%frontend\node_modules" (
  echo ERROR: frontend dependencies are missing. Run 00-install.cmd first.
  pause
  exit /b 1
)

call :check_project_port %BACKEND_PORT%
if "%PORT_STATUS%"=="FOREIGN" (
  echo ERROR: backend port %BACKEND_PORT% belongs to another project.
  pause
  exit /b 1
)
set "BACKEND_STATUS=%PORT_STATUS%"

call :check_project_port %FRONTEND_PORT%
if "%PORT_STATUS%"=="FOREIGN" (
  echo ERROR: frontend port %FRONTEND_PORT% belongs to another project.
  pause
  exit /b 1
)
set "FRONTEND_STATUS=%PORT_STATUS%"

echo.
if "%BACKEND_STATUS%"=="PROJECT" (
  echo Backend is already running on port %BACKEND_PORT% - skip.
) else (
  echo Opening the persistent backend API terminal on port %BACKEND_PORT%...
  start "Pboot Admin Backend API - %BACKEND_PORT%" /D "%ROOT%" "%COMSPEC%" /k ""%ROOT%tools\run-backend.cmd""
)

if "%FRONTEND_STATUS%"=="PROJECT" (
  echo Frontend is already running on port %FRONTEND_PORT% - skip.
) else (
  echo Starting frontend in the background on port %FRONTEND_PORT%...
  powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%tools\start-hidden.ps1" -Exe "cmd" -CmdArgs "/c pnpm exec vite --host localhost --port %FRONTEND_PORT%" -Dir "%ROOT%frontend" -Log "%ROOT%logs\frontend"
)

echo.
echo Backend terminal: keep the visible window open.
echo Backend API:      http://localhost:%BACKEND_PORT%/api-docs
echo Frontend:         http://localhost:%FRONTEND_PORT%
echo Frontend log:     %ROOT%logs\frontend.out.log

if /I "%~1"=="--no-browser" exit /b 0
powershell -NoProfile -Command "Start-Sleep -Seconds 4"
start "" "http://localhost:%FRONTEND_PORT%"
timeout /t 2 /nobreak >nul
exit /b 0

:check_project_port
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%tools\project-port.ps1" -Port %~1 -Root "%PROJECT_ROOT%" >nul 2>nul
if errorlevel 20 (set "PORT_STATUS=FOREIGN") else if errorlevel 10 (set "PORT_STATUS=PROJECT") else (set "PORT_STATUS=FREE")
exit /b 0
