@echo off
setlocal
set "ROOT=%~dp0"
set "BACKEND_PORT=5000"
set "FRONTEND_PORT=5173"
set "SEO_PORT=5288"
set "FTP_PORT=5189"

echo.
echo ============================================
echo   Pboot Admin - Start All (one click)
echo ============================================
echo Root: %ROOT%

where pnpm >nul 2>nul
if errorlevel 1 (
  echo ERROR: pnpm was not found. Please run 00-install.cmd first.
  pause
  exit /b 1
)

if exist "%ROOT%backend\.env" (
  for /f "usebackq tokens=1,* delims==" %%A in ("%ROOT%backend\.env") do (
    if /I "%%A"=="BACKEND_PORT" set "BACKEND_PORT=%%B"
    if /I "%%A"=="FRONTEND_PORT" set "FRONTEND_PORT=%%B"
  )
)

echo.
echo [1/4] Backend  (port %BACKEND_PORT%)
call :check_port %BACKEND_PORT%
if "%PORT_BUSY%"=="1" (
  echo       Already running - skip.
) else (
  start "Pboot Admin Backend %BACKEND_PORT%" /D "%ROOT%backend" cmd /k "pnpm run start:dev"
  echo       Starting...
)

echo [2/4] Frontend (port %FRONTEND_PORT%)
call :check_port %FRONTEND_PORT%
if "%PORT_BUSY%"=="1" (
  echo       Already running - skip.
) else (
  start "Pboot Admin Frontend %FRONTEND_PORT%" /D "%ROOT%frontend" cmd /k "pnpm run dev -- --host 0.0.0.0 --port %FRONTEND_PORT%"
  echo       Starting...
)

echo [3/4] SEO tool  (port %SEO_PORT%+)
call :check_port %SEO_PORT%
if "%PORT_BUSY%"=="1" (
  echo       Already running - skip.
) else (
  start "SEO Publish Tool" /D "%ROOT%tools\seo_publish_tool" cmd /k "node launch.js"
  echo       Starting...
)

echo [4/4] FTP tool  (port %FTP_PORT%+)
call :check_port %FTP_PORT%
if "%PORT_BUSY%"=="1" (
  echo       Already running - skip.
) else (
  start "FTP Publish Tool" /D "%ROOT%tools\ftp_publish_tool" cmd /k "node launch.js"
  echo       Starting...
)

echo.
echo --------------------------------------------
echo  All services requested. Keep the windows open.
echo  Frontend:    http://localhost:%FRONTEND_PORT%
echo  Backend API: http://localhost:%BACKEND_PORT%/api-docs
echo  SEO tool:    http://localhost:%SEO_PORT%
echo  FTP tool:    http://localhost:%FTP_PORT%
echo  Stop all:    run 04-stop-ports.cmd
echo --------------------------------------------
timeout /t 6 /nobreak >nul
start "" "http://localhost:%FRONTEND_PORT%"
echo Opening frontend in browser...
timeout /t 5 /nobreak >nul
exit /b 0

:check_port
set "PORT_BUSY=0"
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /R /C:":%~1 .*LISTENING"') do (
  set "PORT_BUSY=1"
)
exit /b 0
