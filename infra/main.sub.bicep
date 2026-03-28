targetScope = 'subscription'

param systemTopicName string = 'evgt-az-stamper'
param eventSubscriptionName string = 'evgs-az-stamper'
param functionAppId string
param functionAppPrincipalId string
param resourceGroupName string
param location string = 'eastus'

// Event Grid module deploys into the resource group (system topics are RG-scoped)
module eventGrid 'modules/eventGrid.bicep' = {
  name: 'eventGrid'
  scope: resourceGroup(resourceGroupName)
  params: {
    systemTopicName: systemTopicName
    eventSubscriptionName: eventSubscriptionName
    functionAppId: functionAppId
    subscriptionId: subscription().subscriptionId
    location: location
  }
}

// Subscription-scoped RBAC for the function's managed identity
resource readerRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(subscription().id, functionAppPrincipalId, 'acdd72a7-3385-48ef-bd42-f606fba81ae7')
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'acdd72a7-3385-48ef-bd42-f606fba81ae7')
    principalId: functionAppPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource tagContributorRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(subscription().id, functionAppPrincipalId, '4a9ae827-6dc8-4573-8ac7-8239d42aa03f')
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4a9ae827-6dc8-4573-8ac7-8239d42aa03f')
    principalId: functionAppPrincipalId
    principalType: 'ServicePrincipal'
  }
}
