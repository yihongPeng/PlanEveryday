$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$exePath = 'D:\Programs\PlanEveryday\PlanEveryday.exe'
if (-not (Test-Path -LiteralPath $exePath)) { throw '请先运行芽芽计划安装包。' }
$desktopPath = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktopPath '芽芽计划.lnk'
$wsh = New-Object -ComObject WScript.Shell
$shortcut = $wsh.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $exePath
$shortcut.WorkingDirectory = Split-Path $exePath
$shortcut.IconLocation = $exePath + ',0'
$shortcut.Description = '芽芽计划 - 点击桌宠，轻松安排每一天'
$shortcut.WindowStyle = 1
$shortcut.Save()
Write-Output $shortcutPath
