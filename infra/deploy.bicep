targetScope = 'subscription'

var location = deployment().location

@description('Name of the resource group to create or use.')
param resourceGroupName string = 'rg-az-stamper'

@description('Globally unique name for the storage account (3-24 lowercase letters/numbers).')
@minLength(3)
@maxLength(24)
param storageAccountName string

@description('Globally unique name for the function app (becomes <name>.azurewebsites.net).')
param functionAppName string

@description('Name for the Application Insights instance.')
param appInsightsName string = '${functionAppName}-ai'

@description('Environment tag applied to all resources. Use dev for testing/trials, prod for production.')
@allowed(['dev', 'prod'])
param environment string = 'prod'

@description('URL of the function app deployment package (pre-filled with latest release).')
param packageUrl string = 'https://github.com/Galvnyz/Az-Stamper/releases/latest/download/az-stamper.zip'

@description('Location for the Static Web App. SWA Free tier is only available in select regions.')
@allowed(['westus2', 'centralus', 'eastus2', 'westeurope', 'eastasia'])
param swaLocation string = 'eastus2'

@description('GitHub repository URL. Change this if deploying from a fork.')
param repositoryUrl string = 'https://github.com/Galvnyz/Az-Stamper'

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
    swaLocation: swaLocation
    repositoryUrl: repositoryUrl
  }
}

// 3. Subscription-scoped RBAC — Reader + Tag Contributor
//    Uses principalId in guid seed so delete-RG-and-redeploy works
module subscriptionRbac 'modules/subscriptionRbac.bicep' = {
  name: 'subscriptionRbac'
  params: {
    principalId: hub.outputs.principalId
  }
}

// 4. Enroll the hub subscription — Event Grid system topic + event subscription
module eventGrid 'modules/eventGrid.bicep' = {
  name: 'az-stamper-enrollment'
  scope: rg
  params: {
    functionAppId: hub.outputs.functionAppId
    subscriptionId: subscription().subscriptionId
  }
  dependsOn: [subscriptionRbac]
}

output functionAppName string = hub.outputs.functionAppName
output functionAppId string = hub.outputs.functionAppId
output principalId string = hub.outputs.principalId
output swaHostname string = hub.outputs.swaHostname
