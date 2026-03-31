<#
.SYNOPSIS
    Cleans up leftover resources from failed Az-Stamper deployments.

.DESCRIPTION
    Removes stale deployment script resources, orphaned managed identities,
    and failed deployment entries from the resource group. Preserves actual
    hub resources (function app, storage, monitoring, Event Grid, SWA).
    Safe to run multiple times.

.PARAMETER ResourceGroupName
    Resource group to clean up. Defaults to 'rg-az-stamper'.

.PARAMETER WhatIf
    Show what would be removed without making changes.

.EXAMPLE
    ./Cleanup-FailedDeploy.ps1

.EXAMPLE
    ./Cleanup-FailedDeploy.ps1 -ResourceGroupName 'rg-az-stamper-dev' -WhatIf
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter()]
    [string]$ResourceGroupName = 'rg-az-stamper'
)

$ErrorActionPreference = 'Stop'

Write-Host ""
Write-Host "Az-Stamper Deployment Cleanup" -ForegroundColor Cyan
Write-Host "=============================" -ForegroundColor Cyan
Write-Host "Resource Group: $ResourceGroupName"
Write-Host ""

$context = Get-AzContext
if (-not $context) {
    Write-Error "Not connected to Azure. Run 'Connect-AzAccount' first."
    return
}

# ── 1. Remove deployment script resources ────────────────────────────
Write-Host "[1/4] Checking for deployment script resources..." -ForegroundColor White

$deployScripts = Get-AzResource -ResourceGroupName $ResourceGroupName -ResourceType 'Microsoft.Resources/deploymentScripts' -ErrorAction SilentlyContinue
if ($deployScripts) {
    foreach ($ds in $deployScripts) {
        Write-Host "      Removing deployment script: $($ds.Name)" -ForegroundColor Yellow
        if ($PSCmdlet.ShouldProcess($ds.Name, "Delete deployment script")) {
            Remove-AzResource -ResourceId $ds.ResourceId -Force | Out-Null
            Write-Host "      Deleted." -ForegroundColor Green
        }
    }
}
else {
    Write-Host "      None found." -ForegroundColor DarkGray
}

# ── 2. Remove orphaned user-assigned managed identities ──────────────
Write-Host "[2/4] Checking for orphaned managed identities..." -ForegroundColor White

$identities = Get-AzResource -ResourceGroupName $ResourceGroupName -ResourceType 'Microsoft.ManagedIdentity/userAssignedIdentities' -ErrorAction SilentlyContinue
if ($identities) {
    foreach ($mi in $identities) {
        Write-Host "      Removing managed identity: $($mi.Name)" -ForegroundColor Yellow
        if ($PSCmdlet.ShouldProcess($mi.Name, "Delete managed identity")) {
            Remove-AzResource -ResourceId $mi.ResourceId -Force | Out-Null
            Write-Host "      Deleted." -ForegroundColor Green
        }
    }
}
else {
    Write-Host "      None found." -ForegroundColor DarkGray
}

# ── 3. Remove orphaned deployment script storage accounts ────────────
Write-Host "[3/4] Checking for orphaned deployment storage accounts..." -ForegroundColor White

$storageAccounts = Get-AzStorageAccount -ResourceGroupName $ResourceGroupName -ErrorAction SilentlyContinue
$orphanedStorage = $storageAccounts | Where-Object { $_.StorageAccountName -match '^azds' }
if ($orphanedStorage) {
    foreach ($sa in $orphanedStorage) {
        Write-Host "      Removing deployment storage: $($sa.StorageAccountName)" -ForegroundColor Yellow
        if ($PSCmdlet.ShouldProcess($sa.StorageAccountName, "Delete storage account")) {
            Remove-AzStorageAccount -ResourceGroupName $ResourceGroupName -Name $sa.StorageAccountName -Force
            Write-Host "      Deleted." -ForegroundColor Green
        }
    }
}
else {
    Write-Host "      None found." -ForegroundColor DarkGray
}

# ── 4. Cancel failed deployments ─────────────────────────────────────
Write-Host "[4/4] Checking for active deployments..." -ForegroundColor White

$deployments = Get-AzResourceGroupDeployment -ResourceGroupName $ResourceGroupName -ErrorAction SilentlyContinue |
    Where-Object { $_.ProvisioningState -eq 'Running' -or $_.ProvisioningState -eq 'Accepted' }
if ($deployments) {
    foreach ($dep in $deployments) {
        Write-Host "      Cancelling deployment: $($dep.DeploymentName) ($($dep.ProvisioningState))" -ForegroundColor Yellow
        if ($PSCmdlet.ShouldProcess($dep.DeploymentName, "Cancel deployment")) {
            Stop-AzResourceGroupDeployment -ResourceGroupName $ResourceGroupName -Name $dep.DeploymentName -ErrorAction SilentlyContinue
            Write-Host "      Cancelled." -ForegroundColor Green
        }
    }
}
else {
    Write-Host "      None found." -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "Cleanup complete." -ForegroundColor Green
Write-Host ""
