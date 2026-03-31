# SWA Auth Bootstrap — Design Spec

## Problem

The SWA config UI requires an Entra ID app registration for MSAL authentication and an `app-config.js` file connecting it to deployed Azure resources. One-click Deploy-to-Azure users have no CI/CD pipeline to generate these — the SWA shows a placeholder page.

## Solution

A single PowerShell script `scripts/Setup-SwaAuth.ps1` that bootstraps everything in one command.

## Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `ResourceGroupName` | `rg-az-stamper` | Resource group containing the Az-Stamper hub |
| `FunctionAppName` | `func-az-stamper` | Name of the function app (SWA name derived as `{FunctionAppName}-config`) |
| `AppDisplayName` | `Az-Stamper-SWA` | Display name for the Entra ID app registration |

All other values are auto-discovered from the deployed resources.

## Script Flow

### Step 1: Prerequisites check

Fail early with clear messages if:
- `Az` PowerShell module is not imported
- Not connected to Azure (`Get-AzContext` returns null)
- `npx` is not on PATH
- Resource group or expected resources don't exist

### Step 2: Discover resources from RG

Query the deployed resources to extract:
- **SWA hostname**: `Get-AzStaticWebApp -ResourceGroupName $rg -Name "$FunctionAppName-config"` → `DefaultHostname`
- **Storage account name**: `Get-AzStorageAccount -ResourceGroupName $rg` → first result's `StorageAccountName`
- **App Insights resource ID**: `Get-AzApplicationInsights -ResourceGroupName $rg` → `Id`
- **SWA deployment token**: `Get-AzStaticWebAppSecret` → `ApiKey`

### Step 3: Entra ID app registration (idempotent)

- Search for existing app: `Get-AzADApplication -DisplayName $AppDisplayName`
- **If found**: Update the SPA redirect URI to `https://{swaHostname}` if it changed
- **If not found**: Create new app registration:
  - `New-AzADApplication -DisplayName $AppDisplayName -SPARedirectUri "https://{swaHostname}"`
  - No API permissions needed — the SWA acquires delegated tokens for Azure Management and Storage scopes via MSAL interactive login
- Extract `clientId` (AppId) and `tenantId` from context

### Step 4: Generate `app-config.js`

Write `swa/js/app-config.js`:

```javascript
window.AZ_STAMPER_CONFIG = {
  clientId: '<appId>',
  tenantId: '<tenantId>',
  configBlobUrl: 'https://<storageAccountName>.blob.core.windows.net/config/stamper.json',
  appInsightsId: '<appInsightsResourceId>'
};
```

This file is environment-specific and should be gitignored.

### Step 5: Deploy SWA content

```powershell
npx @azure/static-web-apps-cli deploy ./swa --deployment-token $token --env production
```

### Output

```
[1/4] Discovering resources in rg-az-stamper...
      SWA: witty-grass-057c9d810.6.azurestaticapps.net
      Storage: azstampersta
      App Insights: /subscriptions/.../ai-az-stamper

[2/4] Configuring Entra ID app registration...
      App: Az-Stamper-SWA (client ID: xxxxxxxx-xxxx-...)

[3/4] Generating app-config.js...
      Written to swa/js/app-config.js

[4/4] Deploying SWA content...
      ✔ Deployed to https://witty-grass-057c9d810.6.azurestaticapps.net
```

## Prerequisites

- **Az PowerShell module**: `Install-Module Az -Scope CurrentUser`
- **Node.js / npx**: Required for `@azure/static-web-apps-cli`
- **Entra ID role**: Application Administrator or Cloud Application Administrator (to create app registrations)
- **Azure connection**: `Connect-AzAccount` before running

## Files

| File | Action |
|------|--------|
| `scripts/Setup-SwaAuth.ps1` | Create — the bootstrap script |
| `swa/js/app-config.js` | Generated at runtime — add to `.gitignore` |

## Script conventions

Follows existing patterns from `scripts/unenroll.ps1`:
- `[CmdletBinding()]` with comment-based help
- PascalCase parameters, camelCase locals
- No aliases, no backtick continuations
- Clear progress output with step numbering

## Not in scope

- Automated Graph API permission grants (requires Global Admin, separate concern)
- SWA custom domain configuration
- CI/CD workflow updates (existing `deploy.yml` and `deploy-swa.yml` handle that path)
