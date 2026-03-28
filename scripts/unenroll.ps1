<#
.SYNOPSIS
    Removes Az-Stamper enrollment from a subscription.

.DESCRIPTION
    Deletes the Event Grid system topic and RBAC role assignments
    created by the Az-Stamper enrollment template (enroll.bicep).

.PARAMETER SubscriptionId
    The Azure subscription ID to unenroll.

.PARAMETER FunctionAppPrincipalId
    The managed identity principal ID of the Az-Stamper function app.

.PARAMETER SystemTopicName
    Name of the Event Grid system topic. Defaults to 'evgt-az-stamper'.

.PARAMETER ResourceGroupName
    Resource group containing the Event Grid system topic.

.PARAMETER WhatIf
    Show what would be removed without making changes.

.EXAMPLE
    ./unenroll.ps1 -SubscriptionId "00000000-0000-0000-0000-000000000000" `
                   -FunctionAppPrincipalId "11111111-1111-1111-1111-111111111111" `
                   -ResourceGroupName "rg-eventgrid"
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory)]
    [ValidatePattern('^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$')]
    [string]$SubscriptionId,

    [Parameter(Mandatory)]
    [ValidateNotNullOrEmpty()]
    [string]$FunctionAppPrincipalId,

    [Parameter(Mandatory)]
    [ValidateNotNullOrEmpty()]
    [string]$ResourceGroupName,

    [Parameter()]
    [string]$SystemTopicName = 'evgt-az-stamper'
)

$ErrorActionPreference = 'Stop'

Write-Host "Az-Stamper Unenrollment" -ForegroundColor Cyan
Write-Host "Subscription: $SubscriptionId"
Write-Host "System Topic: $SystemTopicName"
Write-Host "Resource Group: $ResourceGroupName"
Write-Host ""

# Set subscription context
az account set --subscription $SubscriptionId
if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to set subscription context. Ensure you are logged in with 'az login'."
    return
}

# Delete Event Grid system topic (cascades to event subscription)
Write-Host "Removing Event Grid system topic '$SystemTopicName'..." -ForegroundColor Yellow
if ($PSCmdlet.ShouldProcess("System topic '$SystemTopicName' in resource group '$ResourceGroupName'", "Delete")) {
    az eventgrid system-topic delete `
        --name $SystemTopicName `
        --resource-group $ResourceGroupName `
        --yes 2>$null

    if ($LASTEXITCODE -eq 0) {
        Write-Host "  Deleted system topic." -ForegroundColor Green
    }
    else {
        Write-Warning "  System topic not found or already deleted."
    }
}

# Remove RBAC role assignments
$scope = "/subscriptions/$SubscriptionId"
$roleIds = @(
    'acdd72a7-3385-48ef-bd42-f606fba81ae7'  # Reader
    '4a9ae827-6dc8-4573-8ac7-8239d42aa03f'  # Tag Contributor
)

foreach ($roleId in $roleIds) {
    $roleName = if ($roleId -eq 'acdd72a7-3385-48ef-bd42-f606fba81ae7') { 'Reader' } else { 'Tag Contributor' }
    Write-Host "Removing '$roleName' role assignment..." -ForegroundColor Yellow

    if ($PSCmdlet.ShouldProcess("$roleName role for principal $FunctionAppPrincipalId on $scope", "Delete")) {
        az role assignment delete `
            --assignee $FunctionAppPrincipalId `
            --role $roleId `
            --scope $scope 2>$null

        if ($LASTEXITCODE -eq 0) {
            Write-Host "  Removed $roleName role." -ForegroundColor Green
        }
        else {
            Write-Warning "  $roleName role assignment not found or already removed."
        }
    }
}

Write-Host ""
Write-Host "Unenrollment complete." -ForegroundColor Green
