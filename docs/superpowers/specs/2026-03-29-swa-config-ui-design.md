# Az-Stamper Config Management SWA — Design Spec

**Date:** 2026-03-29
**Status:** Approved
**Issue:** #32

## Problem

Per-subscription tag configuration is managed by editing `stamper.json` in Azure Blob Storage. This requires Storage Explorer or CLI access, JSON knowledge, and offers no preview of how rules will affect resources. There's also no visibility into tagging activity without writing KQL queries manually.

## Goal

Build a Static Web App (SWA) that provides:

- A GUI for managing per-subscription tag overrides and resource-type rules
- A **filter simulation** that previews which resources would be tagged with which rules before saving
- A lightweight activity feed showing recent tagging outcomes
- Entra ID authentication with the user's own delegated permissions

## Non-Goals

- Custom backend / Azure Functions API (uses user's token directly)
- Full monitoring dashboard (separate Workbook in #33)
- CLI-based config management (separate tool in #34)
- Multi-tenant / cross-tenant support

---

## Architecture

```
Browser (user)
  │ Entra ID sign-in via MSAL.js
  │
  ├── Blob Storage REST API (read/write stamper.json)
  │     └── User needs: Storage Blob Data Contributor on config container
  │
  ├── Azure Resource Graph API (query resources for simulation)
  │     └── User needs: Reader on target subscriptions
  │
  └── Azure Monitor REST API (query App Insights for activity feed)
        └── User needs: Reader on App Insights resource
```

**Key decisions:**
- **No backend**: The SWA is purely static. All Azure API calls use the signed-in user's delegated access token acquired via MSAL.js.
- **No framework**: Vanilla HTML/CSS/JS. No build step, no node_modules. MSAL.js is the only external dependency (loaded from CDN).
- **Single repo**: Lives in `swa/` inside the Az-Stamper repo. Same PR flow, shared CI.

### Required Permissions

| Role | Scope | Purpose |
|------|-------|---------|
| Storage Blob Data Contributor | Config blob container | Read/write `stamper.json` |
| Reader | Target subscriptions | Query Resource Graph for simulation |
| Reader | App Insights resource | Query activity logs for activity feed |

---

## Tech Stack

- **Frontend:** HTML, CSS, JavaScript (vanilla, no framework)
- **Auth:** MSAL.js 2.x (loaded from CDN)
- **APIs:** Azure Blob REST API, Azure Resource Graph REST API, Azure Monitor REST API
- **Hosting:** Azure Static Web Apps (free tier)
- **Infrastructure:** Bicep module (`infra/modules/swa.bicep`)
- **Dev:** Azure SWA CLI (`swa start`) for local development

---

## File Structure

```
swa/
├── index.html                    — Shell with top tab navigation
├── css/
│   └── styles.css                — Single stylesheet, dark theme
├── js/
│   ├── auth.js                   — MSAL.js init, token acquisition, sign-in/out
│   ├── config.js                 — Load/save stamper.json via Blob REST API
│   ├── tabs/
│   │   ├── subscriptions.js      — Subscription list tab
│   │   ├── rules.js              — Tag rule editor tab
│   │   ├── simulate.js           — Filter simulation tab
│   │   └── activity.js           — Activity feed tab
│   └── utils.js                  — Shared helpers (API calls, formatting, DOM)
├── staticwebapp.config.json      — SWA config (auth routes, fallback)
└── package.json                  — SWA CLI dev dependency only (no build step)
```

### Infrastructure

```
infra/
├── modules/
│   └── swa.bicep                 — Static Web App resource + GitHub integration
└── main.bicep                    — Updated to include SWA module
```

---

## UI Design

### Layout

Top tab navigation with 4 tabs. Full-width content area below. Dark theme consistent with Azure Portal aesthetic.

```
┌─────────────────────────────────────────────────────────────┐
│ ⚡ Az-Stamper    [Subscriptions] [Tag Rules] [Simulate] [Activity]   user@dz9m.com  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Tab content area (full width)                              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Tab 1: Subscriptions

Displays all subscriptions from `stamper.json` as cards.

**Card contents:**
- Subscription display name and ID
- Enabled/disabled toggle
- Tag override count and resource rule count
- Click to navigate to Tag Rules tab for that subscription

**Actions:**
- "Add Subscription" button → form with subscription ID and display name
- Toggle enabled/disabled → saves immediately to blob
- Remove subscription → confirmation dialog, then saves

### Tab 2: Tag Rules

**Layout:**
- Subscription selector dropdown at the top
- Two sections below:

**Section A — Global Defaults (read-only display)**
- Shows the global tag map from function app settings
- Purpose: context for what defaults apply before overrides

**Section B — Subscription Overrides (editable)**
- Tag overrides: form rows with tag name, value template (with `{caller}`, `{timestamp}` autocomplete), overwrite toggle
- Resource-type rules: expandable sections per resource type, each with additional tags and exclude tags
- Additional ignore patterns: list with add/remove
- "Save" button → validates against `stamper.schema.json`, writes to blob
- "Reset" button → reverts to last saved state

### Tab 3: Simulate

**Controls:**
- Subscription dropdown
- Resource type filter dropdown (optional, populated from Resource Graph)
- "Run Simulation" button

**Results:**
- Summary bar: "N resources queried · M would be tagged · K ignored"
- Table with columns: Resource Name, Type, Current Tags, Projected Tags, Change
- Color coding:
  - Green: new tag being added
  - Amber: tag excluded by resource-type rule
  - Grey/dimmed: resource ignored by ignore pattern
- "Export CSV" button for the results

**How simulation works:**
1. Query Azure Resource Graph for resources in the selected subscription (with optional type filter)
2. For each resource, read its existing tags from the Resource Graph response
3. Apply the tag rule resolution logic client-side (same algorithm as C# `ConfigResolver`):
   - Start with global defaults
   - Merge subscription overrides
   - Apply resource-type rules (add/exclude)
   - Check ignore patterns
4. Display the diff between current and projected tags

### Tab 4: Activity

**Controls:**
- Time range selector: Last 1 hour, 24 hours, 7 days

**Feed:**
- Queries Azure Monitor REST API (`/query` endpoint) against the App Insights workspace
- KQL query returns: timestamp, resource ID, subscription ID, outcome, tags applied
- Displayed as a sortable table
- Outcome column color-coded: green (tagged), yellow (skipped), red (error)

---

## Auth Flow

1. Page loads → `auth.js` initializes MSAL.js with the Entra ID app registration's client ID
2. Check for cached session → if signed in, show user name in header
3. If not signed in → show sign-in button, redirect to Entra ID on click
4. On successful auth → acquire access tokens:
   - `https://management.azure.com/.default` — for Resource Graph and Monitor APIs
   - `https://storage.azure.com/.default` — for Blob Storage API
5. Tokens cached by MSAL.js, auto-refreshed on expiry
6. Sign-out button clears session

**Entra ID App Registration:**
- Single-page application (SPA) platform
- Redirect URI: `https://<swa-hostname>/.auth/login/aad/callback`
- API permissions: `user_impersonation` on Azure Management, `user_impersonation` on Azure Storage
- No client secret needed (public client / authorization code + PKCE)

---

## Configuration

### `staticwebapp.config.json`

```json
{
  "navigationFallback": {
    "rewrite": "/index.html"
  },
  "globalHeaders": {
    "Content-Security-Policy": "default-src 'self'; script-src 'self' https://alcdn.msauth.net; connect-src 'self' https://*.blob.core.windows.net https://management.azure.com https://api.loganalytics.io"
  }
}
```

### Environment Variables (SWA Application Settings)

| Setting | Purpose |
|---------|---------|
| `AZURE_CLIENT_ID` | Entra ID app registration client ID |
| `AZURE_TENANT_ID` | Entra ID tenant ID |
| `CONFIG_BLOB_URL` | Full URL to `stamper.json` blob |
| `APP_INSIGHTS_ID` | Application Insights resource ID (for activity queries) |

These are injected at runtime via a `config.json` endpoint or embedded in the HTML.

---

## Bicep Infrastructure

### `infra/modules/swa.bicep`

Creates:
- `Microsoft.Web/staticSites` resource (free tier)
- Linked to GitHub repo for CI/CD (branch: `main`, app location: `swa/`)
- Application settings for client ID, tenant ID, blob URL, App Insights ID

### `infra/main.bicep` changes

- Add `swa` module invocation
- Pass storage account name and App Insights resource ID to the SWA module

---

## Verification Plan

1. `swa start swa/` — local dev server runs and serves the app
2. Sign in with Entra ID → user name displayed in header
3. Subscriptions tab shows entries from `stamper.json`
4. Add/edit/remove subscription → changes persisted to blob
5. Tag Rules tab shows global defaults + editable overrides
6. Save tag rules → validated against schema, written to blob
7. Simulate tab queries real resources from Resource Graph
8. Simulation results show correct projected tags with color coding
9. Activity tab shows recent tagging events from App Insights
10. `az bicep build --file infra/main.bicep` — validates with SWA module
