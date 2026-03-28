$ErrorActionPreference = 'Stop'

$rgName = "rg-az-stamper-dev"
$location = "eastus"
$spId = "c9bd3326-d298-4cb0-9bf0-664aa7ec5c66"  # Az-Stamper-Deploy SP Object ID

# Step 1: Create resource group
Write-Host "Creating resource group '$rgName' in '$location'..." -ForegroundColor Cyan
New-AzResourceGroup -Name $rgName -Location $location -Force | Out-Null
Write-Host "  Resource group created." -ForegroundColor Green

# Step 2: Assign Contributor on RG (deploy Bicep resources)
Write-Host "Assigning Contributor role on resource group..." -ForegroundColor Cyan
$existing = Get-AzRoleAssignment -ObjectId $spId -RoleDefinitionName "Contributor" -ResourceGroupName $rgName -ErrorAction SilentlyContinue
if (-not $existing) {
    New-AzRoleAssignment -ObjectId $spId -RoleDefinitionName "Contributor" -ResourceGroupName $rgName | Out-Null
    Write-Host "  Contributor assigned." -ForegroundColor Green
} else {
    Write-Host "  Contributor already assigned — skipping." -ForegroundColor Yellow
}

# Step 3: Assign User Access Administrator on RG (assign RBAC roles to function MI)
Write-Host "Assigning User Access Administrator role on resource group..." -ForegroundColor Cyan
$existing = Get-AzRoleAssignment -ObjectId $spId -RoleDefinitionName "User Access Administrator" -ResourceGroupName $rgName -ErrorAction SilentlyContinue
if (-not $existing) {
    New-AzRoleAssignment -ObjectId $spId -RoleDefinitionName "User Access Administrator" -ResourceGroupName $rgName | Out-Null
    Write-Host "  User Access Administrator assigned." -ForegroundColor Green
} else {
    Write-Host "  User Access Administrator already assigned — skipping." -ForegroundColor Yellow
}

# Step 4: Assign Contributor at subscription scope (for subscription-scoped Bicep deployments + Event Grid)
Write-Host "Assigning Contributor role at subscription scope..." -ForegroundColor Cyan
$subScope = "/subscriptions/$((Get-AzContext).Subscription.Id)"
$existing = Get-AzRoleAssignment -ObjectId $spId -RoleDefinitionName "Contributor" -Scope $subScope -ErrorAction SilentlyContinue
if (-not $existing) {
    New-AzRoleAssignment -ObjectId $spId -RoleDefinitionName "Contributor" -Scope $subScope | Out-Null
    Write-Host "  Subscription Contributor assigned." -ForegroundColor Green
} else {
    Write-Host "  Subscription Contributor already assigned — skipping." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Resource group and RBAC setup complete." -ForegroundColor Green
