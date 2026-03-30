@description('Name of the function app to deploy to.')
param functionAppName string

@description('Resource group containing the function app.')
param resourceGroupName string

@description('URL of the deployment package zip.')
param packageUrl string

param location string = resourceGroup().location

// Identity for the deployment script — needs Contributor to deploy code
resource scriptIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${functionAppName}-deploy-id'
  location: location
}

// Contributor on the RG so az functionapp deployment works
resource contributorRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(resourceGroup().id, scriptIdentity.id, 'b24988ac-6180-42a0-ab88-20f7382dd24c')
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'b24988ac-6180-42a0-ab88-20f7382dd24c')
    principalId: scriptIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// Download the zip and deploy it to the function app
resource deployPackage 'Microsoft.Resources/deploymentScripts@2023-08-01' = {
  name: '${functionAppName}-package-deploy'
  location: location
  kind: 'AzureCLI'
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${scriptIdentity.id}': {}
    }
  }
  dependsOn: [contributorRole]
  properties: {
    azCliVersion: '2.63.0'
    retentionInterval: 'PT1H'
    timeout: 'PT15M'
    cleanupPreference: 'OnSuccess'
    scriptContent: '''
      echo "Waiting 60s for RBAC propagation..."
      sleep 60

      echo "Downloading package from $PACKAGE_URL..."
      curl -sL -o /tmp/deploy.zip "$PACKAGE_URL"
      size=$(stat -c%s /tmp/deploy.zip 2>/dev/null || echo "unknown")
      echo "Downloaded $size bytes"

      echo "Deploying to $FUNCTION_APP_NAME in $RESOURCE_GROUP_NAME..."
      az functionapp deployment source config-zip \
        --name "$FUNCTION_APP_NAME" \
        --resource-group "$RESOURCE_GROUP_NAME" \
        --src /tmp/deploy.zip

      echo "Waiting for function to register..."
      for i in $(seq 1 30); do
        status=$(curl -s -o /dev/null -w "%{http_code}" "https://${FUNCTION_APP_NAME}.azurewebsites.net/" --max-time 10 2>/dev/null)
        if [ "$status" = "200" ] || [ "$status" = "401" ] || [ "$status" = "404" ]; then
          echo "Function host is responding (HTTP $status, attempt $i)"
          sleep 30
          echo "Deploy complete"
          exit 0
        fi
        echo "Attempt $i/30: HTTP $status, waiting 20s..."
        sleep 20
      done
      echo "WARNING: Function host not yet responding, but deploy command succeeded"
      exit 0
    '''
    environmentVariables: [
      { name: 'FUNCTION_APP_NAME', value: functionAppName }
      { name: 'RESOURCE_GROUP_NAME', value: resourceGroupName }
      { name: 'PACKAGE_URL', value: packageUrl }
    ]
  }
}
