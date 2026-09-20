# 端到端钩子测试：启动 Helper，然后用真实的 SendInput 鼠标双击
# 在自己的测试窗体里选中一个词，验证 Helper 的 LL 钩子 -> 读取 -> JSON 全链路。
# 用法: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-hook.ps1 [-ForceClipboard]
#   -ForceClipboard: 跳过 UIA 直接测剪贴板兜底路径

param([switch]$ForceClipboard)

$ErrorActionPreference = 'Continue'
$projectRoot = Split-Path -Parent $PSScriptRoot
$helperScript = Join-Path $projectRoot 'native\SelectionHelper\SelectionHelper.ps1'

$outFile = Join-Path $env:TEMP 'ht-helper-stdout.txt'
$errFile = Join-Path $env:TEMP 'ht-helper-stderr.txt'
Remove-Item $outFile, $errFile -ErrorAction SilentlyContinue

Write-Output '[test] starting helper...'
$helperArgs = @(
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-STA',
    '-File', $helperScript, '--clipboard-fallback'
)
if ($ForceClipboard) { $helperArgs += '--force-clipboard' }

$helper = Start-Process powershell -ArgumentList $helperArgs -PassThru -WindowStyle Hidden `
  -RedirectStandardOutput $outFile -RedirectStandardError $errFile

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class Mouse {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  public const uint LEFTDOWN = 0x0002, LEFTUP = 0x0004;
}
'@

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# 测试窗体：带多行文本框，位于已知坐标
$form = New-Object System.Windows.Forms.Form
$form.StartPosition = 'Manual'
$form.Location = New-Object System.Drawing.Point(100, 100)
$form.Size = New-Object System.Drawing.Size(600, 400)
$form.TopMost = $true

$box = New-Object System.Windows.Forms.TextBox
$box.Multiline = $true
$box.Dock = 'Fill'
$box.Font = New-Object System.Drawing.Font('Segoe UI', 14)
$testText = "The quick brown fox jumps over the lazy dog near the river bank every single morning without fail."
$box.Text = $testText
$form.Controls.Add($box)

$form.Show()
[System.Windows.Forms.Application]::DoEvents()
$form.Activate()
$form.BringToFront()
[Mouse]::SetForegroundWindow($form.Handle) | Out-Null
$box.Focus()
Start-Sleep -Milliseconds 600
[System.Windows.Forms.Application]::DoEvents()

$targetPoint = $box.PointToScreen((New-Object System.Drawing.Point(250, 160)))
Write-Output "[test] sending real double-click at ($($targetPoint.X), $($targetPoint.Y))..."

# 真实鼠标双击（LL 钩子必须能收到）
[Mouse]::SetCursorPos($targetPoint.X, $targetPoint.Y) | Out-Null
Start-Sleep -Milliseconds 120
[Mouse]::mouse_event([Mouse]::LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
[Mouse]::mouse_event([Mouse]::LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 90
[Mouse]::mouse_event([Mouse]::LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
[Mouse]::mouse_event([Mouse]::LEFTUP, 0, 0, 0, [UIntPtr]::Zero)

# 轮询 Helper 的 stdout，最多等 20 秒
$deadline = (Get-Date).AddSeconds(20)
$selectionLine = $null

while ((Get-Date) -lt $deadline -and -not $selectionLine) {
  Start-Sleep -Milliseconds 200
  [System.Windows.Forms.Application]::DoEvents()

  if (Test-Path $outFile) {
    $line = (Get-Content $outFile -ErrorAction SilentlyContinue) |
      Where-Object { $_ -like '*"event":"selection"*' } |
      Select-Object -Last 1
    if ($line) { $selectionLine = $line }
  }
}

$form.Close()

Write-Output '[test] helper stdout:'
Get-Content $outFile -ErrorAction SilentlyContinue | ForEach-Object { Write-Output "  $_" }
Write-Output '[test] helper stderr:'
Get-Content $errFile -ErrorAction SilentlyContinue | Select-Object -First 5 | ForEach-Object { Write-Output "  $_" }

if ($helper -and -not $helper.HasExited) {
  Stop-Process -Id $helper.Id -Force
}

if ($selectionLine) {
  try {
    $selection = $selectionLine | ConvertFrom-Json
    $isOwnWindow = $selection.process -eq 'powershell'
    $isExpectedText = $testText.Contains([string]$selection.text)
  } catch {
    $isOwnWindow = $false
    $isExpectedText = $false
  }
}

if ($selectionLine -and $isOwnWindow -and $isExpectedText) {
  Write-Output '[test] PASS - hook -> read -> selection event works'
  exit 0
}

Write-Output '[test] FAIL - no valid selection event from the owned test window'
exit 1
