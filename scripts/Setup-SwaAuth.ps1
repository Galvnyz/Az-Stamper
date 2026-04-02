<#
.SYNOPSIS
    Bootstraps the Az-Stamper SWA config UI after deployment.

.DESCRIPTION
    Creates an Entra ID app registration for MSAL authentication,
    generates the app-config.js file, and deploys the SWA content.
    Safe to run multiple times (idempotent).

.PARAMETER ResourceGroupName
    Resource group containing the Az-Stamper hub. Defaults to 'rg-az-stamper'.

.PARAMETER FunctionAppName
    Name of the Az-Stamper function app. The SWA name is derived as
    '{FunctionAppName}-config'. If omitted, the script auto-discovers
    the function app from the resource group.

.PARAMETER AppDisplayName
    Display name for the Entra ID app registration.
    Defaults to 'Az-Stamper-SWA'.

.EXAMPLE
    ./Setup-SwaAuth.ps1

.EXAMPLE
    ./Setup-SwaAuth.ps1 -ResourceGroupName 'rg-az-stamper-dev' -FunctionAppName 'func-azstamper-dev'
#>
[CmdletBinding()]
param(
    [Parameter()]
    [string]$ResourceGroupName = 'rg-az-stamper',

    [Parameter()]
    [string]$FunctionAppName,

    [Parameter()]
    [string]$AppDisplayName = 'Az-Stamper-SWA'
)

$ErrorActionPreference = 'Stop'

# Auto-discover function app if not specified
if (-not $FunctionAppName) {
    $funcApps = Get-AzWebApp -ResourceGroupName $ResourceGroupName -ErrorAction Stop |
        Where-Object { $_.Kind -match 'functionapp' }
    if ($funcApps.Count -eq 0) {
        Write-Error "No function app found in resource group '$ResourceGroupName'. Specify -FunctionAppName explicitly."
        return
    }
    if ($funcApps.Count -gt 1) {
        Write-Error "Multiple function apps found in '$ResourceGroupName': $($funcApps.Name -join ', '). Specify -FunctionAppName explicitly."
        return
    }
    $FunctionAppName = $funcApps[0].Name
    Write-Host "Auto-discovered function app: $FunctionAppName" -ForegroundColor DarkGray
}

$swaName = "$FunctionAppName-config"

Write-Host ""
Write-Host "Az-Stamper SWA Config UI Setup" -ForegroundColor Cyan
Write-Host "==============================" -ForegroundColor Cyan
Write-Host ""

# Prerequisites check
$context = Get-AzContext
if (-not $context) {
    Write-Error "Not connected to Azure. Run 'Connect-AzAccount' first."
    return
}
Write-Host "Azure context: $($context.Account.Id) ($($context.Subscription.Name))" -ForegroundColor DarkGray

if (-not (Get-Command npx -ErrorAction SilentlyContinue)) {
    Write-Error "npx not found. Install Node.js from https://nodejs.org/"
    return
}

# ── Step 1/4: Discover resources ─────────────────────────────────────
Write-Host "[1/4] Discovering resources in $ResourceGroupName..." -ForegroundColor White

$swa = Get-AzStaticWebApp -ResourceGroupName $ResourceGroupName -Name $swaName -ErrorAction Stop
$swaHostname = $swa.DefaultHostname
Write-Host "      SWA: $swaHostname" -ForegroundColor DarkGray

$storageAccounts = Get-AzStorageAccount -ResourceGroupName $ResourceGroupName -ErrorAction Stop
$storageAccountName = $storageAccounts[0].StorageAccountName
Write-Host "      Storage: $storageAccountName" -ForegroundColor DarkGray

$appInsights = Get-AzApplicationInsights -ResourceGroupName $ResourceGroupName -ErrorAction Stop
$appInsightsId = $appInsights[0].Id
Write-Host "      App Insights: $($appInsights[0].Name)" -ForegroundColor DarkGray

$functionApp = Get-AzWebApp -ResourceGroupName $ResourceGroupName -Name $FunctionAppName -ErrorAction Stop
$functionAppId = $functionApp.Id
Write-Host "      Function App: $FunctionAppName" -ForegroundColor DarkGray

$deploymentToken = az staticwebapp secrets list --name $swaName --query "properties.apiKey" -o tsv 2>$null
if (-not $deploymentToken) {
    Write-Error "Failed to retrieve SWA deployment token. Ensure Azure CLI is installed and logged in."
    return
}

# Configure CORS on storage account so the SWA can read/write config blobs
az storage cors add --services b --methods GET PUT OPTIONS --origins "https://$swaHostname" --allowed-headers "*" --exposed-headers "*" --max-age 3600 --account-name $storageAccountName 2>$null
Write-Host "      Storage CORS: configured for https://$swaHostname" -ForegroundColor DarkGray
Write-Host ""

