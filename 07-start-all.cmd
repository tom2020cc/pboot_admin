@echo off
setlocal
set "ROOT=%~dp0"
set "FRONTEND_PORT=5178"
set "SEO_PORT=5288"
set "FTP_PORT=5189"

echo.
echo ============================================
echo   Pboot Admin - Start all daily services
echo ============================================
echo Backend stays in a visible terminal.
echo Frontend, SEO and FTP run in the background.

if exist "%ROOT%backend\.env" (
  for /f "usebackq tokens=1,* delims==" %%A in ("%ROOT%backend\.env") do (
    if /I "%%A"=="FRONTEND_PORT" set "FRONTEND_PORT=%%B"
  )
)

echo.
echo [1/3] Management backend and frontend
call "%ROOT%02-start.cmd" --no-browser
if errorlevel 1 exit /b 1

echo.
echo [2/3] SEO tool on port %SEO_PORT%
call :check_port %SEO_PORT%
if "%PORT_BUSY%"=="1" (
  echo       Already running - skip.
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%tools\start-hidden.ps1" -Exe "node" -CmdArgs "launch.js --no-browser" -Dir "%ROOT%tools\seo_publish_tool" -Log "%ROOT%logs\seo"
  echo       Starting in background...
)

echo [3/3] FTP tool on port %FTP_PORT%
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
echo  SEO tool:    http://localhost:%SEO_PORT%
echo  FTP tool:    http://localhost:%FTP_PORT%
echo.
echo  Config wizard is not started every day.
echo  Run 01-config.cmd only when settings change.
echo  Keep the Pboot Admin Backend window open.
echo --------------------------------------------
if /I "%~1"=="--no-browser" exit /b 0
powershell -NoProfile -Command "Start-Sleep -Seconds 4"
start "" "http://localhost:%FRONTEND_PORT%"
timeout /t 2 /nobreak >nul
exit /b 0

:check_port
set "PORT_BUSY=0"
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /R /C:":%~1 .*LISTENING"') do set "PORT_BUSY=1"
exit /b 0
