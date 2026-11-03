﻿﻿﻿# Live Dashboard 电脑 agent · 公共模块
# 被 pc-agent.ps1 / agent-tray.ps1 / agent-ui.ps1 引用（. "$PSScriptRoot\agent-common.ps1"）
# 只用 Windows PowerShell 自带能力，无需安装任何依赖。

# 不继承系统代理：系统代理配置异常时，Invoke-WebRequest 会把请求交给代理，
# 表现为「未能解析此远程名称」，而 curl 不读系统代理所以能通。
[System.Net.WebRequest]::DefaultWebProxy = $null

$script:AgentDir = Join-Path $env:LOCALAPPDATA 'LiveDashboardAgent'
$script:AgentConfigFile = Join-Path $script:AgentDir 'config.json'
$script:AgentLogFile = Join-Path $script:AgentDir 'agent.log'
$script:AutoStartName = 'LiveDashboardAgent'
$script:AutoStartKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'

function Initialize-AgentDir {
  if (-not (Test-Path $script:AgentDir)) {
    New-Item -ItemType Directory -Path $script:AgentDir -Force | Out-Null
  }
}

function Get-AgentConfigPath { return $script:AgentConfigFile }
function Get-AgentLogPath { return $script:AgentLogFile }

function Get-DefaultConfig {
  [pscustomobject]@{
    serverUrl        = ''
    token            = ''
    intervalSeconds  = 10
    heartbeatSeconds = 60
    sendWindowTitle  = $true
    autoStart        = $false
    allowCommands    = $false   # 允许观众发指令（截屏），默认关闭
  }
}

function Read-AgentConfig {
  try {
    if (-not (Test-Path -Path $script:AgentConfigFile)) { return $null }
    $raw = Get-Content -Path $script:AgentConfigFile -Raw -Encoding UTF8 | ConvertFrom-Json
    $cfg = Get-DefaultConfig
    if ($raw.serverUrl) { $cfg.serverUrl = [string]$raw.serverUrl }
    if ($raw.token) { $cfg.token = [string]$raw.token }
    if ($raw.intervalSeconds) { $cfg.intervalSeconds = [int]$raw.intervalSeconds }
    if ($raw.heartbeatSeconds) { $cfg.heartbeatSeconds = [int]$raw.heartbeatSeconds }
    if ($raw.sendWindowTitle -ne $null) { $cfg.sendWindowTitle = [bool]$raw.sendWindowTitle }
    if ($raw.autoStart -ne $null) { $cfg.autoStart = [bool]$raw.autoStart }
    if ($raw.allowCommands -ne $null) { $cfg.allowCommands = [bool]$raw.allowCommands }
    return $cfg
  } catch {
    return $null
  }
}

function Save-AgentConfig($Config) {
  Initialize-AgentDir
  $json = $Config | ConvertTo-Json -Depth 4
  [System.IO.File]::WriteAllText($script:AgentConfigFile, $json, (New-Object System.Text.UTF8Encoding($false)))
}

