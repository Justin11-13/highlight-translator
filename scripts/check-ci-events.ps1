Get-WinEvent -FilterHashtable @{ LogName='Microsoft-Windows-CodeIntegrity/Operational'; Id=3077,3076 } -MaxEvents 8 -ErrorAction SilentlyContinue |
  ForEach-Object {
    $first = ($_.Message -split "`n")[0]
    Write-Output ("{0} id={1} {2}" -f $_.TimeCreated, $_.Id, $first)
  }
