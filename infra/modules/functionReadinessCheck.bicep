@description('Name of the function app to check.')
param functionAppName string

@description('Resource group of the function app.')
param resourceGroupName string

param location string = resourceGroup().location

// User-assigned identity for the deployment script to call az cli
resource scriptIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${functionAppName}-readiness-id'
  location: location
}

// The script identity needs Reader on the function app to list functions
resource readerRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(resourceGroup().id, scriptIdentity.id, 'acdd72a7-3385-48ef-bd42-f606fba81ae7')
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'acdd72a7-3385-48ef-bd42-f606fba81ae7')
    principalId: scriptIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// Poll until the ResourceStamper function is registered
resource readinessCheck 'Microsoft.Resources/deploymentScripts@2023-08-01' = {
  name: '${functionAppName}-readiness-check'
  location: location
  kind: 'AzureCLI'
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${scriptIdentity.id}': {}
    }
  }
  dependsOn: [readerRole]
  properties: {
    azCliVersion: '2.63.0'
    retentionInterval: 'PT1H'
    timeout: 'PT10M'
    cleanupPreference: 'OnSuccess'
    scriptContent: '''
      echo "Waiting for function app to register ResourceStamper..."
      for i in $(seq 1 30); do
        funcs=$(az functionapp function list \
          --name $FUNCTION_APP_NAME \
          --resource-group $RESOURCE_GROUP_NAME \
          --query "[?name=='ResourceStamper'].name" -o tsv 2>/dev/null)
        if [ "$funcs" = "ResourceStamper" ]; then
          echo "ResourceStamper function is ready (attempt $i)"
          exit 0
        fi
        echo "Attempt $i/30: function not ready yet, waiting 20s..."
        sleep 20
      done
      echo "ERROR: ResourceStamper function did not become ready within 10 minutes"
      exit 1
    '''
    environmentVariables: [
      { name: 'FUNCTION_APP_NAME', value: functionAppName }
      { name: 'RESOURCE_GROUP_NAME', value: resourceGroupName }
    ]
  }
}
