$ErrorActionPreference = 'Stop'

# Step 1: Create the app registration
Write-Host "Creating app registration 'Az-Stamper-Deploy'..." -ForegroundColor Cyan
$app = New-AzADApplication -DisplayName "Az-Stamper-Deploy"
Write-Host "  App ID (Client ID): $($app.AppId)" -ForegroundColor Green
Write-Host "  Object ID:          $($app.Id)" -ForegroundColor Gray

# Step 2: Create a service principal for the app
Write-Host "Creating service principal..." -ForegroundColor Cyan
$sp = New-AzADServicePrincipal -ApplicationId $app.AppId
Write-Host "  SP Object ID: $($sp.Id)" -ForegroundColor Green

# Step 3: Add federated credential for GitHub Actions 'dev' environment
Write-Host "Adding federated credential for GitHub Actions (dev environment)..." -ForegroundColor Cyan
$credParams = @{
    Name      = "github-actions-dev"
    Issuer    = "https://token.actions.githubusercontent.com"
    Subject   = "repo:Galvnyz/Az-Stamper:environment:dev"
    Audience  = @("api://AzureADTokenExchange")
}

New-AzADAppFederatedCredential -ApplicationObjectId $app.Id @credParams

# Step 4: Get tenant ID
$tenantId = (Get-AzContext).Tenant.Id

# Summary
Write-Host ""
Write-Host "=== SAVE THESE VALUES FOR GITHUB SECRETS ===" -ForegroundColor Yellow
Write-Host "AZURE_CLIENT_ID:       $($app.AppId)" -ForegroundColor White
Write-Host "AZURE_TENANT_ID:       $tenantId" -ForegroundColor White
Write-Host "AZURE_SUBSCRIPTION_ID: $((Get-AzContext).Subscription.Id)" -ForegroundColor White
Write-Host ""
Write-Host "App registration and federated credential created successfully." -ForegroundColor Green
