@description('Name of the function app to check.')
param functionAppName string

param location string = resourceGroup().location

// Identity is required by the deploymentScripts resource but needs no permissions —
// we use curl (no Azure RBAC needed) to avoid RBAC propagation delays.
resource scriptIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${functionAppName}-readiness-id'
  location: location
}

// Poll the function host URL until it responds (non-503 = code loaded from package)
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
  properties: {
    azCliVersion: '2.63.0'
    retentionInterval: 'PT1H'
    timeout: 'PT15M'
    cleanupPreference: 'OnSuccess'
    scriptContent: '''
      echo "Waiting for function app to finish loading from package..."
      for i in $(seq 1 40); do
        status=$(curl -s -o /dev/null -w "%{http_code}" "https://${FUNCTION_APP_NAME}.azurewebsites.net/" --max-time 10 2>/dev/null)
        if [ "$status" = "200" ] || [ "$status" = "401" ] || [ "$status" = "404" ]; then
          echo "Function host is responding (HTTP $status, attempt $i)"
          echo "Waiting 30s for functions to finish registering..."
          sleep 30
          echo "Ready"
          exit 0
        fi
        echo "Attempt $i/40: HTTP $status (not ready), waiting 20s..."
        sleep 20
      done
      echo "ERROR: Function app did not become ready within 15 minutes"
      exit 1
    '''
    environmentVariables: [
      { name: 'FUNCTION_APP_NAME', value: functionAppName }
    ]
  }
}