# ── Step 2/4: Entra ID app registration ──────────────────────────────
Write-Host "[2/4] Configuring Entra ID app registration..." -ForegroundColor White

$redirectUri = "https://$swaHostname"
$tenantId = $context.Tenant.Id

$existingApp = Get-AzADApplication -DisplayName $AppDisplayName -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -eq $AppDisplayName } |
    Select-Object -First 1

if ($existingApp) {
    Write-Host "      Found existing app: $($existingApp.AppId)" -ForegroundColor DarkGray

    # Update SPA redirect URI if needed
    $currentUris = $existingApp.Spa.RedirectUri
    if ($currentUris -notcontains $redirectUri) {
        $updatedUris = @($redirectUri)
        Update-AzADApplication -ObjectId $existingApp.Id -SPARedirectUri $updatedUris
        Write-Host "      Updated redirect URI to $redirectUri" -ForegroundColor DarkGray
    }

    $clientId = $existingApp.AppId
}
else {
    Write-Host "      Creating new app registration..." -ForegroundColor DarkGray
    $newApp = New-AzADApplication -DisplayName $AppDisplayName -SPARedirectUri @($redirectUri)
    $clientId = $newApp.AppId
    Write-Host "      Created: $clientId" -ForegroundColor DarkGray
}

# Ensure delegated API permissions are configured
$appObjectId = if ($existingApp) { $existingApp.Id } else { $newApp.Id }
$requiredAccess = @(
    @{
        ResourceAppId  = '797f4846-ba00-4fd7-ba43-dac1f8f63013'
        ResourceAccess = @(@{ Id = '41094075-9dad-400e-a0bd-54e686782033'; Type = 'Scope' })
    },
    @{
        ResourceAppId  = 'e406a681-f3d4-42a8-90b6-c2b029497af1'
        ResourceAccess = @(@{ Id = '03e0da56-190b-40ad-a80c-ea378c433f7f'; Type = 'Scope' })
    }
)
Update-AzADApplication -ObjectId $appObjectId -RequiredResourceAccess $requiredAccess

Write-Host "      App: $AppDisplayName (client ID: $clientId)" -ForegroundColor DarkGray

# Assign Storage Blob Data Contributor to current user (needed for config read/write)
$userId = $context.Account.Id
$storageScope = "/subscriptions/$($context.Subscription.Id)/resourceGroups/$ResourceGroupName/providers/Microsoft.Storage/storageAccounts/$storageAccountName"
$blobContributorRole = 'Storage Blob Data Contributor'
$existingAssignment = Get-AzRoleAssignment -SignInName $userId -RoleDefinitionName $blobContributorRole -Scope $storageScope -ErrorAction SilentlyContinue
if (-not $existingAssignment) {
    New-AzRoleAssignment -SignInName $userId -RoleDefinitionName $blobContributorRole -Scope $storageScope -ErrorAction Stop | Out-Null
    Write-Host "      Assigned $blobContributorRole to $userId" -ForegroundColor DarkGray
}
Write-Host ""

# ── Step 3/4: Generate app-config.js ─────────────────────────────────
Write-Host "[3/4] Generating app-config.js..." -ForegroundColor White

$configContent = @"
// Auto-generated by Setup-SwaAuth.ps1 — do not commit (gitignored)
window.AZ_STAMPER_CONFIG = {
  clientId: '$clientId',
  tenantId: '$tenantId',
  configBlobUrl: 'https://$storageAccountName.blob.core.windows.net/config/stamper.json',
  appInsightsId: '$appInsightsId',
  functionAppId: '$functionAppId'
};
"@

$scriptDir = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $scriptDir 'swa' 'js' 'app-config.js'

# Handle running from repo root or scripts/ directory
if (-not (Test-Path (Join-Path $scriptDir 'swa'))) {
    $configPath = Join-Path (Get-Location) 'swa' 'js' 'app-config.js'
}

Set-Content -Path $configPath -Value $configContent -Encoding UTF8
Write-Host "      Written to $configPath" -ForegroundColor DarkGray
Write-Host ""

# ── Step 4/4: Deploy SWA content ─────────────────────────────────────
Write-Host "[4/4] Deploying SWA content..." -ForegroundColor White

$swaDir = Split-Path -Parent $configPath | Split-Path -Parent
$env:SWA_CLI_DEPLOYMENT_TOKEN = $deploymentToken
npx --yes @azure/static-web-apps-cli deploy $swaDir --env production
$env:SWA_CLI_DEPLOYMENT_TOKEN = $null

Write-Host ""
Write-Host "Setup complete!" -ForegroundColor Green
Write-Host "SWA Config UI: https://$swaHostname" -ForegroundColor Cyan
Write-Host "App Registration: $AppDisplayName (client ID: $clientId)" -ForegroundColor Cyan
Write-Host ""
