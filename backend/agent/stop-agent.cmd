@echo off
chcp 65001 >nul
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop-agent.ps1"
timeout /t 2 >nul
exit /b 0
