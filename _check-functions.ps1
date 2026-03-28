$ErrorActionPreference = 'Stop'

$rgName = "rg-az-stamper-dev"
$funcName = "func-az-stamper-dev"
$subId = (Get-AzContext).Subscription.Id

# Check functions
$result = Invoke-AzRestMethod -Path "/subscriptions/$subId/resourceGroups/$rgName/providers/Microsoft.Web/sites/$funcName/functions?api-version=2023-12-01" -Method GET
$functions = ($result.Content | ConvertFrom-Json).value

if ($functions.Count -gt 0) {
    Write-Host "Functions detected:" -ForegroundColor Green
    $functions | ForEach-Object { Write-Host "  - $($_.properties.name)" -ForegroundColor White }
}
else {
    Write-Host "No functions detected. Restarting function app..." -ForegroundColor Yellow
    Restart-AzWebApp -ResourceGroupName $rgName -Name $funcName
    Write-Host "Restarted. Waiting 30 seconds..." -ForegroundColor Yellow
    Start-Sleep -Seconds 30

    $result = Invoke-AzRestMethod -Path "/subscriptions/$subId/resourceGroups/$rgName/providers/Microsoft.Web/sites/$funcName/functions?api-version=2023-12-01" -Method GET
    $functions = ($result.Content | ConvertFrom-Json).value
    if ($functions.Count -gt 0) {
        Write-Host "Functions detected after restart:" -ForegroundColor Green
        $functions | ForEach-Object { Write-Host "  - $($_.properties.name)" -ForegroundColor White }
    }
    else {
        Write-Host "Still no functions. Checking function app logs..." -ForegroundColor Red
        # Check if the host.json is in the right place
        $kuduUri = "https://$funcName.scm.azurewebsites.net/api/vfs/site/wwwroot/"
        try {
            $token = (Get-AzAccessToken -ResourceUrl "https://management.azure.com").Token
            $kuduHeaders = @{ Authorization = "Bearer $token" }
            $files = Invoke-RestMethod -Uri $kuduUri -Headers $kuduHeaders -Method GET
            Write-Host "Files in wwwroot:" -ForegroundColor Cyan
            $files | ForEach-Object { Write-Host "  $($_.name)" }
        }
        catch {
            Write-Host "Could not access Kudu. Check the function app in the portal." -ForegroundColor Yellow
        }
    }
}
