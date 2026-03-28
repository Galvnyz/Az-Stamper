$ErrorActionPreference = 'Stop'

# Add Bicep to PATH
$bicepPath = "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Microsoft.Bicep_Microsoft.Winget.Source_8wekyb3d8bbwe"
if (Test-Path $bicepPath) { $env:PATH = "$bicepPath;$env:PATH" }

$subId = (Get-AzContext).Subscription.Id
$funcAppId = "/subscriptions/$subId/resourceGroups/rg-az-stamper-dev/providers/Microsoft.Web/sites/func-az-stamper-dev"
$principalId = "7a7a5273-dbc2-4fdb-9523-8230eebe8895"

Write-Host "Deploying Event Grid subscription and RBAC (subscription-scoped)..." -ForegroundColor Cyan

New-AzSubscriptionDeployment `
    -Location "eastus" `
    -TemplateFile "$PSScriptRoot/infra/main.sub.bicep" `
    -functionAppId $funcAppId `
    -functionAppPrincipalId $principalId `
    -resourceGroupName "rg-az-stamper-dev" `
    -Verbose

Write-Host ""
Write-Host "Event Grid subscription and RBAC deployed." -ForegroundColor Green
