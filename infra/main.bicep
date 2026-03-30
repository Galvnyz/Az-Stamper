targetScope = 'resourceGroup'

param location string = resourceGroup().location
param storageAccountName string
param functionAppName string
param appInsightsName string
param logAnalyticsName string = '${functionAppName}-law'
param environment string = 'dev'
param swaName string = '${functionAppName}-config'
param workbookName string = 'Az-Stamper Activity Dashboard'

param tags object = {
  Project: 'Az-Stamper'
  ManagedBy: 'Bicep'
  Environment: environment
}
// StamperConfig is defined as individual __ delimited app settings in functionApp.bicep

// Deploy storage first (no MI dependency)
module storage 'modules/storage.bicep' = {
  name: 'storage'
  params: {
    name: storageAccountName
    location: location
    tags: tags
  }
}

module monitoring 'modules/monitoring.bicep' = {
  name: 'monitoring'
  params: {
    logAnalyticsName: logAnalyticsName
    appInsightsName: appInsightsName
    location: location
    tags: tags
  }
}

// Function app depends on storage (needs blob endpoint) and monitoring
module functionApp 'modules/functionApp.bicep' = {
  name: 'functionApp'
  params: {
    name: functionAppName
    location: location
    tags: tags
    storageAccountName: storageAccountName
    storageBlobEndpoint: storage.outputs.primaryBlobEndpoint
    deploymentContainerName: storage.outputs.deploymentContainerName
    appInsightsConnectionString: monitoring.outputs.appInsightsConnectionString
  }
}

// Storage RBAC — assigned after function app exists (needs principalId)
resource blobDataOwnerRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storageAccountName, functionAppName, 'b7e6dc6d-f1e8-4753-8033-0f276bb0955b')
  scope: storageAccountRef
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'b7e6dc6d-f1e8-4753-8033-0f276bb0955b')
    principalId: functionApp.outputs.principalId
    principalType: 'ServicePrincipal'
  }
}

resource storageContributorRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storageAccountName, functionAppName, '17d1049b-9a84-46fb-8f53-869881c3d3ab')
  scope: storageAccountRef
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '17d1049b-9a84-46fb-8f53-869881c3d3ab')
    principalId: functionApp.outputs.principalId
    principalType: 'ServicePrincipal'
  }
}

// Reference the storage account for RBAC scoping
resource storageAccountRef 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: storageAccountName
}


// Azure Workbook for tag monitoring dashboard
module workbook 'modules/workbook.bicep' = {
  name: 'workbook'
  params: {
    name: workbookName
    location: location
    tags: tags
    appInsightsId: monitoring.outputs.appInsightsId
  }
}

// Static Web App for config management UI
module swa 'modules/swa.bicep' = {
  name: 'swa'
  params: {
    name: swaName
    location: location
    tags: tags
  }
}

output functionAppName string = functionApp.outputs.functionAppName
output functionAppId string = functionApp.outputs.functionAppId
output principalId string = functionApp.outputs.principalId
output swaHostname string = swa.outputs.defaultHostname
output appInsightsId string = monitoring.outputs.appInsightsId
output storageAccountName string = storage.outputs.storageAccountName
output swaName string = swa.outputs.staticWebAppName
