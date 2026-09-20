$ErrorActionPreference = 'Continue'

Write-Output 'stopping running app...'
Get-Process | Where-Object { $_.Name -like 'Highlight Translator*' } | Stop-Process -Force
Start-Sleep -Seconds 3
Write-Output 'stopped'
