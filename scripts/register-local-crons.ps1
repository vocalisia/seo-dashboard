# Enregistre 7 taches Windows planifiees qui hit les endpoints cron locaux (localhost:3000).
# Remplace les crons Vercel.
# A executer UNE FOIS (clic droit > Executer avec PowerShell, ou console elevee si demande).

$ErrorActionPreference = "Stop"
$cronSecret = $env:CRON_SECRET
if (-not $cronSecret) {
  $envLocal = Join-Path (Split-Path $PSScriptRoot -Parent) ".env.local"
  if (Test-Path $envLocal) {
    $line = Select-String -Path $envLocal -Pattern '^CRON_SECRET=' | Select-Object -First 1
    if ($line) { $cronSecret = ($line.Line -replace '^CRON_SECRET="?([^"]*)"?$', '$1') }
  }
}
if (-not $cronSecret) {
  Write-Warning "CRON_SECRET non trouve. Les routes protegees vont echouer. Definis CRON_SECRET dans .env.local."
  $cronSecret = ""
}

$baseUrl = "http://localhost:3000"
$tasks = @(
  @{ Name = "Vocalis_Seo_Sync_Daily";        Path = "/api/sync";                   Schedule = "Daily";  At = "03:00" },
  @{ Name = "Vocalis_Seo_Alerts_Daily";      Path = "/api/alerts/check";           Schedule = "Daily";  At = "06:00" },
  @{ Name = "Vocalis_Seo_VerifyUrls_Daily";  Path = "/api/autopilot/verify-urls";  Schedule = "Daily";  At = "05:00" },
  @{ Name = "Vocalis_Seo_PageSpeed_Sunday";  Path = "/api/pagespeed/weekly";       Schedule = "Weekly"; At = "04:00"; Day = "Sunday" },
  @{ Name = "Vocalis_Seo_Competitors_Mon";   Path = "/api/competitors/weekly";     Schedule = "Weekly"; At = "07:00"; Day = "Monday" },
  @{ Name = "Vocalis_Seo_Reports_Mon";       Path = "/api/reports/generate";       Schedule = "Weekly"; At = "08:00"; Day = "Monday" },
  @{ Name = "Vocalis_Seo_Autopilot_Mon";     Path = "/api/autopilot/weekly";       Schedule = "Weekly"; At = "09:00"; Day = "Monday" }
)

foreach ($t in $tasks) {
  $url = "$baseUrl$($t.Path)"
  $headers = if ($cronSecret) { "@{Authorization='Bearer $cronSecret'}" } else { "@{}" }
  $cmd = "Invoke-WebRequest -Uri '$url' -Method POST -Headers $headers -UseBasicParsing -TimeoutSec 600"
  $argLine = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command `"$cmd`""

  $psExe = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
  $action = New-ScheduledTaskAction -Execute $psExe -Argument $argLine

  if ($t.Schedule -eq "Daily") {
    $trigger = New-ScheduledTaskTrigger -Daily -At $t.At
  } else {
    $trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $t.Day -At $t.At
  }

  $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
  $settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 1)

  Unregister-ScheduledTask -TaskName $t.Name -Confirm:$false -ErrorAction SilentlyContinue
  Register-ScheduledTask -TaskName $t.Name -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description "Local cron $($t.Path)" | Out-Null
  Write-Host "OK - $($t.Name) -> $url ($($t.Schedule) $($t.At) $($t.Day))"
}

Write-Host ""
Write-Host "OK - 7 taches Windows enregistrees."
Write-Host "Liste: Get-ScheduledTask -TaskName Vocalis_Seo_*"
Write-Host "Test: Start-ScheduledTask -TaskName Vocalis_Seo_Alerts_Daily"
