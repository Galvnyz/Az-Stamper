# Multi-Subscription Az-Stamper Design Spec

**Date:** 2026-03-28
**Status:** Approved
**Target:** Small-to-mid organizations (2–15 subscriptions)

## Problem

Az-Stamper currently operates on a single subscription per deployment. Organizations with multiple Azure subscriptions must deploy the entire stack (function app, storage, monitoring) per subscription — duplicating infrastructure and fragmenting visibility. There is no way to centralize tagging governance across subscriptions.

## Goal

Enable a **hub-and-spoke** deployment model where:

- A **platform team** deploys one centralized Az-Stamper function app (hub)
- **Subscription owners** enroll their subscriptions with a one-click Deploy-to-Azure button (spoke)
- Tag rules are **globally defaulted** with **optional per-subscription overrides** and **resource-type filtering**
- No pre-registration is required — unknown subscriptions automatically receive default tag rules

## Non-Goals

- Enterprise-scale features (private networking, management group RBAC, Lighthouse)
- Custom management UI (deferred to future milestone)
- Azure Marketplace packaging (deferred — build open-source first, marketplace later)
- SaaS multi-tenant hosting

---

## Architecture

```
┌──────────────────────────────────────────────┐
│           HUB (Resource Group)                │
│                                               │
│  ┌──────────────┐  ┌──────────────────────┐  │
│  │ Function App  │  │ Storage Account      │  │
│  │ (Az-Stamper)  │  │  └─ config/          │  │
│  │               │  │     └─ stamper.json   │  │
│  │ Global config │  │       (optional       │  │
│  │ in app settings│ │        overrides)     │  │
│  └───────────────┘  └──────────────────────┘  │
│         ▲ receives events                     │
└─────────┼─────────────────────────────────────┘
          │
  ┌───────┴───────┐  ┌───────────────┐
  │ Sub A (spoke)  │  │ Sub B (spoke) │  ... up to ~15
  │ EG Topic+Sub   │  │ EG Topic+Sub  │
  │ RBAC grants    │  │ RBAC grants   │
  └────────────────┘  └───────────────┘
```

### Hub (One-Time Platform Team Deployment)

Deployed via existing `main.bicep` with additions:

- Creates `config` blob container in the storage account
- Outputs `functionAppId` and `functionAppPrincipalId` for spoke enrollment
- Seeds an empty/default `stamper.json` (optional — function works without it)
- Global tag defaults remain in Function App settings (`StamperConfig`)

### Spoke (Per-Subscription Enrollment)

Deployed via new `enroll.bicep` with Deploy-to-Azure button:

**Parameters:**
- `functionAppResourceId` — resource ID of the hub function app
- `functionAppPrincipalId` — MSI object ID of the hub function app

**Resources created:**
- Event Grid System Topic (`Microsoft.EventGrid/systemTopics`) — source is the subscription
- Event Subscription — filters `ResourceWriteSuccess`, excludes deployments, destination is the function app
- RBAC role assignments — Reader + Tag Contributor for the function MSI on the subscription

### Unenrollment

Unenrollment is handled via Azure CLI commands (not Bicep, since Bicep deployments are additive and cannot delete resources):

```bash
# Delete Event Grid resources
az eventgrid system-topic delete --name az-stamper-topic --subscription <sub-id>
# Delete RBAC role assignments
az role assignment delete --assignee <functionAppPrincipalId> --scope /subscriptions/<sub-id>
```

A convenience script (`scripts/unenroll.ps1`) wraps these commands with validation and confirmation prompts.

---

## Configuration Model

### Global Defaults (App Settings — Existing)

Unchanged from current implementation. The `StamperConfig` in app settings defines the baseline tag map and ignore patterns that apply to all subscriptions.

### Per-Subscription Overrides (Blob — New)

Optional `config/stamper.json` in the hub storage account:

```json
{
  "subscriptions": {
    "<subscription-id>": {
      "displayName": "Production",
      "enabled": true,
      "tagOverrides": {
        "Environment": { "value": "Production", "overwrite": false },
        "CostCenter": { "value": "CC-1234", "overwrite": false }
      },
      "resourceTypeRules": {
        "Microsoft.Compute/virtualMachines": {
          "additionalTags": {
            "ManagedBy": { "value": "InfraTeam", "overwrite": false }
          }
        },
        "Microsoft.Storage/storageAccounts": {
          "excludeTags": ["CostCenter"]
        }
      },
      "additionalIgnorePatterns": []
    }
  }
}
```

