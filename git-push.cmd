@echo off
rem 免登录直接推送：读取 GITHUB_TOKEN 环境变量或 git.token 文件里的 PAT 后 git push
cd /d "%~dp0"
node git-push.js %*
if errorlevel 1 pause
