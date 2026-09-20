$ErrorActionPreference = 'Continue'

Write-Output '=== AppLocker ==='
try {
  $p = Get-AppLockerPolicy -Effective -ErrorAction Stop
  $p.RuleCollections | ForEach-Object { Write-Output ("{0} mode={1}" -f $_.RuleCollectionType, $_.EnforcementMode) }
  if (-not $p.RuleCollections) { Write-Output '(no rule collections)' }
} catch { Write-Output "applocker query failed: $($_.Exception.Message)" }

Write-Output '=== WDAC (CodeIntegrity) ==='
try {
  $ci = Get-CimInstance -Namespace root\Microsoft\Windows\CodeIntegrity -ClassName Win32_CodeIntegrityPolicy -ErrorAction Stop
  Write-Output ("PolicyEnabled={0} Enforce={1}" -f $ci.PolicyEnabled, $ci.EnforceMode)
} catch { Write-Output "wdac query failed: $($_.Exception.Message)" }

Write-Output '=== System audit policy (CodeIntegrity) ==='
try {
  auditpol /get /subcategory:'Other System Events' 2>&1 | Write-Output
} catch { Write-Output 'auditpol failed' }

Write-Output '=== Recent CodeIntegrity 3077/3076 events ==='
try {
  Get-WinEvent -FilterHashtable @{ LogName='Microsoft-Windows-CodeIntegrity/Operational'; Id=3077,3076,3089 } -MaxEvents 6 -ErrorAction Stop |
    ForEach-Object { Write-Output ("{0} id={1} {2}" -f $_.TimeCreated, $_.Id, ($_.Message -split "`n")[0]) }
} catch { Write-Output "event query failed: $($_.Exception.Message)" }
