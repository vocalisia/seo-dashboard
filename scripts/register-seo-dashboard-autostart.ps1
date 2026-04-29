# Enregistre une tache Windows planifiee : au demarrage de session, lance seo-dashboard (npm run dev).
# A executer UNE FOIS (clic droit > Executer avec PowerShell), ou depuis une console elevee si Windows le demande.

$ErrorActionPreference = "Stop"
$taskName = "VocalisSeoDashboardDev"
$projectRoot = Split-Path $PSScriptRoot -Parent
$scriptPath = Join-Path $PSScriptRoot "run-dev-at-logon.ps1"

if (-not (Test-Path $scriptPath)) {
  throw "Script introuvable: $scriptPath"
}

$psExe = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
if (-not (Test-Path $psExe)) {
  throw "powershell.exe introuvable: $psExe"
}

# Arguments: fenetre masquee, pas d'interaction
$argLine = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$scriptPath`""

$action = New-ScheduledTaskAction -Execute $psExe -Argument $argLine -WorkingDirectory $projectRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

# Interactive = meme contexte qu'une session utilisateur (PATH / profil charge comme a l'ouverture de session)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Days 3650)

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger $trigger `
  -Principal $principal `
  -Settings $settings `
  -Description "Demarre automatiquement le SEO dashboard (npm run dev) a la connexion Windows."

Write-Host "OK - tache '$taskName' enregistree pour utilisateur $env:USERNAME."
Write-Host "Logs: $projectRoot\logs\dev-autostart.log"
Write-Host "Pour tester tout de suite: Start-ScheduledTask -TaskName $taskName"