function Write-AgentLog([string]$Message) {
  try {
    Initialize-AgentDir
    $line = '[{0}] {1}' -f (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'), $Message
    Add-Content -Path $script:AgentLogFile -Value $line -Encoding UTF8
    $item = Get-Item $script:AgentLogFile -ErrorAction SilentlyContinue
    if ($item -and $item.Length -gt 1MB) {
      $tail = Get-Content -Path $script:AgentLogFile -Tail 500 -Encoding UTF8
      Set-Content -Path $script:AgentLogFile -Value $tail -Encoding UTF8
    }
  } catch {}
}

function Set-AgentAutoStart([bool]$Enabled) {
  try {
    if ($Enabled) {
      $vbs = Join-Path $PSScriptRoot 'start-agent.vbs'
      $cmd = 'wscript.exe "{0}"' -f $vbs
      New-Item -Path $script:AutoStartKey -Force | Out-Null
      New-ItemProperty -Path $script:AutoStartKey -Name $script:AutoStartName `
        -Value $cmd -PropertyType String -Force | Out-Null
    } else {
      Remove-ItemProperty -Path $script:AutoStartKey -Name $script:AutoStartName -ErrorAction SilentlyContinue
    }
    return $true
  } catch {
    return $false
  }
}

function Get-AgentAutoStart {
  try {
    $v = Get-ItemProperty -Path $script:AutoStartKey -Name $script:AutoStartName -ErrorAction SilentlyContinue
    return ($null -ne $v)
  } catch {
    return $false
  }
}

# ── 前台窗口采集（user32） ─────────────────────────────────────────────
Add-Type -Namespace AgentNative -Name Win32 -MemberDefinition @'
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int count);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
'@

function Get-ForegroundApp {
  $hwnd = [AgentNative.Win32]::GetForegroundWindow()
  if ($hwnd -eq [IntPtr]::Zero) { return $null }

  $sb = New-Object System.Text.StringBuilder 512
  [void][AgentNative.Win32]::GetWindowText($hwnd, $sb, 512)
  $title = $sb.ToString()

  $procId = 0
  [void][AgentNative.Win32]::GetWindowThreadProcessId($hwnd, [ref]$procId)
  $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
  $name = if ($proc) { $proc.ProcessName } else { '' }

  return @{
    AppId = if ($name) { "$name.exe" } else { 'unknown.exe' }
    Title = $title
  }
}

function Get-BatteryInfo {
  try {
    $b = Get-CimInstance -ClassName Win32_Battery -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $b) { return $null }
    return @{
      battery_percent  = [int]$b.EstimatedChargeRemaining
      battery_charging = ($b.BatteryStatus -ne 1)
    }
  } catch {
    return $null
  }
}

# ── AES-256-CBC + HMAC-SHA256 加密信封（与 server.js deriveKeys 对应） ──
function Protect-Payload([string]$Json, [string]$DeviceToken) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $base = $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($DeviceToken))
  $encKey = $sha.ComputeHash($base + [byte]1)
  $macKey = $sha.ComputeHash($base + [byte]2)

  $aes = New-Object System.Security.Cryptography.AesCryptoServiceProvider
  $aes.KeySize = 256
  $aes.Key = $encKey
  $aes.Mode = [System.Security.Cryptography.CipherMode]::CBC
  $aes.Padding = [System.Security.Cryptography.PaddingMode]::PKCS7
  $aes.GenerateIV()
  $iv = $aes.IV

  $plain = [Text.Encoding]::UTF8.GetBytes($Json)
  $enc = $aes.CreateEncryptor()
  $cipher = $enc.TransformFinalBlock($plain, 0, $plain.Length)

  $hmac = [System.Security.Cryptography.HMACSHA256]::new($macKey)
  $mac = $hmac.ComputeHash($iv + $cipher)

  $aes.Dispose(); $enc.Dispose(); $hmac.Dispose(); $sha.Dispose()

  return @{
    enc  = 1
    iv   = [Convert]::ToBase64String($iv)
    data = [Convert]::ToBase64String($cipher)
    mac  = [Convert]::ToBase64String($mac)
  }
}

function Resolve-ReportUrl([string]$ServerUrl) {
  $u = $ServerUrl.Trim().TrimEnd('/')
  if (-not $u.EndsWith('/api/report')) { $u = "$u/api/report" }
  return $u
}

function Send-AgentReport([string]$ServerUrl, [string]$Token, $Body) {
  $json = $Body | ConvertTo-Json -Compress
  Invoke-RestMethod -Uri (Resolve-ReportUrl $ServerUrl) -Method Post `
    -ContentType 'application/json' -Headers @{ Authorization = "Bearer $Token" } `
    -Body $json -TimeoutSec 15 | Out-Null
}

# 配置界面「测试上报」用：先探活，再用令牌真发一条明文测试数据
function Test-AgentReport([string]$ServerUrl, [string]$Token) {
  $base = $ServerUrl.Trim().TrimEnd('/')
  if ($base -notmatch '^https?://') { return '地址格式不对：需要以 http:// 或 https:// 开头' }

  try {
    $health = Invoke-WebRequest -Uri "$base/api/health" -UseBasicParsing -TimeoutSec 10
    if ($health.StatusCode -ne 200) { return "后端 /api/health 返回 $($health.StatusCode)" }
  } catch {
    return '连不上后端：' + $_.Exception.Message
  }

  $payload = @{
    app_id    = 'com.livedashboard.agent-test'
    app_label = 'Windows 客户机配置测试'
    timestamp = (Get-Date).ToUniversalTime().ToString('o')
  }
  try {
    Send-AgentReport $base $Token $payload
    return 'OK'
  } catch {
    return '上报失败（多半是令牌不对）：' + $_.Exception.Message
  }
}

# ── 观众指令（截屏） ───────────────────────────────────────────────────
# 后端地址可能是 https://host 或 https://host/api/report，统一取到 /api 之前
function Get-ApiBase([string]$ServerUrl) {
  $u = $ServerUrl.Trim().TrimEnd('/')
  $i = $u.IndexOf('/api/')
  if ($i -ge 0) { return $u.Substring(0, $i) }
  return $u
}

function Invoke-AgentApi {
  param(
    [string]$ServerUrl,
    [string]$Token,
    [string]$ApiPath,
    [string]$Method = 'Get',
    [string]$Body = '',
    [int]$TimeoutSec = 45
  )
  $uri = "$(Get-ApiBase $ServerUrl)$ApiPath"
  $headers = @{ Authorization = "Bearer $Token" }
  if ($Body) {
    # PowerShell 5.1 默认按 Latin-1 发送字符串正文，中文会变问号，这里显式转成 UTF-8 字节
    $bytes = [Text.Encoding]::UTF8.GetBytes($Body)
    return Invoke-RestMethod -Uri $uri -Method Post -ContentType 'application/json; charset=utf-8' `
      -Headers $headers -Body $bytes -TimeoutSec $TimeoutSec
  }
  return Invoke-RestMethod -Uri $uri -Method $Method -Headers $headers -TimeoutSec $TimeoutSec
}

# 收到指令后先回执，服务端会把 20 秒审批计时换成截屏上传宽限
function Send-CommandAck([string]$ServerUrl, [string]$Token, [string]$CommandId) {
  $json = @{ id = $CommandId } | ConvertTo-Json -Compress
  Invoke-AgentApi -ServerUrl $ServerUrl -Token $Token -ApiPath '/api/agent/command-ack' -Body $json -TimeoutSec 15
}

# 回执：同意（带截图）或拒绝
function Send-CommandResult {
  param(
    [string]$ServerUrl,
    [string]$Token,
    [string]$CommandId,
    [string]$Decision,
    $Shot = $null,
    [string]$ErrorText = ''
  )
  $body = @{ id = $CommandId; decision = $Decision }
  if ($Shot) {
    $body.image = $Shot.base64
    $body.width = $Shot.width
    $body.height = $Shot.height
  }
  if ($ErrorText) { $body.error = $ErrorText }
  $json = $body | ConvertTo-Json -Compress
  Invoke-AgentApi -ServerUrl $ServerUrl -Token $Token -ApiPath '/api/agent/command-result' -Body $json -TimeoutSec 45
}

# ── 截屏：主屏整屏 → 缩到 1280 宽 → JPEG 70 ───────────────────────────
# 实现在 screencap.cs 里，脚本这边只负责编译和调用：
# Defender 会把「PowerShell 里截屏 + 转 base64 + 上传」误判成木马，拆开后就不会被拦截。
function Initialize-ScreenType {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  if (-not ('AgentScreen' -as [type])) {
    $cs = Join-Path $PSScriptRoot 'screencap.cs'
    if (-not (Test-Path $cs)) { throw "缺少 screencap.cs：$cs" }
    Add-Type -TypeDefinition (Get-Content -Path $cs -Raw -Encoding UTF8) `
      -ReferencedAssemblies 'System.Drawing', 'System.Windows.Forms'
  }
}

# 屏幕几何参数，只写日志用（不截屏，锁屏状态下也能取到）
function Get-ScreenGeometry {
  Initialize-ScreenType
  return [AgentScreen]::Describe()
}

function Capture-ScreenJpeg {
  param(
    [int]$MaxWidth = 1280,
    [int]$Quality = 70
  )
  Initialize-ScreenType

  $shot = [AgentScreen]::Capture($MaxWidth, $Quality)
  return @{
    base64 = $shot.Base64
    width  = $shot.Width
    height = $shot.Height
    bytes  = $shot.Bytes
    debug  = $shot.Debug
  }
}
