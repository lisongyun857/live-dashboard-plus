# 停止后台托盘与上报进程
. "$PSScriptRoot\agent-common.ps1"

$stopped = 0
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match 'agent-tray\.ps1|pc-agent\.ps1' } |
  ForEach-Object {
    try {
      Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop
      $stopped++
    } catch {}
  }

Write-AgentLog "停止 agent（结束 $stopped 个进程）"
Write-Host "已停止 Live Dashboard agent（结束 $stopped 个进程）。"
