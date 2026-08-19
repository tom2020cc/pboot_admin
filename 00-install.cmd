@echo off
setlocal
set "ROOT=%~dp0"

echo.
echo [1/6] Check Node.js
where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js was not found.
  echo Install Node.js LTS from https://nodejs.org/ and run this file again.
  pause
  exit /b 1
)
node -v

echo.
echo [2/6] Check pnpm
where pnpm >nul 2>nul
if errorlevel 1 (
  echo pnpm was not found. Installing pnpm 9.15.4...
  call npm config set registry https://registry.npmmirror.com
  call npm install -g pnpm@9.15.4
)
where pnpm >nul 2>nul
if errorlevel 1 (
  echo ERROR: pnpm installation failed.
  echo Run manually: npm install -g pnpm@9.15.4
  pause
  exit /b 1
)
call pnpm -v
call pnpm config set registry https://registry.npmmirror.com

call :install_part "backend" "Backend"
if errorlevel 1 exit /b 1
call :install_part "frontend" "Frontend"
if errorlevel 1 exit /b 1
call :install_part "tools\seo_publish_tool" "SEO tool"
if errorlevel 1 exit /b 1
call :install_part "tools\ftp_publish_tool" "FTP tool"
if errorlevel 1 exit /b 1

echo.
echo OK: All dependencies are installed with pnpm.
echo Next: run 01-config.cmd.
timeout /t 3 /nobreak >nul
exit /b 0

:install_part
echo.
echo Installing %~2 dependencies...
if not exist "%ROOT%%~1\package.json" (
  echo ERROR: %~1\package.json was not found.
  pause
  exit /b 1
)
cd /d "%ROOT%%~1"
call pnpm install
if errorlevel 1 (
  echo ERROR: %~2 dependency installation failed.
  pause
  exit /b 1
)
exit /b 0
