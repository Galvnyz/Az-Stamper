targetScope = 'subscription'

@description('Azure region for all resources.')
param location string

@description('Name of the resource group to create or use.')
param resourceGroupName string = 'rg-az-stamper'

@description('Globally unique name for the storage account (3-24 lowercase letters/numbers).')
@minLength(3)
@maxLength(24)
param storageAccountName string

@description('Name for the function app.')
param functionAppName string = 'func-az-stamper'

@description('Name for the Application Insights instance.')
param appInsightsName string = 'ai-az-stamper'

@description('Environment tag value.')
@allowed(['dev', 'prod'])
param environment string = 'prod'

@description('URL of the function app deployment package (pre-filled with latest release).')
param packageUrl string = 'https://github.com/Galvnyz/Az-Stamper/releases/latest/download/az-stamper.zip'

@description('Name for the Event Grid system topic.')
param systemTopicName string = 'evgt-az-stamper'

@description('Name for the Event Grid event subscription.')
param eventSubscriptionName string = 'evgs-az-stamper'

// 1. Create resource group
resource rg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: resourceGroupName
  location: location
  tags: {
    Project: 'Az-Stamper'
    ManagedBy: 'Bicep'
    Environment: environment
  }
}

// 2. Deploy all hub resources into the resource group
module hub 'main.bicep' = {
  name: 'hub'
  scope: rg
  params: {
    location: location
    storageAccountName: storageAccountName
    functionAppName: functionAppName
    appInsightsName: appInsightsName
    environment: environment
    packageUrl: packageUrl
  }
}

// 3. Deploy Event Grid system topic + event subscription into the resource group
module eventGrid 'modules/eventGrid.bicep' = {
  name: 'eventGrid'
  scope: rg
  params: {
    systemTopicName: systemTopicName
    eventSubscriptionName: eventSubscriptionName
    functionAppId: hub.outputs.functionAppId
    subscriptionId: subscription().subscriptionId
  }
}

// 4. Subscription-scoped RBAC — Reader
resource readerRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(subscription().id, functionAppName, 'acdd72a7-3385-48ef-bd42-f606fba81ae7')
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'acdd72a7-3385-48ef-bd42-f606fba81ae7')
    principalId: hub.outputs.principalId
    principalType: 'ServicePrincipal'
  }
}

// 5. Subscription-scoped RBAC — Tag Contributor
resource tagContributorRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(subscription().id, functionAppName, '4a9ae827-6dc8-4573-8ac7-8239d42aa03f')
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4a9ae827-6dc8-4573-8ac7-8239d42aa03f')
    principalId: hub.outputs.principalId
    principalType: 'ServicePrincipal'
  }
}

output functionAppName string = hub.outputs.functionAppName
output functionAppId string = hub.outputs.functionAppId
output principalId string = hub.outputs.principalId
output swaHostname string = hub.outputs.swaHostname
