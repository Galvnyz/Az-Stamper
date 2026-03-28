# Az-Stamper

Automatically stamps Azure resources with configurable metadata tags (creator identity, timestamps, static labels) via an Event Grid-triggered Azure Function.

Inspired by [TagWithCreator](https://github.com/anwather/TagWithCreator) by Anthony Watherston.

## Architecture

```
Azure Subscription Activity Log
  → Event Grid System Topic (subscription-scoped, filters ResourceWriteSuccess)
    → Azure Function (.NET 8 isolated worker, Flex Consumption)
      → Resolve caller identity (UPN → Service Principal display name → raw principalId)
        → Apply configurable tag map with overwrite semantics
```

**Resources deployed by Bicep:**

| Resource | Purpose |
|----------|---------|
| Storage Account | Function runtime (managed identity, no keys) |
| Flex Consumption App Service Plan | Serverless hosting, scale to zero |
| Function App | Runs Az-Stamper with system-assigned managed identity |
| Log Analytics Workspace | Centralized logging |
| Application Insights | Function monitoring and diagnostics |
| Event Grid System Topic | Listens to subscription-level resource events |
| Event Grid Subscription | Filters `ResourceWriteSuccess` and routes to function |

## Tag Configuration

Tags are defined as app settings using the `StamperConfig__` prefix. Each tag has a `Value` (template string) and `Overwrite` flag (whether to update existing tags).

### Default Tags

| Tag | Template | Overwrite | Behavior |
|-----|----------|-----------|----------|
| Creator | `{caller}` | false | Set once on resource creation, never overwritten |
| CreatedOn | `{timestamp}` | false | ISO 8601 UTC timestamp, set once |
| LastModifiedBy | `{caller}` | true | Updated on every resource write event |
| LastModifiedOn | `{timestamp}` | true | Updated on every resource write event |
| StampedBy | `Az-Stamper` | false | Static label identifying the stamping system |

### Template Variables

| Variable | Resolves To |
|----------|-------------|
| `{caller}` | UPN (e.g., `user@contoso.com`), Service Principal display name, or raw principal ID |
| `{timestamp}` | UTC time in ISO 8601 format (`yyyy-MM-ddTHH:mm:ssZ`) |
| `{principalType}` | `User` or `ServicePrincipal` |
| Any other string | Used as a literal value |

### Adding or Modifying Tags

Tags are configured via app settings in the format `StamperConfig__TagMap__<TagName>__Value` and `StamperConfig__TagMap__<TagName>__Overwrite`. To add a new tag, add two app settings to the Function App:

```
StamperConfig__TagMap__CostCenter__Value = Finance
StamperConfig__TagMap__CostCenter__Overwrite = false
```

To change the overwrite behavior of an existing tag, update the `Overwrite` setting to `true` or `false`.

### Ignore Patterns

Resource types matching these patterns are skipped (prevents infinite loops and unnecessary processing):

```
StamperConfig__IgnorePatterns__0 = Microsoft.Resources/deployments
StamperConfig__IgnorePatterns__1 = Microsoft.Resources/tags
StamperConfig__IgnorePatterns__2 = Microsoft.Network/frontdoor
```

To add more patterns, increment the index (e.g., `__3`, `__4`).

## Deployment

### Prerequisites

- Azure subscription with Owner or Contributor role
- [Azure CLI](https://learn.microsoft.com/en-us/cli/azure/install-azure-cli) with Bicep (`az bicep install`)
- [Azure Functions Core Tools v4](https://learn.microsoft.com/en-us/azure/azure-functions/functions-run-local) (`func`)
- [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0)
- A GitHub account (for CI/CD and Dependabot)

### Step 1: Create Entra ID App Registration (OIDC)

Create an app registration with a federated credential so GitHub Actions can deploy without secrets.

```powershell
# Create app registration
$app = New-AzADApplication -DisplayName "Az-Stamper-Deploy"

# Create service principal
$sp = New-AzADServicePrincipal -ApplicationId $app.AppId

# Add federated credential for GitHub Actions
New-AzADAppFederatedCredential -ApplicationObjectId $app.Id `
    -Name "github-actions-dev" `
    -Issuer "https://token.actions.githubusercontent.com" `
    -Subject "repo:<YOUR_ORG>/Az-Stamper:environment:dev" `
    -Audience @("api://AzureADTokenExchange")

# Note these values for GitHub secrets
Write-Host "AZURE_CLIENT_ID: $($app.AppId)"
Write-Host "AZURE_TENANT_ID: $((Get-AzContext).Tenant.Id)"
Write-Host "AZURE_SUBSCRIPTION_ID: $((Get-AzContext).Subscription.Id)"
```

### Step 2: Create Resource Group and Assign RBAC

```powershell
$rgName = "rg-az-stamper-dev"

New-AzResourceGroup -Name $rgName -Location "eastus" -Force

# Grant the deploy SP permissions to deploy and assign roles
New-AzRoleAssignment -ObjectId $sp.Id -RoleDefinitionName "Contributor" -ResourceGroupName $rgName
New-AzRoleAssignment -ObjectId $sp.Id -RoleDefinitionName "User Access Administrator" -ResourceGroupName $rgName
```

### Step 3: Configure GitHub Environment

1. Go to **Settings → Environments → New environment** → create `dev`
2. Add **secrets**:
   - `AZURE_CLIENT_ID` — from Step 1
   - `AZURE_TENANT_ID` — from Step 1
   - `AZURE_SUBSCRIPTION_ID` — from Step 1
3. Add **variables**:
   - `RESOURCE_GROUP` = `rg-az-stamper-dev`
   - `FUNCTION_APP_NAME` = `func-az-stamper-dev`

### Step 4: Deploy Infrastructure

```bash
az deployment group create \
  --resource-group rg-az-stamper-dev \
  --template-file infra/main.bicep \
  --parameters infra/parameters/dev.bicepparam
```

Note the outputs — you'll need `functionAppId` and `principalId` for the next steps.

### Step 5: Deploy Function Code

Use Azure Functions Core Tools (handles Flex Consumption deployment correctly):

```bash
cd src/AzStamper.Functions
func azure functionapp publish func-az-stamper-dev --dotnet-isolated
```

Verify the function is detected:
```bash
func azure functionapp list-functions func-az-stamper-dev
# Should show: ResourceStamper - [eventGridTrigger]
```

### Step 6: Deploy Event Grid Subscription

This is a separate subscription-scoped deployment that creates the Event Grid system topic, event subscription, and assigns Reader + Tag Contributor roles to the function's managed identity.

```bash
az deployment sub create \
  --location eastus \
  --template-file infra/main.sub.bicep \
  --parameters \
    functionAppId=<FUNCTION_APP_ID from Step 4> \
    functionAppPrincipalId=<PRINCIPAL_ID from Step 4> \
    resourceGroupName=rg-az-stamper-dev
```

### Step 7: Grant Graph API Permission (Optional)

Required only if you want Service Principal display names resolved (instead of raw principal IDs).

```powershell
$miPrincipalId = "<PRINCIPAL_ID from Step 4>"
$graphSp = Get-AzADServicePrincipal -ApplicationId "00000003-0000-0000-c000-000000000000"
$role = $graphSp.AppRole | Where-Object { $_.Value -eq "Directory.Read.All" }
New-AzADServicePrincipalAppRoleAssignment `
    -ServicePrincipalId $miPrincipalId `
    -ResourceId $graphSp.Id `
    -AppRoleId $role.Id
```

### Step 8: Verify

Create a test resource and check if tags are applied:

```bash
# Create test resource
az storage account create \
  --name stazstampertest \
  --resource-group rg-az-stamper-dev \
  --sku Standard_LRS

# Wait 60-90 seconds, then check tags
az tag list --resource-id /subscriptions/<SUB_ID>/resourceGroups/rg-az-stamper-dev/providers/Microsoft.Storage/storageAccounts/stazstampertest
```

Expected tags: `Creator`, `CreatedOn`, `LastModifiedBy`, `LastModifiedOn`, `StampedBy`.

```bash
# Clean up test resource
az storage account delete --name stazstampertest --resource-group rg-az-stamper-dev --yes
```

## RBAC Requirements

These roles are automatically assigned by the Bicep templates:

| Role | Scope | Assigned To | Purpose |
|------|-------|-------------|---------|
| Storage Blob Data Owner | Storage Account | Function MI | Function runtime blob access |
| Storage Account Contributor | Storage Account | Function MI | Function runtime file share |
| Reader | Subscription | Function MI | Resolve Service Principal details |
| Tag Contributor | Subscription | Function MI | Read and write resource tags |
| Directory.Read.All (Graph) | Entra ID tenant | Function MI | Resolve SP display names (optional) |

## CI/CD

| Workflow | Trigger | What It Does |
|----------|---------|-------------|
| **CI** (`ci.yml`) | Push to `main`, PRs | Build, test, format check, Bicep validation |
| **Deploy** (`deploy.yml`) | `workflow_dispatch` | Deploy infra + code to selected environment |
| **Dependabot** | Weekly | Opens PRs for NuGet and GitHub Actions updates |

Auto-merge is enabled — Dependabot PRs merge automatically once CI passes.

## Development

```bash
# Build
dotnet build Az-Stamper.sln

# Test (23 tests)
dotnet test Az-Stamper.sln

# Format check
dotnet format Az-Stamper.sln --verify-no-changes

# Run locally
cd src/AzStamper.Functions
func start
```

## License

[MIT](LICENSE) — Inspired by original work by Anthony Watherston.
