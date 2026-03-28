$subId = "2f2d900c-03a4-4763-8138-bed4d299a7fa"
$rg = "rg-az-stamper-dev"

$resources = @("stazstampertest000", "stazstampertest001", "stazstamperdev")
foreach ($name in $resources) {
    Write-Host "Tags on ${name}:" -ForegroundColor Cyan
    $rid = "/subscriptions/$subId/resourceGroups/$rg/providers/Microsoft.Storage/storageAccounts/$name"
    $tags = (Get-AzTag -ResourceId $rid).Properties.TagsProperty
    if ($tags -and $tags.Count -gt 0) {
        $tags.GetEnumerator() | ForEach-Object { Write-Host "  $($_.Key) = $($_.Value)" }
    } else {
        Write-Host "  (none)"
    }
    Write-Host ""
}
