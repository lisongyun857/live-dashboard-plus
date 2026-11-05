<#
  Live Dashboard 电脑 agent · 观众指令轮询
  - 由 agent-tray.ps1 在「允许观众发指令」开启时启动
  - 长轮询后端，收到截屏请求就弹窗询问「同意 / 拒绝」
  - 20 秒不处理自动拒绝；同意后截主屏（1280 宽、JPEG 70）上传
#>
param(
  [string]$ConfigPath = ''
)

$ErrorActionPreference = 'SilentlyContinue'
. "$PSScriptRoot\agent-common.ps1"
if ($ConfigPath) {
  $script:AgentConfigFile = $ConfigPath
  $script:AgentDir = Split-Path -Parent $ConfigPath
  $script:AgentLogFile = Join-Path $script:AgentDir 'agent.log'
}

$cfg = Read-AgentConfig
if (-not $cfg -or -not $cfg.serverUrl -or -not $cfg.token) {
  Write-AgentLog '未配置后端地址或令牌，指令轮询退出'
  exit 1
}
if (-not $cfg.allowCommands) {
  Write-AgentLog '未开启「允许观众发指令」，指令轮询退出'
  exit 0
}

# 单实例：多个轮询进程会抢同一条指令，导致重复弹窗
$mutex = New-Object System.Threading.Mutex($false, 'Local\LiveDashboardAgentCommandPoll')
if (-not $mutex.WaitOne(0)) {
  Write-AgentLog '已有一个指令轮询在运行，本进程退出'
  exit 0
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

# ── 审批弹窗：倒计时结束 = 自动拒绝 ────────────────────────────────────
function Show-ApprovalDialog($Command, [int]$Seconds) {
  $script:pollAnswer = 'reject'
  $script:pollLeft = $Seconds

  $form = New-Object System.Windows.Forms.Form
  $form.Text = '观众请求截屏'
  # 用 ClientSize 而不是 Size：Size 包含标题栏和边框，窗口只要矮一点按钮就会被裁掉
  $form.ClientSize = New-Object System.Drawing.Size(460, 252)
  $form.MinimumSize = New-Object System.Drawing.Size(400, 250)
  $form.FormBorderStyle = 'Sizable'          # 允许拖动边角缩放
  $form.MaximizeBox = $false
  $form.MinimizeBox = $false
  $form.ShowIcon = $false
  $form.StartPosition = 'CenterScreen'
  $form.TopMost = $true
  $form.ShowInTaskbar = $true
  $form.AutoScaleMode = [System.Windows.Forms.AutoScaleMode]::Dpi
  $form.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 9)

  $cwidth = $form.ClientSize.Width
  $labelWidth = $cwidth - 40

  $lblTitle = New-Object System.Windows.Forms.Label
  $lblTitle.Text = '有观众想看看你现在的屏幕'
  $lblTitle.Location = New-Object System.Drawing.Point(20, 16)
  $lblTitle.Size = New-Object System.Drawing.Size($labelWidth, 30)
  $lblTitle.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right
  $lblTitle.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 12, [System.Drawing.FontStyle]::Bold)
  $form.Controls.Add($lblTitle)

  $lblInfo = New-Object System.Windows.Forms.Label
  $lblInfo.Text = '同意后会截取主屏整屏，并公开给所有围观的人。'
  $lblInfo.Location = New-Object System.Drawing.Point(20, 54)
  $lblInfo.Size = New-Object System.Drawing.Size($labelWidth, 22)
  $lblInfo.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right
  $lblInfo.ForeColor = [System.Drawing.Color]::DimGray
  $form.Controls.Add($lblInfo)

  $lblInfo2 = New-Object System.Windows.Forms.Label
  $lblInfo2.Text = '不想被看见就点「拒绝」，不处理也会自动拒绝。'
  $lblInfo2.Location = New-Object System.Drawing.Point(20, 78)
  $lblInfo2.Size = New-Object System.Drawing.Size($labelWidth, 22)
  $lblInfo2.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right
  $lblInfo2.ForeColor = [System.Drawing.Color]::DimGray
  $form.Controls.Add($lblInfo2)

  $script:pollCount = New-Object System.Windows.Forms.Label
  $script:pollCount.Text = "还有 $($script:pollLeft) 秒自动拒绝"
  $script:pollCount.Location = New-Object System.Drawing.Point(20, 112)
  $script:pollCount.Size = New-Object System.Drawing.Size($labelWidth, 26)
  $script:pollCount.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right
  $script:pollCount.ForeColor = [System.Drawing.Color]::Crimson
  $script:pollCount.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 10)
  $form.Controls.Add($script:pollCount)

  # 按钮固定在窗口右下角，缩放窗口也不会被挤没
  $btnYes = New-Object System.Windows.Forms.Button
  $btnYes.Text = '同意'
  $btnYes.Size = New-Object System.Drawing.Size(110, 36)
  $btnYes.Location = New-Object System.Drawing.Point(($cwidth - 250), ($form.ClientSize.Height - 56))
  $btnYes.Anchor = [System.Windows.Forms.AnchorStyles]::Bottom -bor [System.Windows.Forms.AnchorStyles]::Right
  $btnYes.add_Click({
    $script:pollAnswer = 'approve'
    $script:pollForm.Hide()
    $script:pollForm.Close()
  })
  $form.Controls.Add($btnYes)

  $btnNo = New-Object System.Windows.Forms.Button
  $btnNo.Text = '拒绝'
  $btnNo.Size = New-Object System.Drawing.Size(110, 36)
  $btnNo.Location = New-Object System.Drawing.Point(($cwidth - 130), ($form.ClientSize.Height - 56))
  $btnNo.Anchor = [System.Windows.Forms.AnchorStyles]::Bottom -bor [System.Windows.Forms.AnchorStyles]::Right
  $btnNo.add_Click({
    $script:pollAnswer = 'reject'
    $script:pollForm.Hide()
    $script:pollForm.Close()
  })
  $form.Controls.Add($btnNo)

  $form.AcceptButton = $btnYes
  $form.CancelButton = $btnNo

  $script:pollForm = $form
  $script:pollTimer = New-Object System.Windows.Forms.Timer
  $script:pollTimer.Interval = 1000
  $script:pollTimer.add_Tick({
    $script:pollLeft -= 1
    if ($script:pollLeft -le 0) {
      $script:pollAnswer = 'reject'
      $script:pollForm.Close()
      return
    }
    $script:pollCount.Text = "还有 $($script:pollLeft) 秒自动拒绝"
  })
  $script:pollTimer.Start()

  [void]$form.ShowDialog()

  # 先把窗口彻底隐藏、让消息循环跑完，再等窗口的关闭动画结束，
  # 否则截屏会把还没消失的弹窗一起拍进去。
  $form.Hide()
  [System.Windows.Forms.Application]::DoEvents()
  $script:pollTimer.Stop()
  $script:pollTimer.Dispose()
  $script:pollTimer = $null
  $form.Dispose()
  $script:pollForm = $null
  if ($script:pollAnswer -eq 'approve') {
    Start-Sleep -Milliseconds 350
    [System.Windows.Forms.Application]::DoEvents()
  }
  return $script:pollAnswer
}

