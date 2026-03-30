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
      set -e
      echo "========================================"
      echo "Az-Stamper Package Deploy"
      echo "Function App: $FUNCTION_APP_NAME"
      echo "Resource Group: $RESOURCE_GROUP_NAME"
      echo "Package URL: $PACKAGE_URL"
      echo "Started: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
      echo "========================================"

      echo ""
      echo "[1/4] Waiting 60s for RBAC propagation..."
      for i in $(seq 1 6); do
        echo "  ...${i}0s"
        sleep 10
      done
      echo "[1/4] RBAC wait complete"

      echo ""
      echo "[2/4] Downloading package..."
      curl -sL -o /tmp/deploy.zip "$PACKAGE_URL"
      size=$(stat -c%s /tmp/deploy.zip 2>/dev/null || echo "unknown")
      echo "[2/4] Downloaded $size bytes"

      echo ""
      echo "[3/4] Deploying via Kudu zip deploy API..."
      token=$(az account get-access-token --resource "$MGMT_ENDPOINT" --query accessToken -o tsv)
      echo "[3/4] Got access token, POSTing to Kudu..."
      response=$(curl -s -w "\n%{http_code}" -X POST \
        "https://${FUNCTION_APP_NAME}.scm.azurewebsites.net/api/zipdeploy" \
        -H "Authorization: Bearer $token" \
        -H "Content-Type: application/zip" \
        --data-binary @/tmp/deploy.zip \
        --max-time 300)
      http_code=$(echo "$response" | tail -1)
      body=$(echo "$response" | head -n -1)
      echo "[3/4] Kudu returned HTTP $http_code"

      if [ "$http_code" != "200" ] && [ "$http_code" != "202" ]; then
        echo "[3/4] Kudu failed (response: $body)"
        echo "[3/4] Falling back to az functionapp deploy..."
        az functionapp deploy \
          --name "$FUNCTION_APP_NAME" \
          --resource-group "$RESOURCE_GROUP_NAME" \
          --src-path /tmp/deploy.zip \
          --type zip
        echo "[3/4] az functionapp deploy completed"
      else
        echo "[3/4] Kudu deploy succeeded"
      fi

      echo ""
      echo "[4/4] Waiting for ResourceStamper to register..."
      for i in $(seq 1 40); do
        funcs=$(az functionapp function list \
          --name "$FUNCTION_APP_NAME" \
          --resource-group "$RESOURCE_GROUP_NAME" \
          --query "[?name=='ResourceStamper'].name" -o tsv 2>/dev/null)
        if [ "$funcs" = "ResourceStamper" ]; then
          echo "[4/4] ResourceStamper is ready! (attempt $i)"
          echo ""
          echo "========================================"
          echo "Deploy complete: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
          echo "========================================"
          exit 0
        fi
        echo "  Attempt $i/40: not ready, waiting 20s..."
        sleep 20
      done
      echo "[4/4] WARNING: ResourceStamper not detected within timeout"
      echo "  The function may need a manual restart"
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
