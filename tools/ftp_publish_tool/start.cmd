@echo off
setlocal
where pnpm >nul 2>nul
if errorlevel 1 (
  echo ERROR: pnpm was not found. Run the root 00-install.cmd first.
  pause
  exit /b 1
)
cd /d "%~dp0"
if not exist node_modules (
  call pnpm install
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\start-hidden.ps1" -Exe "node" -CmdArgs "launch.js" -Dir "%CD%" -Log "%CD%\logs\run"
echo FTP 工具已在后台启动。日志：%CD%\logs\run.out.log
timeout /t 2 /nobreak >nul
