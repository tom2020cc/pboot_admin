@echo off
setlocal
where pnpm >nul 2>nul
if errorlevel 1 (
  echo ERROR: pnpm was not found. Run the root 00-install.cmd first.
  pause
  exit /b 1
)
cd /d "%~dp0"
call pnpm install
pause
