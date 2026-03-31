targetScope = 'subscription'

@description('Subscription ID where the Az-Stamper hub is deployed.')
param hubSubscriptionId string

@description('Name of the resource group containing the Az-Stamper hub.')
param resourceGroupName string = 'rg-az-stamper'

@description('Name of the Az-Stamper function app.')
param functionAppName string = 'func-az-stamper'

@description('Name of the resource group to create in this subscription for Event Grid resources.')
param enrollmentResourceGroupName string = 'rg-az-stamper-enrollment'

@description('Name for the Event Grid system topic')
param systemTopicName string = 'evgt-az-stamper'

@description('Name for the Event Grid event subscription')
param eventSubscriptionName string = 'evgs-az-stamper'

var location = deployment().location

// Look up the function app in the hub subscription
resource funcApp 'Microsoft.Web/sites@2023-12-01' existing = {
  name: functionAppName
  scope: resourceGroup(hubSubscriptionId, resourceGroupName)
}

// 1. Create a resource group in this subscription for Event Grid resources
resource enrollRg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: enrollmentResourceGroupName
  location: location
  tags: {
    Project: 'Az-Stamper'
    ManagedBy: 'Bicep'
    Purpose: 'Event Grid enrollment'
  }
}

// 2. Event Grid system topic + event subscription in the spoke RG
module eventGrid 'modules/eventGrid.bicep' = {
  name: 'az-stamper-enrollment'
  scope: enrollRg
  params: {
    systemTopicName: systemTopicName
    eventSubscriptionName: eventSubscriptionName
    functionAppId: funcApp.id
    subscriptionId: subscription().subscriptionId
  }
}

// 3. Subscription-scoped RBAC — Reader + Tag Contributor for this subscription
module subscriptionRbac 'modules/subscriptionRbac.bicep' = {
  name: 'enrollmentRbac'
  params: {
    principalId: funcApp.identity.principalId
  }
}
