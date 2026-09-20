$shell = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath('Desktop')
$lnk = $shell.CreateShortcut((Join-Path $desktop 'Highlight Translator.lnk'))
Write-Output ("target: {0}" -f $lnk.TargetPath)
Write-Output ("workdir: {0}" -f $lnk.WorkingDirectory)
Write-Output ("icon: {0}" -f $lnk.IconLocation)

if (Test-Path $lnk.TargetPath) {
  Write-Output 'target exists'
  Write-Output ("size: {0}" -f (Get-Item $lnk.TargetPath).Length)
} else {
  Write-Output 'TARGET MISSING'
}
