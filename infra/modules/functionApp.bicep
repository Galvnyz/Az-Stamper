param name string
param location string
param tags object
param storageAccountName string
param appInsightsConnectionString string
@description('URL of the function app deployment package. Used by Deploy-to-Azure button.')
param packageUrl string = ''
// StamperConfig uses __ delimited app settings for IOptions<T> binding

resource consumptionPlan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: '${name}-plan'
  location: location
  tags: tags
  kind: 'linux'
  sku: {
    name: 'Y1'
    tier: 'Dynamic'
  }
  properties: {
    reserved: true
  }
}

resource functionApp 'Microsoft.Web/sites@2024-04-01' = {
  name: name
  location: location
  tags: tags
  kind: 'functionapp,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: consumptionPlan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'DOTNET-ISOLATED|8.0'
      minTlsVersion: '1.2'
      appSettings: concat([
        {
          name: 'FUNCTIONS_EXTENSION_VERSION'
          value: '~4'
        }
        {
          name: 'FUNCTIONS_WORKER_RUNTIME'
          value: 'dotnet-isolated'
        }
        {
          name: 'AzureWebJobsStorage__blobServiceUri'
          value: 'https://${storageAccountName}.blob.${environment().suffixes.storage}'
        }
        {
          name: 'AzureWebJobsStorage__queueServiceUri'
          value: 'https://${storageAccountName}.queue.${environment().suffixes.storage}'
        }
        {
          name: 'AzureWebJobsStorage__tableServiceUri'
          value: 'https://${storageAccountName}.table.${environment().suffixes.storage}'
        }
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: appInsightsConnectionString
        }
        {
          name: 'StamperConfig__TagMap__Creator__Value'
          value: '{caller}'
        }
        {
          name: 'StamperConfig__TagMap__Creator__Overwrite'
          value: 'false'
        }
        {
          name: 'StamperConfig__TagMap__CreatedOn__Value'
          value: '{timestamp}'
        }
        {
          name: 'StamperConfig__TagMap__CreatedOn__Overwrite'
          value: 'false'
        }
        {
          name: 'StamperConfig__TagMap__LastModifiedBy__Value'
          value: '{caller}'
        }
        {
          name: 'StamperConfig__TagMap__LastModifiedBy__Overwrite'
          value: 'true'
        }
        {
          name: 'StamperConfig__TagMap__LastModifiedOn__Value'
          value: '{timestamp}'
        }
        {
          name: 'StamperConfig__TagMap__LastModifiedOn__Overwrite'
          value: 'true'
        }
        {
          name: 'StamperConfig__TagMap__StampedBy__Value'
          value: 'Az-Stamper'
        }
        {
          name: 'StamperConfig__TagMap__StampedBy__Overwrite'
          value: 'false'
        }
        {
          name: 'StamperConfig__IgnorePatterns__0'
          value: 'Microsoft.Resources/deployments'
        }
        {
          name: 'StamperConfig__IgnorePatterns__1'
          value: 'Microsoft.Resources/tags'
        }
        {
          name: 'StamperConfig__IgnorePatterns__2'
          value: 'Microsoft.Network/frontdoor'
        }
        {
          name: 'StamperConfig__IgnorePatterns__3'
          value: 'Microsoft.Authorization/'
        }
        {
          name: 'StamperConfig__IgnorePatterns__4'
          value: 'Microsoft.Resources/subscriptions'
        }
        {
          name: 'StamperConfig__IgnorePatterns__5'
          value: 'Microsoft.ClassicCompute/'
        }
        {
          name: 'StamperConfig__IgnorePatterns__6'
          value: 'Microsoft.Insights/diagnosticSettings'
        }
        {
          name: 'StamperConfig__IgnorePatterns__7'
          value: 'Microsoft.Security/'
        }
        {
          name: 'StamperConfig__IgnorePatterns__8'
          value: 'Microsoft.EventGrid/'
        }
        {
          name: 'StamperConfig__ConfigBlobUri'
          value: 'https://${storageAccountName}.blob.${environment().suffixes.storage}/config/stamper.json'
        }
      ], packageUrl != '' ? [
        {
          name: 'WEBSITE_RUN_FROM_PACKAGE'
          value: packageUrl
        }
      ] : [])
    }
  }
}

output functionAppName string = functionApp.name
output functionAppId string = functionApp.id
output principalId string = functionApp.identity.principalId
