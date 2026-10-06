<#
.SYNOPSIS
  Installa (o aggiorna) Sestante come servizio Windows.

.DESCRIPTION
  Da eseguire in un PowerShell aperto come amministratore, dalla cartella
  "service" dello zip di Sestante:

    powershell -ExecutionPolicy Bypass -File .\install-service.ps1

  Cosa fa:
    1. ferma e rimuove un servizio Sestante già installato (aggiornamento);
    2. copia Sestante in -InstallDir (default: C:\Program Files\Sestante),
       senza toccare un sestante.env già presente lì;
    3. crea la cartella dei dati (C:\ProgramData\Sestante) e la rende
       scrivibile dall'account del servizio (LocalService);
    4. registra il servizio con WinSW, lo avvia e aspetta che risponda.

  I dati restano in C:\ProgramData\Sestante anche se si disinstalla.

.PARAMETER InstallDir
  Dove copiare Sestante. Deve essere leggibile da LocalService: Program Files
  va bene, una cartella dentro il profilo utente (Download, Desktop) no.

.PARAMETER Port
  Porta d'ascolto del servizio (default 4000).
#>
#Requires -RunAsAdministrator
[CmdletBinding()]
param(
  [string]$InstallDir = (Join-Path $env:ProgramFiles "Sestante"),
  [int]$Port = 4000
)

$ErrorActionPreference = "Stop"
$source = Split-Path -Parent $PSScriptRoot
$dataDir = Join-Path $env:ProgramData "Sestante"
$wrapper = Join-Path $InstallDir "service\sestante-service.exe"

function Step($message) { Write-Host "`n  > $message" -ForegroundColor Cyan }

if (-not (Test-Path (Join-Path $source "Sestante.exe"))) {
  throw "Sestante.exe non trovato in $source. Lancia lo script dalla cartella 'service' dello zip."
}

# 1. Servizio già presente: lo si ferma e lo si toglie, i dati restano.
if (Get-Service -Name "sestante" -ErrorAction SilentlyContinue) {
  Step "Servizio esistente: lo fermo e lo rimuovo per aggiornarlo"
  if (Test-Path $wrapper) {
    & $wrapper stop | Out-Null
    & $wrapper uninstall | Out-Null
  } else {
    Stop-Service -Name "sestante" -Force -ErrorAction SilentlyContinue
    sc.exe delete sestante | Out-Null
  }
  Start-Sleep -Seconds 2
}

# 2. Copia dei file. /MIR allinea la destinazione alla sorgente, ma lascia
#    stare la configurazione locale e un'eventuale cartella dati portabile.
if ((Resolve-Path $source).Path -ne [IO.Path]::GetFullPath($InstallDir)) {
  Step "Copio Sestante in $InstallDir"
  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
  robocopy $source $InstallDir /MIR /XD data /XF sestante.env /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "Copia non riuscita (robocopy $LASTEXITCODE)." }
}

# La porta richiesta finisce nella configurazione del servizio.
$xmlPath = Join-Path $InstallDir "service\sestante-service.xml"
$xml = Get-Content $xmlPath -Raw
$xml = $xml -replace '<env name="PORT" value="\d+" />', "<env name=`"PORT`" value=`"$Port`" />"
$xml = $xml -replace '\(http://localhost:\d+\)', "(http://localhost:$Port)"
Set-Content -Path $xmlPath -Value $xml -Encoding UTF8

# 3. Dati: scrivibili dall'account del servizio, e da nessun altro utente comune.
Step "Preparo la cartella dei dati $dataDir"
New-Item -ItemType Directory -Force -Path (Join-Path $dataDir "logs") | Out-Null
icacls $dataDir /grant "*S-1-5-19:(OI)(CI)M" /T /Q | Out-Null   # S-1-5-19 = LocalService

# 4. Registrazione e avvio.
Step "Registro e avvio il servizio"
& $wrapper install
if ($LASTEXITCODE -ne 0) { throw "Registrazione del servizio non riuscita." }
& $wrapper start
if ($LASTEXITCODE -ne 0) { throw "Avvio del servizio non riuscito: vedi i log in $dataDir\logs." }

$url = "http://localhost:$Port"
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 1
  try {
    $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 "$url/api/config"
    if ($response.StatusCode -eq 200) { $ready = $true; break }
  } catch { }
}

if ($ready) {
  Write-Host "`n  Sestante è attivo come servizio: $url" -ForegroundColor Green
} else {
  Write-Warning "Il servizio è avviato ma $url non risponde ancora. Log: $dataDir\logs"
}
Write-Host "  Configurazione: $InstallDir\sestante.env   Dati: $dataDir`n"
