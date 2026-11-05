<#
  Live Dashboard 电脑 agent · 图形化配置界面（Windows 自带 WinForms，无需安装任何依赖）
  双击 start-agent.cmd 即可打开本界面。
#>
. "$PSScriptRoot\agent-common.ps1"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$cfg = Read-AgentConfig
if (-not $cfg) { $cfg = Get-DefaultConfig }

$form = New-Object System.Windows.Forms.Form
$form.Text = 'Live Dashboard · Windows 客户机配置'
$form.Size = New-Object System.Drawing.Size(500, 470)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedSingle'
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 9)

$lblTitle = New-Object System.Windows.Forms.Label
$lblTitle.Text = '后台采集前台应用并加密上报，关闭窗口不影响运行'
$lblTitle.Location = New-Object System.Drawing.Point(20, 15)
$lblTitle.Size = New-Object System.Drawing.Size(450, 20)
$lblTitle.ForeColor = [System.Drawing.Color]::DimGray
$form.Controls.Add($lblTitle)

$lblUrl = New-Object System.Windows.Forms.Label
$lblUrl.Text = '后端地址（如 https://api.example.com）'
$lblUrl.Location = New-Object System.Drawing.Point(20, 45)
$lblUrl.Size = New-Object System.Drawing.Size(450, 18)
$form.Controls.Add($lblUrl)

$txtUrl = New-Object System.Windows.Forms.TextBox
$txtUrl.Location = New-Object System.Drawing.Point(20, 66)
$txtUrl.Size = New-Object System.Drawing.Size(450, 24)
$txtUrl.Text = $cfg.serverUrl
$form.Controls.Add($txtUrl)

$lblToken = New-Object System.Windows.Forms.Label
$lblToken.Text = '设备令牌（管理面板 /admin → 设备管理 里复制）'
$lblToken.Location = New-Object System.Drawing.Point(20, 98)
$lblToken.Size = New-Object System.Drawing.Size(450, 18)
$form.Controls.Add($lblToken)

$txtToken = New-Object System.Windows.Forms.TextBox
$txtToken.Location = New-Object System.Drawing.Point(20, 119)
$txtToken.Size = New-Object System.Drawing.Size(450, 24)
$txtToken.Text = $cfg.token
$form.Controls.Add($txtToken)

$lblInterval = New-Object System.Windows.Forms.Label
$lblInterval.Text = '检查间隔（秒）'
$lblInterval.Location = New-Object System.Drawing.Point(20, 152)
$lblInterval.Size = New-Object System.Drawing.Size(200, 18)
$form.Controls.Add($lblInterval)

$numInterval = New-Object System.Windows.Forms.NumericUpDown
$numInterval.Location = New-Object System.Drawing.Point(20, 173)
$numInterval.Size = New-Object System.Drawing.Size(110, 24)
$numInterval.Minimum = 1
$numInterval.Maximum = 600
$numInterval.Value = [decimal]$cfg.intervalSeconds
$form.Controls.Add($numInterval)

$lblHeartbeat = New-Object System.Windows.Forms.Label
$lblHeartbeat.Text = '心跳间隔（秒）'
$lblHeartbeat.Location = New-Object System.Drawing.Point(160, 152)
$lblHeartbeat.Size = New-Object System.Drawing.Size(200, 18)
$form.Controls.Add($lblHeartbeat)

$numHeartbeat = New-Object System.Windows.Forms.NumericUpDown
$numHeartbeat.Location = New-Object System.Drawing.Point(160, 173)
$numHeartbeat.Size = New-Object System.Drawing.Size(110, 24)
$numHeartbeat.Minimum = 10
$numHeartbeat.Maximum = 3600
$numHeartbeat.Value = [decimal]$cfg.heartbeatSeconds
$form.Controls.Add($numHeartbeat)

$chkTitle = New-Object System.Windows.Forms.CheckBox
$chkTitle.Text = '上报窗口标题（关闭后只传应用名，更隐私）'
$chkTitle.Location = New-Object System.Drawing.Point(22, 210)
$chkTitle.Size = New-Object System.Drawing.Size(450, 22)
$chkTitle.Checked = [bool]$cfg.sendWindowTitle
$form.Controls.Add($chkTitle)

$chkAuto = New-Object System.Windows.Forms.CheckBox
$chkAuto.Text = '开机自动启动（隐藏窗口 + 托盘图标）'
$chkAuto.Location = New-Object System.Drawing.Point(22, 236)
$chkAuto.Size = New-Object System.Drawing.Size(450, 22)
$chkAuto.Checked = [bool]$cfg.autoStart
$form.Controls.Add($chkAuto)

$chkCommands = New-Object System.Windows.Forms.CheckBox
$chkCommands.Text = '允许观众发指令：截屏请求会弹窗询问，20 秒不处理自动拒绝'
$chkCommands.Location = New-Object System.Drawing.Point(22, 264)
$chkCommands.Size = New-Object System.Drawing.Size(460, 22)
$chkCommands.Checked = [bool]$cfg.allowCommands
$form.Controls.Add($chkCommands)

