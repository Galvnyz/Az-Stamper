targetScope = 'subscription'

@description('Resource ID of the Az-Stamper function app (e.g., /subscriptions/.../Microsoft.Web/sites/func-az-stamper)')
param functionAppResourceId string

@description('Principal ID (object ID) of the Az-Stamper function app managed identity')
param functionAppPrincipalId string

@description('Name for the Event Grid system topic')
param systemTopicName string = 'evgt-az-stamper'

@description('Name for the Event Grid event subscription')
param eventSubscriptionName string = 'evgs-az-stamper'

@description('Resource group name in the target subscription for the Event Grid system topic')
param eventGridResourceGroupName string

@description('Location for the Event Grid resources')
param location string = 'global'

// Event Grid module deploys into the specified resource group
module eventGrid 'modules/enrollment.bicep' = {
  name: 'az-stamper-enrollment'
  scope: resourceGroup(eventGridResourceGroupName)
  params: {
    systemTopicName: systemTopicName
    eventSubscriptionName: eventSubscriptionName
    functionAppId: functionAppResourceId
    subscriptionId: subscription().subscriptionId
    location: location
  }
}

// Subscription-scoped RBAC: Reader
resource readerRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(subscription().id, functionAppPrincipalId, 'acdd72a7-3385-48ef-bd42-f606fba81ae7')
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'acdd72a7-3385-48ef-bd42-f606fba81ae7')
    principalId: functionAppPrincipalId
    principalType: 'ServicePrincipal'
  }
}

// Subscription-scoped RBAC: Tag Contributor
resource tagContributorRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(subscription().id, functionAppPrincipalId, '4a9ae827-6dc8-4573-8ac7-8239d42aa03f')
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4a9ae827-6dc8-4573-8ac7-8239d42aa03f')
    principalId: functionAppPrincipalId
    principalType: 'ServicePrincipal'
  }
}
