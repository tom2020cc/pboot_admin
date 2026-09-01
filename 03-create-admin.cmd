@echo off
setlocal
set "ROOT=%~dp0"
set "BACKEND_PORT=5000"
set "EMAIL=admin@qq.com"
set "PASSWORD=123456"

if exist "%ROOT%backend\.env" (
  for /f "usebackq tokens=1,* delims==" %%A in ("%ROOT%backend\.env") do (
    if /I "%%A"=="BACKEND_PORT" set "BACKEND_PORT=%%B"
  )
)

set /p "EMAIL_INPUT=Admin email [admin@qq.com]: "
if not "%EMAIL_INPUT%"=="" set "EMAIL=%EMAIL_INPUT%"
set /p "PASSWORD_INPUT=Admin password [123456]: "
if not "%PASSWORD_INPUT%"=="" set "PASSWORD=%PASSWORD_INPUT%"

set "BACKEND=http://localhost:%BACKEND_PORT%"
echo.
echo Creating admin account at %BACKEND%
echo Make sure 07-start-all.cmd or 02-start.cmd is already running.
pause

powershell -NoProfile -ExecutionPolicy Bypass -Command "$body=@{email='%EMAIL%';password='%PASSWORD%'} | ConvertTo-Json; try { Invoke-RestMethod -Method Post -Uri '%BACKEND%/auth/signup' -ContentType 'application/json' -Body $body; Write-Host 'OK: Admin account created or already exists.' } catch { Write-Host 'Create failed. Check whether the backend is running and whether the account already exists.'; Write-Host $_.Exception.Message; exit 1 }"
timeout /t 3 /nobreak >nul
