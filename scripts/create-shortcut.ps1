# 创建并校验 Highlight Translator 的桌面快捷方式。
# 用法:
# powershell -NoProfile -ExecutionPolicy Bypass -File scripts/create-shortcut.ps1 `
#   -TargetPath "$env:LOCALAPPDATA\Programs\highlight-translator\Highlight Translator.exe" `
#   -ShortcutPath "$([Environment]::GetFolderPath('Desktop'))\Highlight Translator.lnk"

param(
  [Parameter(Mandatory = $true)]
  [string]$TargetPath,

  [Parameter(Mandatory = $true)]
  [string]$ShortcutPath,

  [string]$WorkingDirectory,

  [string]$IconLocation
)

$ErrorActionPreference = 'Stop'

$target = [IO.Path]::GetFullPath($TargetPath)
$shortcut = [IO.Path]::GetFullPath($ShortcutPath)

if (-not (Test-Path -LiteralPath $target -PathType Leaf)) {
  throw "Shortcut target does not exist: $target"
}

$shortcutParent = Split-Path -Parent $shortcut
if (-not (Test-Path -LiteralPath $shortcutParent -PathType Container)) {
  New-Item -ItemType Directory -Path $shortcutParent -Force | Out-Null
}

$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut($shortcut)
$link.TargetPath = $target
$link.WorkingDirectory = if ($WorkingDirectory) {
  [IO.Path]::GetFullPath($WorkingDirectory)
} else {
  Split-Path -Parent $target
}
$link.Arguments = ''
$link.Description = 'Highlight Translator'

if ($IconLocation) {
  $icon = [IO.Path]::GetFullPath($IconLocation)
  if (Test-Path -LiteralPath $icon -PathType Leaf) {
    $link.IconLocation = "$icon,0"
  }
}

$link.Save()

$verify = $shell.CreateShortcut($shortcut)
if ($verify.TargetPath -ne $target) {
  throw "Shortcut verification failed. Expected '$target', got '$($verify.TargetPath)'"
}

Write-Output "shortcut: $shortcut"
Write-Output "target: $($verify.TargetPath)"
Write-Output "working directory: $($verify.WorkingDirectory)"
Write-Output "icon: $($verify.IconLocation)"
