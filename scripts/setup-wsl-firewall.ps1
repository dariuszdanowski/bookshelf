#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Dodaje scopowana regule Hyper-V firewall: Windows -> WSL na portach Supabase (54321-54327).
.NOTES
  Wymaga: PowerShell jako Administrator (UAC).
  Win11 26200+, WSL 2.6+.
  Idempotentny: usuwa stara regule o tej samej nazwie przed dodaniem.
  Regula scoped na VMCreatorId (przezywa zmiane WSL IP i restart Windows).
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RuleName = 'WSL-Supabase-Local'
$WslVmId  = '{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}'
$Ports    = '54321-54327'

Write-Host '=== setup-wsl-firewall.ps1 ===' -ForegroundColor Cyan
Write-Host "VMCreatorId : $WslVmId  (FriendlyName: WSL)"
Write-Host "Porty       : $Ports (Kong/API/Studio/Postgres/Inbucket/Analytics)"
Write-Host ''

# Idempotent: usun istniejaca regule (ignoruj blad gdy nie istnieje)
Remove-NetFirewallHyperVRule -Name $RuleName -ErrorAction SilentlyContinue

# Dodaj nowa regule
New-NetFirewallHyperVRule `
  -Name        $RuleName `
  -DisplayName 'WSL Supabase local dev (54321-54327)' `
  -Direction   Inbound `
  -VMCreatorId $WslVmId `
  -Protocol    TCP `
  -LocalPorts  $Ports `
  -Action      Allow | Out-Null

Write-Host "Regula '$RuleName' dodana." -ForegroundColor Green
Write-Host ''

# Weryfikacja
Write-Host 'Weryfikacja:' -ForegroundColor Cyan
$rule = Get-NetFirewallHyperVRule -Name $RuleName -ErrorAction SilentlyContinue
if ($rule) {
  Write-Host "  Name        : $($rule.Name)"
  Write-Host "  DisplayName : $($rule.DisplayName)"
  Write-Host "  Direction   : $($rule.Direction)"
  Write-Host "  Action      : $($rule.Action)"
  Write-Host "  Enabled     : $($rule.Enabled)"
} else {
  Write-Error 'Regula nie znaleziona po dodaniu - sprawdz uprawnienia i obsluge cmdletu.'
}

Write-Host ''
Write-Host 'Nastepne kroki (w zwyklym PS):' -ForegroundColor Cyan
Write-Host '  1. npm run env:local'
Write-Host '  2. $ip = (wsl -- hostname -I).Trim().Split()[0]'
Write-Host '  3. Invoke-WebRequest "http://${ip}:54321/auth/v1/health" -UseBasicParsing'
Write-Host '     Oczekiwane: StatusCode 200'
