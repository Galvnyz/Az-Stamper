# Az-Stamper Design Spec

## Purpose

Az-Stamper is an Azure Function that automatically stamps Azure resources with configurable metadata tags (creator identity, timestamps, static labels) by listening to Event Grid `ResourceWriteSuccess` events. It replaces the community [TagWithCreator](https://github.com/anwather/TagWithCreator) project with a production-grade, corporate-ready C# implementation.

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Language | C# (.NET 8 LTS, isolated worker) | Type safety, fast cold starts, Dependabot-friendly NuGet updates, "deploy and forget" |
| Hosting | Flex Consumption (Linux) | Scale to zero, VNet-capable, fast event-driven scaling, pay-as-you-go |
| IaC | Bicep (modular) | First-class Azure tooling, cleaner than ARM JSON, corporate standard |
| Storage auth | Managed identity | No keys to rotate, aligns with Flex Consumption defaults |
| Tag config | JSON tag map with overwrite flag | Configurable without code changes, supports both "first writer wins" and "last writer wins" |
| Testing | xUnit + Moq | .NET community standard, minimal dependency surface |
| Event filtering | Event Grid advanced filters + function-side fallback | Defense in depth: reduce invocations at the source, function handles edge cases |

## Architecture

### Project Structure

```
Az-Stamper/
├── src/
│   ├── AzStamper.Functions/          # Azure Functions isolated worker
│   │   ├── Program.cs                # Host builder, DI, config binding
│   │   ├── Functions/
│   │   │   └── ResourceStamperFunction.cs  # Event Grid trigger (thin adapter)
│   │   ├── host.json
│   │   ├── local.settings.json
│   │   └── AzStamper.Functions.csproj
│   └── AzStamper.Core/              # Pure business logic (no Azure Functions dependency)
│       ├── Models/
│       │   ├── StamperConfig.cs      # Tag map + ignore patterns (bound from config)
│       │   ├── TagEntry.cs           # Single tag definition (value template + overwrite flag)
│       │   └── ResourceEvent.cs      # Simplified event model extracted from Event Grid payload
│       ├── Services/
│       │   ├── ITagService.cs        # Interface: read/write tags on a resource
│       │   ├── TagService.cs         # Implementation via Azure.ResourceManager
│       │   ├── ICallerResolver.cs    # Interface: resolve principalId → display name
│       │   └── CallerResolver.cs     # Implementation via Azure.ResourceManager
│       ├── StampOrchestrator.cs      # Core logic: resolve → filter → stamp
│       └── AzStamper.Core.csproj
├── tests/
│   └── AzStamper.Core.Tests/
│       ├── StampOrchestratorTests.cs
│       ├── CallerResolverTests.cs
│       ├── TagServiceTests.cs
│       └── AzStamper.Core.Tests.csproj
├── infra/
│   ├── main.bicep                    # Resource group-scoped orchestrator
│   ├── main.sub.bicep                # Subscription-scoped (Event Grid)
│   ├── modules/
│   │   ├── functionApp.bicep
│   │   ├── storage.bicep
│   │   ├── monitoring.bicep
│   │   └── eventGrid.bicep
│   └── parameters/
│       ├── dev.bicepparam
│       └── prod.bicepparam
├── .github/
│   ├── workflows/
│   │   ├── ci.yml
│   │   └── deploy.yml
│   └── dependabot.yml
├── CLAUDE.md
├── README.md
└── Az-Stamper.sln
```

### Separation of Concerns

- **AzStamper.Functions** — thin adapter layer. Receives Event Grid event, extracts fields into `ResourceEvent`, calls `StampOrchestrator`, returns. No business logic here.
- **AzStamper.Core** — all business logic. Zero dependency on Azure Functions SDK. Depends on `Azure.ResourceManager` for tag/identity operations behind interfaces.
- **Tests** — target Core only. No need to mock Azure Functions host. Interfaces (`ITagService`, `ICallerResolver`) make all Azure SDK calls mockable.

## Data Flow

```
Event Grid (ResourceWriteSuccess)
  → ResourceStamperFunction.Run(EventGridEvent)
    → Extract claims, resourceUri, principalType, principalId → ResourceEvent
    → StampOrchestrator.ProcessAsync(ResourceEvent)
      ├── Validate event (non-null caller or resolvable principal, non-empty resourceId)
      ├── CallerResolver.ResolveAsync(claims, evidence)
      │     1. Check UPN claim → use if present
      │     2. If ServicePrincipal → query display name via ICallerResolver
      │     3. Fallback to raw principalId
      ├── Check resourceId against ignore patterns (from StamperConfig)
      └── TagService.StampAsync(resourceId, resolvedTagMap)
            1. Read existing tags on resource
            2. For each tag in TagMap:
               - If tag exists AND overwrite=false → skip
               - If tag exists AND overwrite=true → update
               - If tag doesn't exist → add
            3. Merge all changes in single Update-Tags call
```

## Configuration

### Tag Map (app setting: `StamperConfig`)

```json
{
  "StamperConfig": {
    "TagMap": {
      "Creator": { "value": "{caller}", "overwrite": false },
      "CreatedOn": { "value": "{timestamp}", "overwrite": false },
      "LastModifiedBy": { "value": "{caller}", "overwrite": true },
      "LastModifiedOn": { "value": "{timestamp}", "overwrite": true },
      "StampedBy": { "value": "Az-Stamper", "overwrite": false }
    },
    "IgnorePatterns": [
      "Microsoft.Resources/deployments",
      "Microsoft.Resources/tags",
      "Microsoft.Network/frontdoor"
    ]
  }
}
```

### Template Variables

| Variable | Resolved To |
|----------|-------------|
| `{caller}` | Resolved identity: UPN, Service Principal display name, or raw principalId |
| `{timestamp}` | UTC ISO 8601 timestamp of event processing (`yyyy-MM-ddTHH:mm:ssZ`) |
| `{principalType}` | `"User"` or `"ServicePrincipal"` |
| Static string (no `{}`) | Used as-is |

### C# Config Models

```csharp
public class StamperConfig
{
    public Dictionary<string, TagEntry> TagMap { get; set; } = new();
    public List<string> IgnorePatterns { get; set; } = new();
}

public class TagEntry
{
    public string Value { get; set; } = string.Empty;
    public bool Overwrite { get; set; } = false;
}
```

Bound via `IOptions<StamperConfig>` in `Program.cs`.

## Infrastructure (Bicep)

### Modules

| Module | Scope | Resources |
|--------|-------|-----------|
| `main.bicep` | Resource Group | Orchestrates storage, monitoring, functionApp |
| `main.sub.bicep` | Subscription | Deploys eventGrid module |
| `storage.bicep` | Resource Group | Storage account + MI role assignments (Storage Blob Data Owner, Storage Account Contributor) |
| `functionApp.bicep` | Resource Group | Flex Consumption function app (Linux, .NET 8 isolated), system-assigned MI, app settings including StamperConfig JSON |
| `monitoring.bicep` | Resource Group | Log Analytics workspace (30d retention) + workspace-based App Insights |
| `eventGrid.bicep` | Subscription | System topic (Microsoft.Resources.Subscriptions) + event subscription with advanced filters |

### RBAC Assignments

| Role | Assigned To | Scope | Purpose |
|------|------------|-------|---------|
| Storage Blob Data Owner | Function MI | Storage Account | Function runtime blob access |
| Storage Account Contributor | Function MI | Storage Account | Function runtime file share access |
| Reader | Function MI | Subscription | Resolve Service Principal display names |
| Tag Contributor | Function MI | Subscription | Read and write resource tags |
| Directory.Read.All (Graph API) | Function MI | Entra ID tenant | Resolve Service Principal display names |

### Event Grid Advanced Filters

Applied at the subscription level to reduce unnecessary function invocations:

- Include: `data.operationName` StringContains `write` (only write operations)
- Exclude: `data.operationName` StringContains `Microsoft.Resources/deployments` (filtered at EG level, plus function fallback)

## CI/CD

### CI Workflow (`.github/workflows/ci.yml`)

Triggers on push to `main` and PRs to `main`.

| Job | Steps |
|-----|-------|
| `build` | `dotnet restore` → `dotnet build --no-restore` |
| `test` | `dotnet test --no-build` → upload test results artifact |
| `lint` | `dotnet format --verify-no-changes` |
| `validate-bicep` | `az bicep build` on all `.bicep` files |

### Deploy Workflow (`.github/workflows/deploy.yml`)

| Trigger | Target |
|---------|--------|
| `workflow_dispatch` (env input) | dev / prod |
| Push to `main` | Auto-deploy to dev |

Steps: checkout → `dotnet publish` → Azure login (OIDC federated credential) → Bicep deployment → ZIP deploy function code

Required GitHub secrets per environment: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`

### Dependabot

```yaml
updates:
  - package-ecosystem: nuget
    directory: /src
    schedule:
      interval: weekly
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
```

## Testing

### xUnit Test Coverage

| Test Class | What It Tests | Key Cases |
|------------|--------------|-----------|
| `StampOrchestratorTests` | Core orchestration logic | Apply tags on new resource; skip ignored resource types; resolve `{caller}`, `{timestamp}`, `{principalType}` variables; respect `overwrite: false` (Creator); respect `overwrite: true` (LastModifiedBy); skip when caller is null; handle tag service failure gracefully; handle empty tag map |
| `CallerResolverTests` | Identity resolution | UPN claim present; SP fallback to DisplayName; SP fallback to raw principalId; resolver throws (graceful degradation) |
| `TagServiceTests` | Tag read/write operations | Merge new tags; skip existing non-overwrite tags; update existing overwrite tags; handle read failure; handle write failure |

All Azure SDK operations are behind `ITagService` and `ICallerResolver` interfaces, mocked with Moq in tests. No Azure credentials needed to run tests.

**Estimated test count**: 25-30

## NuGet Dependencies

### AzStamper.Functions

- `Microsoft.Azure.Functions.Worker` — isolated worker host
- `Microsoft.Azure.Functions.Worker.Extensions.EventGrid` — Event Grid trigger binding
- `Microsoft.Azure.Functions.Worker.Sdk` — build tooling
- `Microsoft.Extensions.Options` — configuration binding

### AzStamper.Core

- `Azure.ResourceManager` — ARM client for tag operations
- `Azure.ResourceManager.Resources` — tag resource operations
- `Azure.Identity` — `DefaultAzureCredential` for managed identity
- `Microsoft.Extensions.Logging.Abstractions` — `ILogger<T>`
- `Microsoft.Extensions.Options` — `IOptions<StamperConfig>`
- `Microsoft.Graph` — Service Principal display name lookup (via Graph API, requires Directory.Read.All app permission on the MI)

### AzStamper.Core.Tests

- `xunit` + `xunit.runner.visualstudio`
- `Moq`
- `Microsoft.NET.Test.Sdk`

## Error Handling

- **CallerResolver failure**: Log warning, fall back to raw principalId. Never fail the function because of identity resolution.
- **TagService read failure**: Log warning, exit gracefully. Don't attempt to write tags if we can't read existing state.
- **TagService write failure**: Log warning, move on. The next event may succeed (transient failures).
- **Invalid event**: Log warning, exit. Don't throw — Azure Functions will retry on unhandled exceptions, causing duplicate processing.
- **All errors**: Logged via `ILogger<T>` which flows to Application Insights. No `throw` in business logic — return early with logged context.

## Attribution

This project is a clean-room rebuild inspired by [TagWithCreator](https://github.com/anwather/TagWithCreator) by Anthony Watherston (MIT License). The original PowerShell implementation informed the tagging logic and Event Grid trigger pattern.
