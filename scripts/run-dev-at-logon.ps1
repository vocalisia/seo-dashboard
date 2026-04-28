# Lance npm run dev pour seo-dashboard a la connexion utilisateur.
# Appele par la tache planifiee "VocalisSeoDashboardDev" (sans clic).

$ErrorActionPreference = "Stop"

# Ce fichier est dans .../seo-dashboard/scripts/
$ProjectRoot = Split-Path $PSScriptRoot -Parent

if (-not (Test-Path (Join-Path $ProjectRoot "package.json"))) {
  throw "package.json introuvable sous $ProjectRoot — chemin projet incorrect."
}

$LogDir = Join-Path $ProjectRoot "logs"
$null = New-Item -ItemType Directory -Force -Path $LogDir
$LogFile = Join-Path $LogDir "dev-autostart.log"

function Write-Log([string]$msg) {
  $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
  Add-Content -Path $LogFile -Value $line -Encoding UTF8
}

# PATH Machine + User (les taches planifiees n'ont souvent pas le PATH interactif)
$machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
$env:Path = "$machinePath;$userPath"

$port = 3000
try {
  $tcp = New-Object System.Net.Sockets.TcpClient
  $iar = $tcp.BeginConnect("127.0.0.1", $port, $null, $null)
  $waited = $iar.AsyncWaitHandle.WaitOne(400)
  if ($waited) {
    $tcp.EndConnect($iar)
    if ($tcp.Connected) {
      $tcp.Close()
      Write-Log "Port $port deja en ecoute — on ne lance pas une 2e instance."
      exit 0
    }
  }
  $tcp.Close()
} catch {
  Write-Log "Test port $port : $($_.Exception.Message) — on continue vers npm run dev."
}

Set-Location $ProjectRoot
Write-Log "Demarrage npm run dev dans $ProjectRoot"

$npmCmd = Join-Path ${env:ProgramFiles} "nodejs\npm.cmd"
if (Test-Path $npmCmd) {
  & $npmCmd @("run", "dev")
} elseif (Get-Command npm.cmd -ErrorAction SilentlyContinue) {
  & (Get-Command npm.cmd).Source @("run", "dev")
} elseif (Get-Command npm -ErrorAction SilentlyContinue) {
  & (Get-Command npm).Source @("run", "dev")
} else {
  Write-Log "ERREUR: npm introuvable (PATH + Program Files/nodejs)."
  exit 1
}

$code = $LASTEXITCODE
Write-Log "npm run dev termine avec le code $code"
exit $code
