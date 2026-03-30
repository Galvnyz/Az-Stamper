# Enrollment-Centric SWA Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the SWA Subscriptions tab around Event Grid enrollment as the source of truth, with true pause/resume toggle and global defaults visibility.

**Architecture:** Auto-discover enrolled subscriptions via ARM on tab load. Tagging toggle deletes/recreates Event Grid event subscriptions. `stamper.json` becomes optional customization, not the primary data source. Tag Rules and Simulate dropdowns populated from enrolled subs, not config keys.

**Tech Stack:** Vanilla JS (no framework), Azure ARM REST API, Event Grid API 2022-06-15, Blob Storage REST API

**Spec:** `docs/superpowers/specs/2026-03-29-enrollment-centric-swa-design.md`

---

### Task 1: Add `functionAppId` to app-config.js

The resume toggle needs the function app resource ID to recreate event subscriptions.

**Files:**
- Modify: `swa/js/app-config.js`

- [ ] **Step 1: Add functionAppId to config**

Add a `functionAppId` property to the existing `AZ_STAMPER_CONFIG` object. The value is the full ARM resource ID of the function app. This is used by the enrollment module to recreate event subscriptions when resuming tagging.

```js
window.AZ_STAMPER_CONFIG = {
  clientId: '00ec1874-7c53-406b-a0a4-85d41daf2453',
  tenantId: 'dbb4b808-f0e6-469f-92d6-9788aef52734',
  configBlobUrl: 'https://stazstamper.blob.core.windows.net/config/stamper.json',
  appInsightsId: '/subscriptions/2f2d900c-03a4-4763-8138-bed4d299a7fa/resourceGroups/rg-az-stamper/providers/microsoft.insights/components/appi-az-stamper',
  functionAppId: '/subscriptions/2f2d900c-03a4-4763-8138-bed4d299a7fa/resourceGroups/rg-az-stamper/providers/Microsoft.Web/sites/func-az-stamper'
};
```

- [ ] **Step 2: Commit**

```bash
git add swa/js/app-config.js
git commit -m "chore: add functionAppId to SWA config for Event Grid resume"
```

---

### Task 2: Create enrollment discovery module

Extract enrollment discovery into its own module so both the subscriptions tab and other tabs can access the cached enrollment data.

**Files:**
- Create: `swa/js/enrollment.js`
- Modify: `swa/index.html` (add script tag)

- [ ] **Step 1: Create `swa/js/enrollment.js`**

This module fetches all accessible subscriptions, checks Event Grid enrollment for each, determines active vs. paused status, and caches the results. It also provides `pauseEnrollment()` and `resumeEnrollment()` functions that delete/recreate Event Grid event subscriptions.

Key functions:
- `discoverEnrollment()` — returns cached enrollment data or fetches fresh
- `refreshEnrollment()` — always fetches fresh from ARM
- `checkEnrollmentDetail(subId, token)` — checks a single sub for system topic + event subscriptions
- `pauseEnrollment(sub)` — DELETEs the event subscription (stops event delivery)
- `resumeEnrollment(sub)` — PUTs a new event subscription with the standard filter config
- `invalidateEnrollmentCache()` — clears cache so next call re-fetches

Each enrolled sub object has: `{ subscriptionId, displayName, enrolled, active, systemTopicName, systemTopicRg, eventSubscriptionName, hasCustomConfig }`

The `resumeEnrollment()` function reads `functionAppId` from `window.AZ_STAMPER_CONFIG` and creates the event subscription with:
- Destination: AzureFunction endpoint at `{functionAppId}/functions/ResourceStamper`
- Filter: `ResourceWriteSuccess` events, excluding `Microsoft.Resources/deployments` and `Microsoft.Resources/tags`

All DOM content is set via `textContent` — no innerHTML usage.

- [ ] **Step 2: Add script tag to index.html**

Add after `config.js` and before `tabs/subscriptions.js`:

```html
  <script src="/js/enrollment.js"></script>
```

- [ ] **Step 3: Commit**

```bash
git add swa/js/enrollment.js swa/index.html
git commit -m "feat: add enrollment discovery module with pause/resume"
```

---

### Task 3: Rewrite subscriptions tab

Replace the config-centric subscriptions tab with the enrollment-centric version. This is a full rewrite of `swa/js/tabs/subscriptions.js`.

**Files:**
- Rewrite: `swa/js/tabs/subscriptions.js`

- [ ] **Step 1: Rewrite `subscriptions.js`**

Full replacement. The new file:

1. `loadSubscriptionsTab()` — shows loading spinner, calls `discoverEnrollment()`, then `renderSubscriptionsTab(enrolled)`
2. `renderSubscriptionsTab(enrolled)` — renders controls bar with "Enrolled Subscriptions" title and "Refresh" button, global defaults info banner, and card grid
3. `buildEnrolledCard(sub)` — builds a card for each enrolled sub with:
   - Active/Paused status badge (green/yellow)
   - Custom Config badge (blue, only if sub has stamper.json entry)
   - Override counts (if has config) or "Using global defaults" text (if no config)
   - Tagging toggle (checkbox that calls `handleTaggingToggle`)
   - "+ Add Custom Config" or "Remove Custom Config" action link
   - Card click navigates to Tag Rules
