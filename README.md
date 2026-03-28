# Az-Stamper

Automatically stamps Azure resources with configurable metadata tags (creator identity, timestamps, static labels) via Event Grid-triggered Azure Function.

Inspired by [TagWithCreator](https://github.com/anwather/TagWithCreator) by Anthony Watherston.

## Architecture

```
Event Grid (ResourceWriteSuccess)
  → Azure Function (.NET 8, isolated worker, Flex Consumption)
    → Resolve caller identity (UPN → Service Principal → fallback)
      → Apply configurable tag map with overwrite semantics
```

## Tag Configuration

Tags are configured via the `StamperConfig` app setting:

| Tag | Template | Overwrite | Behavior |
|-----|----------|-----------|----------|
| Creator | `{caller}` | false | Set once, never overwritten |
| CreatedOn | `{timestamp}` | false | Set once |
| LastModifiedBy | `{caller}` | true | Updated on every write |
| LastModifiedOn | `{timestamp}` | true | Updated on every write |
| StampedBy | `Az-Stamper` | false | Static label, set once |

## Quick Start

### Deploy

```bash
az deployment group create \
  --resource-group rg-az-stamper-dev \
  --template-file infra/main.bicep \
  --parameters infra/parameters/dev.bicepparam

dotnet publish src/AzStamper.Functions -c Release -o ./publish
cd publish && zip -r ../deploy.zip .
az functionapp deployment source config-zip \
  --resource-group rg-az-stamper-dev \
  --name func-az-stamper-dev \
  --src deploy.zip
```

Then deploy the Event Grid subscription:

```bash
az deployment sub create \
  --location eastus \
  --template-file infra/main.sub.bicep \
  --parameters functionAppId=/subscriptions/<SUB_ID>/resourceGroups/<RG>/providers/Microsoft.Web/sites/func-az-stamper-dev functionAppPrincipalId=<PRINCIPAL_ID>
```

### Run Tests

```bash
dotnet test Az-Stamper.sln
```

## RBAC Requirements

| Role | Scope | Purpose |
|------|-------|---------|
| Reader | Subscription | Resolve SP display names |
| Tag Contributor | Subscription | Read/write resource tags |
| Storage Blob Data Owner | Storage Account | Function runtime |
| Directory.Read.All | Entra ID | Graph API SP lookup |

## License

[MIT](LICENSE)
