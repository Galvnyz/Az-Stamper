targetScope = 'resourceGroup'

param location string = resourceGroup().location
param storageAccountName string
param functionAppName string
param appInsightsName string
param logAnalyticsName string = '${functionAppName}-law'
param environment string = 'dev'
param tags object = {
  Project: 'Az-Stamper'
  ManagedBy: 'Bicep'
  Environment: environment
}
param stamperConfigJson string = '{"TagMap":{"Creator":{"Value":"{caller}","Overwrite":false},"CreatedOn":{"Value":"{timestamp}","Overwrite":false},"LastModifiedBy":{"Value":"{caller}","Overwrite":true},"LastModifiedOn":{"Value":"{timestamp}","Overwrite":true},"StampedBy":{"Value":"Az-Stamper","Overwrite":false}},"IgnorePatterns":["Microsoft.Resources/deployments","Microsoft.Resources/tags","Microsoft.Network/frontdoor"]}'

module monitoring 'modules/monitoring.bicep' = {
  name: 'monitoring'
  params: {
    logAnalyticsName: logAnalyticsName
    appInsightsName: appInsightsName
    location: location
    tags: tags
  }
}

module functionApp 'modules/functionApp.bicep' = {
  name: 'functionApp'
  params: {
    name: functionAppName
    location: location
    tags: tags
    storageAccountName: storageAccountName
    appInsightsConnectionString: monitoring.outputs.appInsightsConnectionString
    stamperConfigJson: stamperConfigJson
  }
}

module storage 'modules/storage.bicep' = {
  name: 'storage'
  params: {
    name: storageAccountName
    location: location
    tags: tags
    functionAppPrincipalId: functionApp.outputs.principalId
  }
}

output functionAppName string = functionApp.outputs.functionAppName
output functionAppId string = functionApp.outputs.functionAppId
output principalId string = functionApp.outputs.principalId
