@echo off
setlocal
set "ROOT=%~dp0"
set "PROJECT_ROOT=%ROOT:~0,-1%"
set "BACKEND_PORT=5108"
set "FRONTEND_PORT=5278"
set "SEO_PORT=5388"
set "FTP_PORT=5389"

echo.
echo ============================================
echo   Pboot Admin - Start all daily services
echo ============================================
echo Backend API stays in one visible terminal.
echo Frontend, SEO and FTP run quietly in the background.

where pnpm >nul 2>nul
if errorlevel 1 (
  echo ERROR: pnpm was not found. Run install.cmd first.
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
  echo ERROR: backend dependencies are missing. Run install.cmd first.
  pause
  exit /b 1
)
if not exist "%ROOT%frontend\node_modules" (
  echo ERROR: frontend dependencies are missing. Run install.cmd first.
  pause
  exit /b 1
)

echo.
echo [1/4] Management backend on port %BACKEND_PORT%
call :check_project_port %BACKEND_PORT%
if "%PORT_STATUS%"=="FOREIGN" (
  echo ERROR: backend port %BACKEND_PORT% belongs to another project.
  pause
  exit /b 1
)
set "BACKEND_STATUS=%PORT_STATUS%"
if "%BACKEND_STATUS%"=="PROJECT" (
  echo       Already running - skip.
) else (
  echo       Opening the persistent backend API terminal...
  start "Pboot Admin Backend API - %BACKEND_PORT%" /D "%ROOT%" "%COMSPEC%" /k ""%ROOT%tools\run-backend.cmd""
)

echo [2/4] Frontend on port %FRONTEND_PORT%
call :check_project_port %FRONTEND_PORT%
if "%PORT_STATUS%"=="FOREIGN" (
  echo ERROR: frontend port %FRONTEND_PORT% belongs to another project.
  pause
  exit /b 1
)
set "FRONTEND_STATUS=%PORT_STATUS%"
if "%FRONTEND_STATUS%"=="PROJECT" (
  echo       Already running - skip.
) else (
  echo       Starting in background...
  powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%tools\start-hidden.ps1" -Exe "cmd" -CmdArgs "/c pnpm exec vite --host localhost --port %FRONTEND_PORT%" -Dir "%ROOT%frontend" -Log "%ROOT%logs\frontend"
)

echo [3/4] SEO tool on port %SEO_PORT%
call :check_port %SEO_PORT%
if "%PORT_BUSY%"=="1" (
  echo       Already running - skip.
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%tools\start-hidden.ps1" -Exe "node" -CmdArgs "launch.js --no-browser" -Dir "%ROOT%tools\seo_publish_tool" -Log "%ROOT%logs\seo"
  echo       Starting in background...
)

echo [4/4] FTP tool on port %FTP_PORT%
call :check_port %FTP_PORT%
if "%PORT_BUSY%"=="1" (
  echo       Already running - skip.
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%tools\start-hidden.ps1" -Exe "node" -CmdArgs "launch.js --no-browser" -Dir "%ROOT%tools\ftp_publish_tool" -Log "%ROOT%logs\ftp"
  echo       Starting in background...
)

echo.
echo --------------------------------------------
echo  Daily services are ready.
echo  Frontend:    http://localhost:%FRONTEND_PORT%
echo  Backend API: http://localhost:%BACKEND_PORT%/api-docs
echo  SEO tool:    http://localhost:%SEO_PORT%
echo  FTP tool:    http://localhost:%FTP_PORT%
echo.
echo  Website settings: open Site Management in the admin panel.
echo  Keep the Pboot Admin Backend API window open.
echo --------------------------------------------
if /I "%~1"=="--no-browser" exit /b 0
powershell -NoProfile -Command "Start-Sleep -Seconds 4"
start "" "http://localhost:%FRONTEND_PORT%"
timeout /t 2 /nobreak >nul
exit /b 0

:check_project_port
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%tools\project-port.ps1" -Port %~1 -Root "%PROJECT_ROOT%" >nul 2>nul
if errorlevel 20 (set "PORT_STATUS=FOREIGN") else if errorlevel 10 (set "PORT_STATUS=PROJECT") else (set "PORT_STATUS=FREE")
exit /b 0

:check_port
set "PORT_BUSY=0"
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /R /C:":%~1 .*LISTENING"') do set "PORT_BUSY=1"
exit /b 0