# ── 处理一条指令 ───────────────────────────────────────────────────────
function Invoke-LocalCommand($Config, $Command, [string]$ServerTime) {
  $seconds = 20
  try {
    $expires = [datetime]::Parse([string]$Command.expires_at).ToUniversalTime()
    $left = [int][Math]::Ceiling(($expires - [datetime]::UtcNow).TotalSeconds)
    $seconds = [Math]::Max(3, [Math]::Min(20, $left))
  } catch {}

  # 服务端从创建到投递花了多久（都用服务器时间，不受本机时钟影响）
  $held = ''
  try {
    $createdUtc = [datetime]::Parse([string]$Command.created_at).ToUniversalTime()
    $serverUtc = [datetime]::Parse($ServerTime).ToUniversalTime()
    $held = "（服务端等待 $([int]($serverUtc - $createdUtc).TotalMilliseconds) ms）"
  } catch {}

  Write-AgentLog "收到截屏请求 $($Command.id)$held，$($seconds) 秒内待确认"

  $answer = Show-ApprovalDialog $Command $seconds
  if ($answer -ne 'approve') {
    try {
      Send-CommandResult -ServerUrl $Config.serverUrl -Token $Config.token -CommandId $Command.id `
        -Decision 'reject' -ErrorText '电脑拒绝了请求' | Out-Null
      Write-AgentLog "已拒绝截屏请求 $($Command.id)"
    } catch {
      Write-AgentLog "回执拒绝失败：$($_.Exception.Message)"
    }
    return
  }

  # 同意后才回执：省掉弹窗出现前的一次网络往返，
  # 后端收到回执会把 20 秒审批计时换成截屏上传宽限。
  $ackStart = Get-Date
  try { Send-CommandAck $Config.serverUrl $Config.token $Command.id | Out-Null } catch {}
  $ackMs = [int]((Get-Date) - $ackStart).TotalMilliseconds
  if ($ackMs -gt 500) { Write-AgentLog "回执耗时偏长：$ackMs ms" }

  try {
    $shot = Capture-ScreenJpeg
    Write-AgentLog "截屏参数：$($shot.debug)"
    Send-CommandResult -ServerUrl $Config.serverUrl -Token $Config.token -CommandId $Command.id `
      -Decision 'approve' -Shot $shot | Out-Null
    Write-AgentLog "已同意并上传截图 $($Command.id)（$($shot.width)x$($shot.height)，$([Math]::Round($shot.bytes / 1024)) KB）"
  } catch {
    Write-AgentLog "截屏或上传失败：$($_.Exception.Message)"
    try {
      Send-CommandResult -ServerUrl $Config.serverUrl -Token $Config.token -CommandId $Command.id `
        -Decision 'reject' -ErrorText '电脑截屏失败' | Out-Null
    } catch {}
  }
}

Write-AgentLog "指令轮询已启动：$($cfg.serverUrl)"
try { Write-AgentLog ("屏幕参数：" + (Get-ScreenGeometry)) }
catch { Write-AgentLog "屏幕参数探测失败：$($_.Exception.Message)" }
while ($true) {
  try {
    $resp = Invoke-AgentApi -ServerUrl $cfg.serverUrl -Token $cfg.token `
      -ApiPath '/api/agent/commands?timeout=25' -TimeoutSec 40
    if ($resp -and $resp.command) {
      Invoke-LocalCommand $cfg $resp.command $resp.server_time
    }
  } catch {
    Write-AgentLog "指令轮询失败：$($_.Exception.Message)"
    Start-Sleep -Seconds 2
  }
}
