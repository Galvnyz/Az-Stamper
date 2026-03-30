targetScope = 'subscription'

@description('Name of the resource group containing the Az-Stamper hub.')
param resourceGroupName string = 'rg-az-stamper'

@description('Name of the Az-Stamper function app.')
param functionAppName string = 'func-az-stamper'

param systemTopicName string = 'evgt-az-stamper'
param eventSubscriptionName string = 'evgs-az-stamper'

// Look up the existing function app to get its resource ID and managed identity
resource funcApp 'Microsoft.Web/sites@2023-12-01' existing = {
  name: functionAppName
  scope: resourceGroup(resourceGroupName)
}

// Event Grid module deploys into the resource group (system topics are RG-scoped)
module eventGrid 'modules/eventGrid.bicep' = {
  name: 'eventGrid'
  scope: resourceGroup(resourceGroupName)
  params: {
    systemTopicName: systemTopicName
    eventSubscriptionName: eventSubscriptionName
    functionAppId: funcApp.id
    subscriptionId: subscription().subscriptionId
  }
}

// Subscription-scoped RBAC (idempotent — same guids as deploy.bicep if already assigned)
module subscriptionRbac 'modules/subscriptionRbac.bicep' = {
  name: 'enrollmentRbac'
  params: {
    principalId: funcApp.identity.principalId
  }
}
