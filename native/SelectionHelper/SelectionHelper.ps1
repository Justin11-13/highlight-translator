# SelectionHelper 宿主脚本：用 Add-Type 在 powershell.exe（微软签名宿主）
# 内内存编译 Helper.cs。见 Helper.cs 文件头注释了解原因。

$ErrorActionPreference = 'Stop'

# stdout 统一 UTF-8（无 BOM），Electron 按行解析 JSON
try {
  [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
} catch { }

$helperCs = Join-Path $PSScriptRoot 'Helper.cs'

Add-Type -TypeDefinition (Get-Content -Raw -Encoding UTF8 $helperCs) `
  -ReferencedAssemblies @(
    'System', 'System.Core', 'System.Runtime.InteropServices',
    'System.Windows.Forms', 'System.Drawing',
    'UIAutomationClient', 'UIAutomationTypes', 'WindowsBase'
  )

# 命令行参数原样转交：--parent-pid <pid> --clipboard-fallback --selftest
$exitCode = [SelectionHelper.Program]::Run($args)
exit $exitCode
