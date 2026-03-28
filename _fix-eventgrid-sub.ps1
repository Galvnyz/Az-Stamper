$ErrorActionPreference = 'Stop'

$rgName = "rg-az-stamper-dev"
$funcName = "func-az-stamper-dev"
$topicName = "evgt-az-stamper"
$subName = "evgs-az-stamper"
$subId = (Get-AzContext).Subscription.Id

# Delete existing broken subscription
Write-Host "Removing existing event subscription..." -ForegroundColor Cyan
$deletePath = "/subscriptions/$subId/resourceGroups/$rgName/providers/Microsoft.EventGrid/systemTopics/$topicName/eventSubscriptions/${subName}?api-version=2024-06-01-preview"
Invoke-AzRestMethod -Path $deletePath -Method DELETE | Out-Null
Start-Sleep -Seconds 5

# Build the function endpoint resource ID
$funcResourceId = "/subscriptions/$subId/resourceGroups/$rgName/providers/Microsoft.Web/sites/$funcName/functions/ResourceStamper"

Write-Host "Creating event subscription with AzureFunction endpoint..." -ForegroundColor Cyan
Write-Host "  Function endpoint: $funcResourceId" -ForegroundColor Gray

$body = @{
    properties = @{
        destination = @{
            endpointType = "AzureFunction"
            properties = @{
                resourceId = $funcResourceId
            }
        }
        filter = @{
            includedEventTypes = @(
                "Microsoft.Resources.ResourceWriteSuccess"
            )
            advancedFilters = @(
                @{
                    operatorType = "StringNotContains"
                    key = "data.operationName"
                    values = @("Microsoft.Resources/deployments")
                }
            )
        }
    }
} | ConvertTo-Json -Depth 10

$createPath = "/subscriptions/$subId/resourceGroups/$rgName/providers/Microsoft.EventGrid/systemTopics/$topicName/eventSubscriptions/${subName}?api-version=2024-06-01-preview"
$result = Invoke-AzRestMethod -Path $createPath -Method PUT -Payload $body

if ($result.StatusCode -ge 200 -and $result.StatusCode -lt 300) {
    $content = $result.Content | ConvertFrom-Json
    Write-Host "Event subscription created." -ForegroundColor Green
    Write-Host "  State: $($content.properties.provisioningState)" -ForegroundColor White
    Write-Host "  Endpoint Type: $($content.properties.destination.endpointType)" -ForegroundColor White
} else {
    Write-Host "Failed ($($result.StatusCode)):" -ForegroundColor Red
    Write-Host $result.Content
}
