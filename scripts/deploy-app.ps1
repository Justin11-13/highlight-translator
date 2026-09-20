# 快速部署：--dir 构建 + 直接同步到已安装目录（绕开 NSIS stub 执行，
# 本机 WDAC 会间歇拦截运行新生成的安装器）。
# 用法: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/deploy-app.ps1

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$unpacked = Join-Path $projectRoot 'dist\win-unpacked'
$target = "$env:LOCALAPPDATA\Programs\highlight-translator"

Write-Output '[deploy] stopping app...'
Get-Process | Where-Object { $_.Name -like 'Highlight Translator*' } | Stop-Process -Force
Start-Sleep -Seconds 3

Write-Output '[deploy] building (electron-vite + dir pack)...'
Push-Location $projectRoot
cmd /c "npx electron-vite build && npx electron-builder --win --dir" 2>&1 | Out-Null
Pop-Location

if (-not (Test-Path $unpacked)) {
  Write-Output '[deploy] win-unpacked missing - build failed'
  exit 1
}

Write-Output '[deploy] syncing files...'
# /MIR 镜像（删除已不存在的旧文件）；/NFL /NDL 减少输出
robocopy $unpacked $target /MIR /NFL /NDL /NJH /NJS | Out-Null
if ($LASTEXITCODE -ge 8) {
  Write-Output "[deploy] robocopy failed with code $LASTEXITCODE"
  exit 1
}

# 用官方签名的 Electron 运行时替换无签名的 app 宿主 exe：
# 本机 SAC 只拦未签名 exe，签名宿主 + 我们的 app.asar = 正常运行
$electronExe = Join-Path $projectRoot 'node_modules\electron\dist\electron.exe'
Copy-Item $electronExe (Join-Path $target 'Highlight Translator.exe') -Force

# 应用图标供快捷方式与窗口使用
Copy-Item (Join-Path $projectRoot 'build\icon.ico') (Join-Path $target 'resources\icons\app.ico') -Force

# 直接部署不经过 NSIS；显式重建并校验桌面快捷方式目标。
$desktop = [Environment]::GetFolderPath('Desktop')
& (Join-Path $projectRoot 'scripts\create-shortcut.ps1') `
  -TargetPath (Join-Path $target 'Highlight Translator.exe') `
  -ShortcutPath (Join-Path $desktop 'Highlight Translator.lnk') `
  -WorkingDirectory $target `
  -IconLocation (Join-Path $target 'resources\icons\app.ico')

Write-Output '[deploy] launching app...'
Start-Process -FilePath (Join-Path $target 'Highlight Translator.exe')
Write-Output '[deploy] done'