### Config Resolution Order

For each incoming event:

1. Start with global `StamperConfig.TagMap` (app settings)
2. Look up subscription ID in `stamper.json`
   - If not found → use global defaults only (auto-discovery)
   - If found and `enabled: false` → skip the event entirely
3. Merge `tagOverrides` into the tag map (subscription tags add to or override globals)
4. Apply `resourceTypeRules` for the event's resource type:
   - `additionalTags` — merged into the tag map
   - `excludeTags` — removed from the tag map for this resource
5. Combine global `IgnorePatterns` + subscription's `additionalIgnorePatterns`
6. Pass merged config to `StampOrchestrator` for processing

### Config Loading

- `BlobSubscriptionConfigProvider` loads `stamper.json` at startup
- In-memory cache with configurable TTL (default: 5 minutes)
- If blob doesn't exist or read fails → all subscriptions get global defaults
- No blob lease/locking needed (read-only, small file, eventual consistency is acceptable)

### Config Validation

- `stamper.schema.json` — JSON Schema file for IDE autocomplete and validation
- Documents all properties, types, and valid patterns
- Referenced in docs so users get editor support when editing `stamper.json`

---

## Code Changes

### New Files — AzStamper.Core

| File | Purpose |
|------|---------|
| `Models/SubscriptionConfig.cs` | Per-subscription config: `displayName`, `enabled`, `tagOverrides`, `resourceTypeRules`, `additionalIgnorePatterns` |
| `Models/ResourceTypeRule.cs` | Resource-type filtering: `additionalTags`, `excludeTags` |
| `Models/StamperRuleSet.cs` | Merged config for a single event (result of resolution order) |
| `Services/ISubscriptionConfigProvider.cs` | Interface: `Task<SubscriptionConfig?> GetConfigAsync(string subscriptionId)` |
| `Services/BlobSubscriptionConfigProvider.cs` | Reads `stamper.json` from blob, caches with TTL, fallback to null (→ global defaults) |
| `Services/ConfigResolver.cs` | Implements the resolution order: merge globals + sub overrides + resource-type rules into `StamperRuleSet` |

### Modified Files — AzStamper.Core

| File | Change |
|------|--------|
| `StampOrchestrator.cs` | Accept `ISubscriptionConfigProvider` and `ConfigResolver`. Extract subscription ID from resource ID. Resolve per-event config. Use `StamperRuleSet` instead of global `StamperConfig` for tag decisions. |
| `Models/StamperConfig.cs` | No structural changes. Continues to serve as the global default. |

### Modified Files — AzStamper.Functions

| File | Change |
|------|--------|
| `Program.cs` | Register `ISubscriptionConfigProvider` → `BlobSubscriptionConfigProvider` in DI. Add blob container URI config. |
| `ResourceStamperFunction.cs` | Extract subscription ID from `resourceId` in event data. Pass to orchestrator. |

### New Files — Infrastructure

| File | Purpose |
|------|---------|
| `infra/enroll.bicep` | Subscription-scoped spoke enrollment: Event Grid System Topic + Event Subscription + RBAC |
| `scripts/unenroll.ps1` | PowerShell convenience script: removes Event Grid + RBAC for a subscription with validation |
| `infra/modules/enrollment.bicep` | Shared module for Event Grid + RBAC resources |

### Modified Files — Infrastructure

| File | Change |
|------|--------|
| `infra/main.bicep` | Create `config` blob container. Output `functionAppId` and `functionAppPrincipalId` for enrollment. |
| `infra/modules/functionApp.bicep` | Add `ConfigBlobUri` app setting pointing to the config container. |

### New Files — Tests

| File | Coverage |
|------|----------|
| `tests/AzStamper.Core.Tests/ConfigResolverTests.cs` | Resolution order: defaults only, with overrides, with resource-type rules, with excludeTags, disabled subscription |
| `tests/AzStamper.Core.Tests/BlobSubscriptionConfigProviderTests.cs` | Load config, cache TTL, missing blob fallback, malformed JSON handling |
| `tests/AzStamper.Core.Tests/StampOrchestratorMultiSubTests.cs` | End-to-end: known sub with overrides, unknown sub gets defaults, disabled sub skipped |

