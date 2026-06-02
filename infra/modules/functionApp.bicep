param name string
param location string
param tags object
param storageAccountName string
param appInsightsConnectionString string
@description('URL of the function app deployment package. Used by Deploy-to-Azure button.')
param packageUrl string = ''

@description('OS for the function app hosting plan. Windows Consumption has full log streaming + Kudu; Linux Consumption does not. Both are identically priced.')
@allowed(['Linux', 'Windows'])
param functionAppOs string = 'Linux'

@description('Use identity-based (managed-identity) host storage. Set false on plans that need a connection-string content share (e.g. Windows Consumption).')
param useIdentityStorage bool = true

// StamperConfig uses __ delimited app settings for IOptions<T> binding

var isWindows = functionAppOs == 'Windows'

// Existing storage account — referenced to build a host-storage connection string when
// identity-based host storage is disabled (Windows Consumption needs a content share).
resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: storageAccountName
}

var storageConnectionString = 'DefaultEndpointsProtocol=https;AccountName=${storageAccountName};EndpointSuffix=${environment().suffixes.storage};AccountKey=${storageAccount.listKeys().keys[0].value}'

// Host storage: identity-based (keyless) vs connection-string + Azure Files content share.
var identityStorageSettings = [
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
]
var connectionStringStorageSettings = [
  {
    name: 'AzureWebJobsStorage'
    value: storageConnectionString
  }
  {
    name: 'WEBSITE_CONTENTAZUREFILECONNECTIONSTRING'
    value: storageConnectionString
  }
  {
    name: 'WEBSITE_CONTENTSHARE'
    value: toLower(name)
  }
]
var storageSettings = useIdentityStorage ? identityStorageSettings : connectionStringStorageSettings

// Cloud-aware + app config settings (independent of OS / storage mode).
var baseSettings = [
  {
    name: 'FUNCTIONS_EXTENSION_VERSION'
    value: '~4'
  }
  {
    name: 'FUNCTIONS_WORKER_RUNTIME'
    value: 'dotnet-isolated'
  }
  {
    // Drives cloud-aware ArmClient/GraphServiceClient construction in Program.cs.
    // Resolves to 'AzureCloud' (commercial) or 'AzureUSGovernment' (GCC High).
    name: 'AzureCloud__Name'
    value: environment().name
  }
  {
    // Steers DefaultAzureCredential to the correct authority per cloud:
    // login.microsoftonline.com (commercial) vs login.microsoftonline.us (Gov).
    name: 'AZURE_AUTHORITY_HOST'
    value: environment().authentication.loginEndpoint
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
    // Read via managed identity (DefaultAzureCredential) regardless of host-storage mode.
    name: 'StamperConfig__ConfigBlobUri'
    value: 'https://${storageAccountName}.blob.${environment().suffixes.storage}/config/stamper.json'
  }
]

var packageSettings = packageUrl != '' ? [
  {
    name: 'WEBSITE_RUN_FROM_PACKAGE'
    value: packageUrl
  }
] : []

resource consumptionPlan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: '${name}-plan'
  location: location
  tags: tags
  kind: isWindows ? 'functionapp' : 'linux'
  sku: {
    name: 'Y1'
    tier: 'Dynamic'
  }
  properties: {
    reserved: !isWindows
  }
}

resource functionApp 'Microsoft.Web/sites@2024-04-01' = {
  name: name
  location: location
  tags: tags
  kind: isWindows ? 'functionapp' : 'functionapp,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: consumptionPlan.id
    httpsOnly: true
    siteConfig: {
      // Linux sets the runtime via linuxFxVersion; Windows via netFrameworkVersion.
      // .NET 10 isolated: GA on Windows Consumption + Flex; NOT on Linux Consumption.
      linuxFxVersion: isWindows ? null : 'DOTNET-ISOLATED|10.0'
      netFrameworkVersion: isWindows ? 'v10.0' : null
      minTlsVersion: '1.2'
      appSettings: concat(baseSettings, storageSettings, packageSettings)
    }
  }
}

output functionAppName string = functionApp.name
output functionAppId string = functionApp.id
output principalId string = functionApp.identity.principalId
