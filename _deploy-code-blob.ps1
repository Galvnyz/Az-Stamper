$ErrorActionPreference = 'Stop'

$rgName = "rg-az-stamper-dev"
$funcName = "func-az-stamper-dev"
$storageAccountName = "stazstamperdev"
$containerName = "deployments"
$publishDir = "$PSScriptRoot/publish"
$zipPath = "$PSScriptRoot/deploy.zip"

# Package
Write-Host "Packaging function code..." -ForegroundColor Cyan
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Compress-Archive -Path "$publishDir/*" -DestinationPath $zipPath -Force

# Upload to blob storage deployment container
Write-Host "Uploading to deployment container..." -ForegroundColor Cyan
$ctx = New-AzStorageContext -StorageAccountName $storageAccountName -UseConnectedAccount
$blobName = "deploy-$(Get-Date -Format 'yyyyMMddHHmmss').zip"
Set-AzStorageBlobContent -File $zipPath -Container $containerName -Blob $blobName -Context $ctx -Force | Out-Null

$blobUrl = "https://$storageAccountName.blob.core.windows.net/$containerName/$blobName"
Write-Host "Blob URL: $blobUrl" -ForegroundColor Gray

# Update the function app to point to this deployment
Write-Host "Updating function app deployment source..." -ForegroundColor Cyan
$funcApp = Get-AzWebApp -ResourceGroupName $rgName -Name $funcName
$funcApp.SiteConfig.AppSettings += @{
    Name = "WEBSITE_RUN_FROM_PACKAGE_BLOB_MI_RESOURCE_ID"
    Value = ""
}

# Use REST API to trigger deployment from blob
$token = (Get-AzAccessToken -ResourceUrl "https://management.azure.com").Token
$headers = @{ Authorization = "Bearer $token"; "Content-Type" = "application/json" }
$deployUri = "https://management.azure.com/subscriptions/$((Get-AzContext).Subscription.Id)/resourceGroups/$rgName/providers/Microsoft.Web/sites/$funcName/extensions/onedeploy?api-version=2024-04-01"

$body = @{
    properties = @{
        packageUri = $blobUrl
        type = "zip"
        path = ""
        restart = $true
        cleanDeployment = $true
    }
} | ConvertTo-Json -Depth 5

try {
    $response = Invoke-RestMethod -Uri $deployUri -Method PUT -Headers $headers -Body $body
    Write-Host "Deployment triggered: $($response.properties.provisioningState)" -ForegroundColor Green
}
catch {
    Write-Host "OneDeploy API failed, trying Publish-AzWebApp as fallback..." -ForegroundColor Yellow
    # Fallback: standard ZIP deploy
    Publish-AzWebApp -ResourceGroupName $rgName -Name $funcName -ArchivePath $zipPath -Force
}

# Cleanup
Remove-Item $zipPath -Force

Write-Host ""
Write-Host "Waiting 30 seconds for function host to detect functions..." -ForegroundColor Yellow
Start-Sleep -Seconds 30

# Verify functions are detected
$result = Invoke-AzRestMethod -Path "/subscriptions/$((Get-AzContext).Subscription.Id)/resourceGroups/$rgName/providers/Microsoft.Web/sites/$funcName/functions?api-version=2023-12-01" -Method GET
$functions = ($result.Content | ConvertFrom-Json).value
if ($functions.Count -gt 0) {
    Write-Host "Functions detected: $($functions | ForEach-Object { $_.properties.name }) " -ForegroundColor Green
}
else {
    Write-Host "No functions detected yet. The function host may need more time to sync." -ForegroundColor Yellow
}