### New Files — Other

| File | Purpose |
|------|---------|
| `stamper.schema.json` | JSON Schema for `stamper.json` config validation |

---

## Monitoring & Visibility

### Structured Logging (New)

Add custom dimensions to all Application Insights log entries:

- `SubscriptionId` — which subscription the event came from
- `ResourceType` — the Azure resource type being tagged
- `TagsApplied` — comma-separated list of tag names applied
- `ConfigSource` — `global` or `subscription-override`
- `Outcome` — `tagged`, `skipped-ignore`, `skipped-disabled`, `skipped-no-caller`, `error`

### KQL Query Templates (Docs)

Provide ready-made queries for common questions:

```kql
// Enrolled subscriptions (active in last 24h)
customEvents
| where timestamp > ago(24h)
| summarize EventCount=count() by tostring(customDimensions.SubscriptionId)
| order by EventCount desc

// Tag success/failure rate by subscription
customEvents
| where timestamp > ago(7d)
| summarize
    Tagged=countif(customDimensions.Outcome == "tagged"),
    Skipped=countif(customDimensions.Outcome startswith "skipped"),
    Errors=countif(customDimensions.Outcome == "error")
  by tostring(customDimensions.SubscriptionId)
```

### Future: Azure Workbook (Deferred)

A shared Workbook template visualizing the KQL queries. Tracked as a future milestone item.

---

## Enrollment Experience

### Deploy-to-Azure Button

README includes a button that opens the Azure Portal with pre-filled parameters:

```markdown
[![Deploy to Azure](https://aka.ms/deploytoazurebutton)](https://portal.azure.com/#create/Microsoft.Template/uri/<encoded-enroll-template-uri>)
```

**User flow:**
1. Click "Enroll My Subscription" button in README
2. Azure Portal opens with the enrollment template
3. User selects their subscription
4. User pastes `functionAppPrincipalId` (provided in hub deployment outputs / README)
5. Click Deploy → Event Grid + RBAC created in ~60 seconds
6. Events start flowing to the centralized function app immediately

### Unenrollment

Documented as CLI commands and a PowerShell convenience script (`scripts/unenroll.ps1`) that handles validation and cleanup.

---

## Backlog — Sprint 2: Multi-Subscription

### New Issues

1. `feat: add subscription config model and resolution logic`
2. `feat: implement BlobSubscriptionConfigProvider with caching`
3. `feat: update StampOrchestrator for per-subscription config resolution`
4. `feat: create enroll.bicep spoke enrollment template`
5. `feat: create unenroll.ps1 spoke removal script`
6. `feat: add Deploy-to-Azure button and enrollment documentation`
7. `feat: add structured logging with subscription/resource dimensions`
8. `docs: provide KQL query templates for monitoring enrolled subscriptions`
9. `feat: add stamper.schema.json for config validation`
10. `chore: update main.bicep to create config container and output enrollment params`

### Existing Open Issues (Sprint 1 Carryover)

- #17: `fix: add null check for ResourceEvent parameter in ProcessAsync`
- #16: `fix: truncate tag values exceeding 256 character limit`
- #15: `fix: check tag count before writing to avoid 50-tag limit errors`
- #14: `feat: expand default ignore list with untaggable resource types`

**Recommendation:** Resolve #14–17 before or in parallel with Sprint 2. They are small, independent fixes.

### Future Milestones

- **Sprint 3 — Management & Observability:** Azure Workbook dashboard, config management CLI tool
- **Sprint 4 — Marketplace Preparation:** `createUiDefinition.json`, managed app packaging, Microsoft Partner registration, pricing model

---

## Verification Plan

1. `dotnet build Az-Stamper.sln` — all projects compile
2. `dotnet test Az-Stamper.sln` — all existing + new tests pass
3. `az bicep build --file infra/enroll.bicep` — enrollment template validates
4. Verify `scripts/unenroll.ps1` runs with `-WhatIf` against a test subscription
5. Deploy hub to a dev resource group
6. Enroll a dev subscription using the Deploy-to-Azure button
7. Create a test resource → verify default tags applied
8. Add subscription overrides in `stamper.json` → create another resource → verify custom tags
9. Unenroll the subscription → verify Event Grid removed
10. Verify Application Insights shows structured log entries with subscription dimensions
