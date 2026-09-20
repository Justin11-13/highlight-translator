# 启动已安装的 Highlight Translator（避免 bash/PowerShell 引号转义问题）
$app = "$env:LOCALAPPDATA\Programs\highlight-translator\Highlight Translator.exe"

if (-not (Test-Path $app)) {
  Write-Output "APP NOT FOUND: $app"
  exit 1
}

$running = Get-Process | Where-Object { $_.Name -like 'Highlight Translator*' }

if ($running) {
  Write-Output 'already running'
} else {
  Start-Process -FilePath $app
  Write-Output 'launched'
}
