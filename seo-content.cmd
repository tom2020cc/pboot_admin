@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\start-seo-content.ps1"
if errorlevel 1 (
  echo SEO content worker did not start. Review the error above.
  pause
  exit /b 1
)
exit /b 0
