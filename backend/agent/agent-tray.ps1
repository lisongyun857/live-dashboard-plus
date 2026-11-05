<#
  Live Dashboard 电脑 agent · 托盘宿主
  - 无窗口运行（由 start-agent.vbs 用 wscript 启动）
  - 托盘右键：打开配置 / 查看日志 / 重启上报 / 退出
  - 自动守护：pc-agent.ps1 意外退出会在 5 秒内被重新拉起
#>
$ErrorActionPreference = 'SilentlyContinue'
. "$PSScriptRoot\agent-common.ps1"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$script:agentScript = Join-Path $PSScriptRoot 'pc-agent.ps1'
$script:commandScript = Join-Path $PSScriptRoot 'command-poll.ps1'
$script:stopFlag = $false
$script:agentProc = $null
$script:commandProc = $null

function Start-AgentProcess {
  if ($script:stopFlag) { return }
  $script:agentProc = Start-Process -FilePath 'powershell.exe' `
    -ArgumentList "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script:agentScript`"" `
    -WindowStyle Hidden -PassThru
  Write-AgentLog '上报进程已启动'
}

function Stop-AgentProcess {
  if ($script:agentProc -and -not $script:agentProc.HasExited) {
    try { Stop-Process -Id $script:agentProc.Id -Force -ErrorAction SilentlyContinue } catch {}
  }
  $script:agentProc = $null
}

# ── 观众指令轮询（仅「允许观众发指令」开启时运行） ─────────────────────
function Start-CommandProcess {
  if ($script:stopFlag) { return }
  $current = Read-AgentConfig
  if (-not $current -or -not $current.serverUrl -or -not $current.token -or -not $current.allowCommands) { return }
  $script:commandProc = Start-Process -FilePath 'powershell.exe' `
    -ArgumentList "-NoProfile -ExecutionPolicy Bypass -Sta -WindowStyle Hidden -File `"$script:commandScript`"" `
    -WindowStyle Hidden -PassThru
  Write-AgentLog '观众指令轮询已启动'
}

function Stop-CommandProcess {
  if ($script:commandProc -and -not $script:commandProc.HasExited) {
    try { Stop-Process -Id $script:commandProc.Id -Force -ErrorAction SilentlyContinue } catch {}
  }
  $script:commandProc = $null
}

function Open-ConfigWindow {
  Start-Process -FilePath 'powershell.exe' `
    -ArgumentList "-NoProfile -ExecutionPolicy Bypass -Sta -File `"$PSScriptRoot\agent-ui.ps1`""
}

# ── 未配置时直接打开配置界面 ───────────────────────────────────────────
$cfg = Read-AgentConfig
if (-not $cfg -or -not $cfg.serverUrl -or -not $cfg.token) {
  Write-AgentLog '尚未配置，打开配置界面'
  Open-ConfigWindow
  exit
}

# ── 托盘图标 ───────────────────────────────────────────────────────────
$icon = New-Object System.Windows.Forms.NotifyIcon
$icon.Icon = [System.Drawing.SystemIcons]::Application
$icon.Text = 'Live Dashboard Agent'
$icon.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$miConfig = $menu.Items.Add('打开配置')
$miLog = $menu.Items.Add('查看日志')
$miRestart = $menu.Items.Add('重启上报')
$menu.Items.Add('-') | Out-Null
$miExit = $menu.Items.Add('退出')

$miConfig.add_Click({ Open-ConfigWindow })
$miLog.add_Click({
  $p = Get-AgentLogPath
  if (Test-Path $p) { Start-Process notepad.exe $p }
  else { $icon.ShowBalloonTip(3000, 'Live Dashboard', '还没有日志（尚未上报过）', [System.Windows.Forms.ToolTipIcon]::Info) }
})
$miRestart.add_Click({
  Stop-AgentProcess
  Start-AgentProcess
  Stop-CommandProcess
  Start-CommandProcess
  $icon.ShowBalloonTip(3000, 'Live Dashboard', '已按最新配置重启上报', [System.Windows.Forms.ToolTipIcon]::Info)
})
$miExit.add_Click({
  $script:stopFlag = $true
  $timer.Stop()
  Stop-AgentProcess
  Stop-CommandProcess
  Write-AgentLog '托盘退出'
  $icon.Visible = $false
  $icon.Dispose()
  [System.Windows.Forms.Application]::ExitThread()
})

$icon.ContextMenuStrip = $menu
$icon.add_DoubleClick({ Open-ConfigWindow })

# ── 守护计时器 ─────────────────────────────────────────────────────────
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 5000
$timer.add_Tick({
  if ($script:stopFlag) { return }
  if ($null -eq $script:agentProc -or $script:agentProc.HasExited) {
    Write-AgentLog '检测到上报进程已退出，自动重启'
    Start-AgentProcess
  }
  $current = Read-AgentConfig
  if ($current -and $current.allowCommands) {
    if ($null -eq $script:commandProc -or $script:commandProc.HasExited) {
      Start-CommandProcess
    }
  } elseif ($script:commandProc -and -not $script:commandProc.HasExited) {
    Stop-CommandProcess
    Write-AgentLog '「允许观众发指令」已关闭，停止指令轮询'
  }
})
$timer.Start()

Start-AgentProcess
Start-CommandProcess
$icon.ShowBalloonTip(3000, 'Live Dashboard', "已开始上报到 $($cfg.serverUrl)", [System.Windows.Forms.ToolTipIcon]::Info)
Write-AgentLog "托盘已启动：$($cfg.serverUrl)"

[System.Windows.Forms.Application]::Run()
