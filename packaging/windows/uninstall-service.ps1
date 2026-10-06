<#
.SYNOPSIS
  Rimuove il servizio Windows di Sestante.

.DESCRIPTION
  Da eseguire in un PowerShell aperto come amministratore:

    powershell -ExecutionPolicy Bypass -File .\uninstall-service.ps1

  Ferma e rimuove il servizio. I file installati e i dati restano, a meno di
  chiederlo esplicitamente:

    -RemoveFiles   cancella anche la cartella d'installazione
    -RemoveData    cancella anche C:\ProgramData\Sestante (database, file
                   caricati, log): non si torna indietro
#>
#Requires -RunAsAdministrator
[CmdletBinding()]
param(
  [string]$InstallDir = (Join-Path $env:ProgramFiles "Sestante"),
  [switch]$RemoveFiles,
  [switch]$RemoveData
)

$ErrorActionPreference = "Stop"
$wrapper = Join-Path $InstallDir "service\sestante-service.exe"
$dataDir = Join-Path $env:ProgramData "Sestante"

if (Get-Service -Name "sestante" -ErrorAction SilentlyContinue) {
  if (Test-Path $wrapper) {
    & $wrapper stop | Out-Null
    & $wrapper uninstall
  } else {
    Stop-Service -Name "sestante" -Force -ErrorAction SilentlyContinue
    sc.exe delete sestante | Out-Null
  }
  Write-Host "  Servizio Sestante rimosso." -ForegroundColor Green
} else {
  Write-Host "  Nessun servizio Sestante installato."
}

if ($RemoveFiles -and (Test-Path $InstallDir)) {
  Start-Sleep -Seconds 2
  Remove-Item -Recurse -Force $InstallDir
  Write-Host "  Rimossa $InstallDir"
}
if ($RemoveData -and (Test-Path $dataDir)) {
  Remove-Item -Recurse -Force $dataDir
  Write-Host "  Rimossi i dati in $dataDir"
} elseif (Test-Path $dataDir) {
  Write-Host "  I dati restano in $dataDir (-RemoveData per cancellarli)."
}