4. `handleTaggingToggle(sub, toggleInput)` — calls `pauseEnrollment()`/`resumeEnrollment()`, handles 403 errors with clear toast
5. `addCustomConfig(sub)` — creates empty stamper.json entry, refreshes
6. `openRemoveCustomConfigModal(sub)` — confirmation modal, deletes stamper.json entry on confirm
7. `navigateToRules(subId)` — same as current

Removed functions (no longer needed): `buildSubscriptionCard`, `toggleSubscription`, `openAddSubscriptionModal`, `confirmAddSubscription`, `openRemoveSubscriptionModal`, `confirmRemoveSubscription`, `verifyAllEnrollments`, `checkEventGridEnrollment`, `renderDiscoveredSubs`, `addDiscoveredToConfig`

All DOM content uses `textContent` and `createElement` — no innerHTML.

- [ ] **Step 2: Commit**

```bash
git add swa/js/tabs/subscriptions.js
git commit -m "feat: rewrite subscriptions tab as enrollment-centric with pause/resume toggle"
```

---

### Task 4: Add info-banner CSS class

The global defaults banner needs a new CSS class.

**Files:**
- Modify: `swa/css/styles.css`

- [ ] **Step 1: Add `.info-banner` styles**

Add after the existing `.sign-in-prompt` section (around line 782):

```css
/* ------------------------------------------------------------
   Info Banner
   ------------------------------------------------------------ */
.info-banner {
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 12px 16px;
  margin-bottom: 20px;
}
```

- [ ] **Step 2: Commit**

```bash
git add swa/css/styles.css
git commit -m "feat: add info-banner CSS class for global defaults banner"
```

---

### Task 5: Update Tag Rules dropdown to use enrolled subs

The Tag Rules dropdown currently reads from `stamper.json` keys. Change it to read from the enrollment cache, and show global defaults read-only for unconfigured subs.

**Files:**
- Modify: `swa/js/tabs/rules.js`

- [ ] **Step 1: Update `renderRulesTab` dropdown population**

Change the subscription data source from `config.subscriptions` keys to the enrollment cache `_enrollmentCache`. Build a `subDisplayNames` lookup from both enrollment cache and config for display.

When an unconfigured sub is selected (no stamper.json entry), render:
1. An info banner: "This subscription uses global defaults only — no custom overrides configured. Add custom config"
2. A read-only "Effective Tag Map" section showing the 5 global default tags with overwrite chips
3. Return early (no editable overrides section)

The "Add custom config" link creates a stamper.json entry and re-renders the tab with the editable view.

Update empty state text from "No subscriptions configured" to "No enrolled subscriptions" with enroll.bicep guidance.

Change the prompt-to-select check from `!subs[selectedSubId]` to just `!selectedSubId` since subs without config are now valid selections.

All DOM content uses `textContent` and `createElement` — no innerHTML.

- [ ] **Step 2: Commit**

```bash
git add swa/js/tabs/rules.js
git commit -m "feat: populate Tag Rules dropdown from enrollment, show global defaults for unconfigured subs"
```

---

### Task 6: Update Simulate dropdown to use enrolled subs

Same dropdown change as Tag Rules but in the simulate tab.

**Files:**
- Modify: `swa/js/tabs/simulate.js`

- [ ] **Step 1: Update dropdown population**

Change the simulate tab's subscription data source from `config.subscriptions` keys to enrollment cache, matching the same pattern as Task 5. Build `subDisplayNames` from both sources. Update option text to use `subDisplayNames[subId]` instead of `subs[subId].displayName`.

- [ ] **Step 2: Commit**

```bash
git add swa/js/tabs/simulate.js
git commit -m "feat: populate Simulate dropdown from enrollment cache"
```

---

### Task 7: End-to-end verification

**Files:** None (testing only)

- [ ] **Step 1: Verify Subscriptions tab auto-discovers**

Open SWA, sign in. Subscriptions tab should show "Discovering enrolled subscriptions..." then display both sub-lab and sub-galvnyz-web with Active badges and the global defaults banner.

- [ ] **Step 2: Verify pause/resume toggle**

Toggle OFF for one sub. Expected: badge changes to "Paused", card dims, toast shows "Tagging paused for {name}". Toggle ON. Expected: badge returns to "Active", toast shows "Tagging resumed". Check Azure Portal to confirm event subscription was deleted/recreated under the system topic.

- [ ] **Step 3: Verify Add/Remove Custom Config**

Click "+ Add Custom Config" on a sub without config. Expected: card shows "Custom Config" badge and override counts (0/0). Click "Remove Custom Config". Expected: confirmation modal, on confirm card returns to "Using global defaults" text.

- [ ] **Step 4: Verify Tag Rules for unconfigured sub**

Switch to Tag Rules, select a sub without custom config from the dropdown. Expected: info banner with "global defaults only" message and read-only tag map grid showing 5 default tags. Click "Add custom config" link. Expected: page reloads with editable overrides sections.

- [ ] **Step 5: Verify Simulate dropdown**

Switch to Simulate tab. Expected: dropdown shows all enrolled subs, not just those with stamper.json entries. Select an unconfigured sub and run simulation. Expected: simulation uses global defaults.

- [ ] **Step 6: Final commit and push**

```bash
git push
```