$lblStatus = New-Object System.Windows.Forms.Label
$lblStatus.Text = "配置保存在：$(Get-AgentConfigPath)"
$lblStatus.Location = New-Object System.Drawing.Point(22, 296)
$lblStatus.Size = New-Object System.Drawing.Size(460, 40)
$lblStatus.ForeColor = [System.Drawing.Color]::DimGray
$form.Controls.Add($lblStatus)

# ── 辅助：重启已运行的上报进程 / 启动托盘 ──────────────────────────────
function Restart-AgentProcesses {
  Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*pc-agent.ps1*' -or $_.CommandLine -like '*command-poll.ps1*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

function Ensure-TrayRunning {
  $tray = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*agent-tray.ps1*' }
  if (-not $tray) {
    Start-Process -FilePath 'wscript.exe' -ArgumentList "`"$(Join-Path $PSScriptRoot 'start-agent.vbs')`""
  }
}

function Save-FromForm([bool]$StartAfterSave) {
  $url = $txtUrl.Text.Trim()
  if ($url -notmatch '^https?://') {
    [System.Windows.Forms.MessageBox]::Show('后端地址要以 http:// 或 https:// 开头', '格式不对', 'OK', 'Warning')
    return
  }
  if ($txtToken.Text.Trim().Length -lt 4) {
    [System.Windows.Forms.MessageBox]::Show('设备令牌不能为空（在管理面板里复制）', '缺少令牌', 'OK', 'Warning')
    return
  }
  if ($numHeartbeat.Value -lt $numInterval.Value) {
    [System.Windows.Forms.MessageBox]::Show('心跳间隔不能小于检查间隔', '参数不对', 'OK', 'Warning')
    return
  }

  $newCfg = Get-DefaultConfig
  $newCfg.serverUrl = $url
  $newCfg.token = $txtToken.Text.Trim()
  $newCfg.intervalSeconds = [int]$numInterval.Value
  $newCfg.heartbeatSeconds = [int]$numHeartbeat.Value
  $newCfg.sendWindowTitle = [bool]$chkTitle.Checked
  $newCfg.autoStart = [bool]$chkAuto.Checked
  $newCfg.allowCommands = [bool]$chkCommands.Checked

  Save-AgentConfig $newCfg
  if (-not (Set-AgentAutoStart $newCfg.autoStart)) {
    $lblStatus.Text = '配置已保存，但开机自启设置失败（可能被安全软件拦截）'
  } else {
    $lblStatus.Text = "已保存到 $(Get-AgentConfigPath)"
  }
  Write-AgentLog "配置已更新：$url 间隔 $($newCfg.intervalSeconds)s / 心跳 $($newCfg.heartbeatSeconds)s / 窗口标题 $($newCfg.sendWindowTitle) / 开机自启 $($newCfg.autoStart) / 观众指令 $($newCfg.allowCommands)"

  if ($StartAfterSave) {
    Restart-AgentProcesses
    Ensure-TrayRunning
    $lblStatus.Text = '已保存并启动：托盘图标出现后即开始上报'
    Write-AgentLog '已保存并启动托盘'
  }
}

# ── 按钮 ───────────────────────────────────────────────────────────────
$btnTest = New-Object System.Windows.Forms.Button
$btnTest.Text = '测试上报'
$btnTest.Location = New-Object System.Drawing.Point(20, 360)
$btnTest.Size = New-Object System.Drawing.Size(105, 32)
$btnTest.add_Click({
  $btnTest.Enabled = $false
  $lblStatus.Text = '正在测试上报…'
  $lblStatus.ForeColor = [System.Drawing.Color]::DimGray
  $form.Refresh()
  $result = Test-AgentReport $txtUrl.Text.Trim() $txtToken.Text.Trim()
  if ($result -eq 'OK') {
    $lblStatus.Text = '上报成功。几秒后刷新仪表盘，应能看到「Windows 客户机配置测试」。'
    $lblStatus.ForeColor = [System.Drawing.Color]::SeaGreen
  } else {
    $lblStatus.Text = $result
    $lblStatus.ForeColor = [System.Drawing.Color]::Crimson
  }
  $btnTest.Enabled = $true
})
$form.Controls.Add($btnTest)

$btnSave = New-Object System.Windows.Forms.Button
$btnSave.Text = '仅保存'
$btnSave.Location = New-Object System.Drawing.Point(135, 360)
$btnSave.Size = New-Object System.Drawing.Size(105, 32)
$btnSave.add_Click({ Save-FromForm $false })
$form.Controls.Add($btnSave)

$btnStart = New-Object System.Windows.Forms.Button
$btnStart.Text = '保存并启动'
$btnStart.Location = New-Object System.Drawing.Point(250, 360)
$btnStart.Size = New-Object System.Drawing.Size(120, 32)
$btnStart.add_Click({ Save-FromForm $true; $form.Close() })
$form.Controls.Add($btnStart)

$btnClose = New-Object System.Windows.Forms.Button
$btnClose.Text = '关闭'
$btnClose.Location = New-Object System.Drawing.Point(380, 360)
$btnClose.Size = New-Object System.Drawing.Size(90, 32)
$btnClose.add_Click({ $form.Close() })
$form.Controls.Add($btnClose)

[void]$form.ShowDialog()
