$ErrorActionPreference = 'Stop'

$rgName = "rg-az-stamper-dev"
$funcName = "func-az-stamper-dev"
$publishDir = "$PSScriptRoot/publish"
$zipPath = "$PSScriptRoot/deploy.zip"

# Package
Write-Host "Packaging function code..." -ForegroundColor Cyan
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Compress-Archive -Path "$publishDir/*" -DestinationPath $zipPath -Force

# Deploy
Write-Host "Deploying to '$funcName'..." -ForegroundColor Cyan
Publish-AzWebApp -ResourceGroupName $rgName -Name $funcName -ArchivePath $zipPath -Force

# Cleanup
Remove-Item $zipPath -Force

Write-Host "Function code deployed successfully." -ForegroundColor Green
