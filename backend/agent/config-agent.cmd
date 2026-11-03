@echo off
chcp 65001 >nul
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Sta -File "%~dp0agent-ui.ps1"
exit /b 0
