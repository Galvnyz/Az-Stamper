# SWA Redesign: Enrollment-Centric Model

**Date:** 2026-03-29
**Status:** Approved
**Scope:** SWA frontend (subscriptions.js, rules.js, simulate.js, styles.css) + minor config.js changes

## Problem

The SWA treats `stamper.json` subscriptions as the entire world, but the function tags **every** enrolled subscription regardless of config presence. This creates three UX failures:

1. **Invisible tagging**: Subscriptions enrolled via `enroll.bicep` but not in `stamper.json` are tagged silently without appearing in the UI.
2. **Misleading toggle**: The "Enabled" switch disables config overrides, not tagging. Both subs in the screenshot showed "disabled" while tags were still being applied.
3. **"Add Subscription" misnomer**: The button implies adding a sub to tagging, but it only creates a config entry. Tagging is controlled by Event Grid enrollment, not config.

## Design: Enrollment as Source of Truth

### Core Principle

Event Grid enrollment determines what's being tagged. `stamper.json` is an optional customization layer, not a prerequisite for visibility.

### Subscriptions Tab

**On load** (auto-discover, no manual refresh needed):

1. `GET /subscriptions` — all accessible subscriptions
2. For each sub, `GET /subscriptions/{id}/providers/Microsoft.EventGrid/systemTopics` — find topics with `topicType == Microsoft.Resources.Subscriptions` (case-insensitive)
3. For enrolled subs, `GET .../systemTopics/{name}/eventSubscriptions` — determine active vs. paused
4. Load `stamper.json` from blob — determine which subs have custom config
5. Cache results for the session; "Refresh" button re-fetches

**Card states** (per enrolled subscription):

| Event Subscription | stamper.json entry | Card shows |
|--------------------|--------------------|------------|
| Exists | No | Active, "Using global defaults", "+ Add Custom Config" |
| Exists | Yes | Active, override counts, "Remove Custom Config" |
| Deleted | No | Paused, "Event Grid delivery paused" |
| Deleted | Yes | Paused, preserves config for when resumed |

**Tagging toggle** (per-subscription, in card footer):

- **ON → OFF (Pause)**: `DELETE` the event subscription under the system topic. System topic is preserved. Requires `EventGrid Contributor` RBAC on the target subscription.
- **OFF → ON (Resume)**: `PUT` the event subscription with the standard configuration (see below). Same RBAC requirement.
- **403 error**: Toast with "Insufficient permissions — EventGrid Contributor required on this subscription". Toggle reverts.

**Event subscription config for resume** (matches `eventGrid.bicep`):

```json
{
  "properties": {
    "destination": {
      "endpointType": "AzureFunction",
      "properties": {
        "resourceId": "{functionAppId}/functions/ResourceStamper"
      }
    },
    "filter": {
      "includedEventTypes": ["Microsoft.Resources.ResourceWriteSuccess"],
      "advancedFilters": [{
        "operatorType": "StringNotContains",
        "key": "data.operationName",
        "values": ["Microsoft.Resources/deployments", "Microsoft.Resources/tags"]
      }]
    }
  }
}
```

The `functionAppId` is needed for resume. Source it from `window.AZ_STAMPER_CONFIG.functionAppId` (new config field to add to `app-config.js`).

**Naming conventions** (from Bicep defaults):

- System topic: `evgt-az-stamper` (parameterized, may vary per enrollment)
- Event subscription: `evgs-az-stamper` (parameterized, may vary)
- Since names may vary, discovery must enumerate rather than assume names.

**"+ Add Subscription" removed**. Replaced with:
- "+ Add Custom Config" on each enrolled sub's card (creates a `stamper.json` entry with empty overrides)
- "Remove Custom Config" on configured subs (deletes the `stamper.json` entry, sub continues with global defaults)

**Global defaults banner**: A persistent info bar above the card grid showing the global tag names (Creator, CreatedOn, etc.) with a "View in Tag Rules" link.

### Tag Rules Tab

**Subscription dropdown**: Populated from enrolled subscriptions (same data as Subscriptions tab), not from `stamper.json` keys.

**For unconfigured subs**: Show an info banner ("Using global defaults — no custom overrides") and render the global tag map as a read-only grid. Include an "Add custom config" link.

**For configured subs**: Current behavior — editable tag overrides, resource type rules, ignore patterns. The global defaults section is still shown but overridden entries are highlighted.

### Simulate Tab

**Subscription dropdown**: Same change as Tag Rules — populated from enrolled subs.

No other changes needed; simulation logic already works with global defaults when no config entry exists.

### Files Changed

| File | Changes |
|------|---------|
| `swa/js/tabs/subscriptions.js` | Full rewrite — enrollment-centric cards, tagging toggle, auto-discover on load |
| `swa/js/tabs/rules.js` | Dropdown source → enrolled subs; read-only global defaults view for unconfigured subs |
| `swa/js/tabs/simulate.js` | Dropdown source → enrolled subs (minor change) |
| `swa/js/app-config.js` | Add `functionAppId` field for event subscription resume |
| `swa/css/styles.css` | New styles: info banner, paused card state, global defaults bar |

### Not Changed

- **Backend (StampOrchestrator, ConfigResolver)**: No changes. The function already handles missing config (falls back to global defaults) and respects `Enabled=false`.
- **stamper.json schema**: No changes. Custom config entries remain the same structure.
- **Bicep/infra**: No changes. Event Grid resources deployed as-is.
- **Activity tab**: No changes.

## Verification

1. **Auto-discover**: Sign in → Subscriptions tab loads both enrolled subs automatically (no manual add)
2. **Pause/Resume**: Toggle OFF → confirm event subscription deleted via Azure Portal → toggle ON → confirm recreated
3. **RBAC enforcement**: Sign in as user without EventGrid Contributor → toggle should error with clear message
4. **Tag Rules for unconfigured sub**: Select a sub without stamper.json entry → see global defaults read-only
5. **Add/Remove Custom Config**: Click "Add Custom Config" → stamper.json entry created → Tag Rules becomes editable → "Remove Custom Config" → entry deleted, falls back to read-only defaults
6. **Simulate for unconfigured sub**: Select unconfigured sub → simulation runs with global defaults
