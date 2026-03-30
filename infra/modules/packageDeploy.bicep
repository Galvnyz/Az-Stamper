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

// Contributor on the RG so deployment and function listing works
resource contributorRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(resourceGroup().id, scriptIdentity.id, 'b24988ac-6180-42a0-ab88-20f7382dd24c')
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'b24988ac-6180-42a0-ab88-20f7382dd24c')
    principalId: scriptIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// Download the zip and deploy via Kudu zip deploy API
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

      echo "Deploying to $FUNCTION_APP_NAME via Kudu zip deploy..."
      token=$(az account get-access-token --resource "$MGMT_ENDPOINT" --query accessToken -o tsv)
      response=$(curl -s -w "\n%{http_code}" -X POST \
        "https://${FUNCTION_APP_NAME}.scm.azurewebsites.net/api/zipdeploy" \
        -H "Authorization: Bearer $token" \
        -H "Content-Type: application/zip" \
        --data-binary @/tmp/deploy.zip \
        --max-time 300)
      http_code=$(echo "$response" | tail -1)
      echo "Kudu zip deploy returned HTTP $http_code"

      if [ "$http_code" != "200" ] && [ "$http_code" != "202" ]; then
        echo "Kudu deploy failed, falling back to az functionapp deploy..."
        az functionapp deploy \
          --name "$FUNCTION_APP_NAME" \
          --resource-group "$RESOURCE_GROUP_NAME" \
          --src-path /tmp/deploy.zip \
          --type zip
      fi

      echo "Waiting for ResourceStamper function to register..."
      for i in $(seq 1 40); do
        funcs=$(az functionapp function list \
          --name "$FUNCTION_APP_NAME" \
          --resource-group "$RESOURCE_GROUP_NAME" \
          --query "[?name=='ResourceStamper'].name" -o tsv 2>/dev/null)
        if [ "$funcs" = "ResourceStamper" ]; then
          echo "ResourceStamper is ready (attempt $i)"
          exit 0
        fi
        echo "Attempt $i/40: not ready, waiting 20s..."
        sleep 20
      done
      echo "WARNING: ResourceStamper not detected within timeout"
      exit 0
    '''
    environmentVariables: [
      { name: 'FUNCTION_APP_NAME', value: functionAppName }
      { name: 'RESOURCE_GROUP_NAME', value: resourceGroupName }
      { name: 'PACKAGE_URL', value: packageUrl }
      { name: 'MGMT_ENDPOINT', value: environment().resourceManager }
    ]
  }
}
