# 静默安装打包好的 NSIS 安装器并校验安装结果。
# 用法: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-app.ps1

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$distDir = Join-Path $projectRoot 'dist'
$setup = Get-ChildItem -LiteralPath $distDir -Filter 'Highlight Translator Setup *.exe' -File |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (-not $setup) {
  throw "No Highlight Translator installer found in $distDir. Run npm run dist first."
}

Write-Output ("installer: {0}" -f $setup.FullName)

Get-Process -Name 'Highlight Translator' -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2

Write-Output 'running silent install...'
$proc = Start-Process -FilePath $setup.FullName -ArgumentList '/S' -Wait -PassThru
Write-Output ("installer exit code: {0}" -f $proc.ExitCode)

if ($proc.ExitCode -ne 0) {
  throw "Installer failed with exit code $($proc.ExitCode)"
}

Start-Sleep -Seconds 5

# electron-builder 以 package.json 的 name 命名安装目录
$installDir = "$env:LOCALAPPDATA\Programs\highlight-translator"
if (Test-Path -LiteralPath $installDir -PathType Container) {
  Write-Output "installed at: $installDir"
  Get-ChildItem $installDir | Select-Object -First 8 -ExpandProperty Name
} else {
  throw "INSTALL DIR NOT FOUND: $installDir"
}

# NSIS 会创建快捷方式；这里用明确的已安装 exe 重建并校验 TargetPath。
$desktop = [Environment]::GetFolderPath('Desktop')
$lnk = Join-Path $desktop 'Highlight Translator.lnk'
$target = Join-Path $installDir 'Highlight Translator.exe'
$icon = Join-Path $installDir 'resources\icons\app.ico'

& (Join-Path $projectRoot 'scripts\create-shortcut.ps1') `
  -TargetPath $target `
  -ShortcutPath $lnk `
  -WorkingDirectory $installDir `
  -IconLocation $icon
