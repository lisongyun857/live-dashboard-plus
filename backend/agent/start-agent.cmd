@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Live Dashboard Agent

if not exist "%LOCALAPPDATA%\LiveDashboardAgent\config.json" (
  echo 尚未配置，正在打开配置界面...
  powershell -NoProfile -ExecutionPolicy Bypass -Sta -File "%~dp0agent-ui.ps1"
  exit /b 0
)

echo 正在后台启动（隐藏窗口 + 托盘图标）...
start "" wscript.exe "%~dp0start-agent.vbs"
echo 已启动。托盘图标出现后即开始上报；右键托盘可打开配置或退出。
timeout /t 2 >nul
exit /b 0
