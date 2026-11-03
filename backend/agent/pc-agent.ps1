<#
.SYNOPSIS
  Live Dashboard 电脑监控 agent：捕获前台应用并加密上报到后端。
  配置默认从 %LOCALAPPDATA%\LiveDashboardAgent\config.json 读取（由 agent-ui.ps1 图形界面生成）。

.EXAMPLE
  # 正常用法：先双击 start-agent.cmd 配置，之后由托盘程序在后台运行本脚本
  powershell -ExecutionPolicy Bypass -File pc-agent.ps1

.EXAMPLE
  # 临时指定地址和令牌（覆盖配置文件）
  powershell -ExecutionPolicy Bypass -File pc-agent.ps1 -ServerUrl https://api.example.com -Token 你的设备令牌
  -IntervalSeconds 10 -HeartbeatSeconds 60

.NOTES
  - Windows PowerShell 5.1 及以上，无需安装依赖。
  - 默认启用 AES-256-CBC + HMAC-SHA256 加密信封（与 server.js decryptEnvelope 对应）。
#>
param(
  [string]$ServerUrl = '',
  [string]$Token = '',
  [int]$IntervalSeconds = 0,
  [int]$HeartbeatSeconds = 0,
  [object]$SendWindowTitle = $null,
  [string]$ConfigPath = ''
)

$ErrorActionPreference = 'SilentlyContinue'
. "$PSScriptRoot\agent-common.ps1"
if ($ConfigPath) {
  # 指定了配置文件时，日志也写到同目录（便于便携使用 / 隔离测试）
  $script:AgentConfigFile = $ConfigPath
  $script:AgentDir = Split-Path -Parent $ConfigPath
  $script:AgentLogFile = Join-Path $script:AgentDir 'agent.log'
}

# ── 组装配置：配置文件为底，命令行参数可覆盖 ───────────────────────────
$cfg = Read-AgentConfig
if (-not $cfg) { $cfg = Get-DefaultConfig }
if ($ServerUrl) { $cfg.serverUrl = $ServerUrl }
if ($Token) { $cfg.token = $Token }
if ($IntervalSeconds -gt 0) { $cfg.intervalSeconds = $IntervalSeconds }
if ($HeartbeatSeconds -gt 0) { $cfg.heartbeatSeconds = $HeartbeatSeconds }
if ($SendWindowTitle -ne $null) { $cfg.sendWindowTitle = [bool]$SendWindowTitle }

$cfg.serverUrl = $cfg.serverUrl.Trim()
$cfg.token = $cfg.token.Trim()

if (-not $cfg.serverUrl -or -not $cfg.token) {
  Write-AgentLog '未配置后端地址或设备令牌，已退出。请运行 start-agent.cmd 打开配置界面。'
  Write-Host '未配置后端地址或设备令牌。请先双击 start-agent.cmd 完成配置。'
  exit 1
}
if ($cfg.intervalSeconds -lt 1) { $cfg.intervalSeconds = 10 }
if ($cfg.heartbeatSeconds -lt 1) { $cfg.heartbeatSeconds = 60 }

$reportUrl = Resolve-ReportUrl $cfg.serverUrl
Write-AgentLog "agent 启动：$reportUrl  检查间隔 $($cfg.intervalSeconds)s / 心跳 $($cfg.heartbeatSeconds)s / 窗口标题 $($cfg.sendWindowTitle)"
Write-Host "Live Dashboard agent 已启动"
Write-Host "  上报地址：$reportUrl"
Write-Host "  间隔：$($cfg.intervalSeconds)s（不变时每 $($cfg.heartbeatSeconds)s 心跳）"

$lastKey = ''
$lastSend = Get-Date
$failCount = 0

while ($true) {
  try {
    $app = Get-ForegroundApp
    if ($app) {
      $title = if ($cfg.sendWindowTitle) { $app.Title } else { '' }
      $key = "$($app.AppId)|$title"
      $idle = ((Get-Date) - $lastSend).TotalSeconds -ge $cfg.heartbeatSeconds

      if ($key -ne $lastKey -or $idle) {
        $payload = @{
          app_id    = $app.AppId
          timestamp = (Get-Date).ToUniversalTime().ToString('o')
        }
        if ($cfg.sendWindowTitle -and $title) { $payload.window_title = $title }

        $battery = Get-BatteryInfo
        if ($battery) {
          $payload.battery_percent = $battery.battery_percent
          $payload.battery_charging = $battery.battery_charging
        }

        try {
          $envelope = Protect-Payload ($payload | ConvertTo-Json -Compress) $cfg.token
          Send-AgentReport $cfg.serverUrl $cfg.token $envelope
          $lastKey = $key
          $lastSend = Get-Date
          if ($failCount -gt 0) { Write-AgentLog "网络恢复，重新上报成功（此前失败 $failCount 次）" }
          $failCount = 0
          Write-AgentLog "上报：$($app.AppId) $title"
        } catch {
          $failCount++
          if ($failCount -le 3 -or $failCount % 30 -eq 0) {
            Write-AgentLog "上报失败（第 $failCount 次）：$($_.Exception.Message)"
          }
        }
      }
    }
  } catch {
    Write-AgentLog "采集异常：$($_.Exception.Message)"
  }
  Start-Sleep -Seconds $cfg.intervalSeconds
}
