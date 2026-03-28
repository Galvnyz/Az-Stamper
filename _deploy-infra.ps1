$ErrorActionPreference = 'Stop'

# Add Bicep to PATH for this session
$bicepPath = "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Microsoft.Bicep_Microsoft.Winget.Source_8wekyb3d8bbwe"
if (Test-Path $bicepPath) {
    $env:PATH = "$bicepPath;$env:PATH"
}

$rgName = "rg-az-stamper-dev"

Write-Host "Deploying Az-Stamper infrastructure to '$rgName'..." -ForegroundColor Cyan

$deployment = New-AzResourceGroupDeployment `
    -ResourceGroupName $rgName `
    -TemplateFile "$PSScriptRoot/infra/main.bicep" `
    -TemplateParameterFile "$PSScriptRoot/infra/parameters/dev.bicepparam" `
    -Verbose

Write-Host ""
Write-Host "=== DEPLOYMENT OUTPUTS ===" -ForegroundColor Yellow
Write-Host "Function App Name: $($deployment.Outputs.functionAppName.Value)" -ForegroundColor White
Write-Host "Function App ID:   $($deployment.Outputs.functionAppId.Value)" -ForegroundColor White
Write-Host "Principal ID (MI): $($deployment.Outputs.principalId.Value)" -ForegroundColor White
Write-Host ""
Write-Host "Infrastructure deployment complete." -ForegroundColor Green
