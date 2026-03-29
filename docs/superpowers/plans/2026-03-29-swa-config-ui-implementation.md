# Az-Stamper Config Management SWA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Static Web App that provides a GUI for managing per-subscription tag config, filter simulation, and activity monitoring for Az-Stamper.

**Architecture:** Pure static SWA (vanilla HTML/CSS/JS) hosted in Azure. MSAL.js for Entra ID auth. Calls Azure Blob, Resource Graph, and Monitor REST APIs directly using the user's delegated token. No backend, no framework, no build step.

**Tech Stack:** HTML, CSS, JavaScript (vanilla), MSAL.js 2.x (CDN), Azure SWA CLI, Bicep

**XSS Note:** All user-facing content uses `escapeHtml()` or `textContent` for safe rendering. The `html()` helper is only used with developer-controlled template strings, never with raw user input.

---

## File Map

### New Files

| File | Responsibility |
|------|---------------|
| `swa/index.html` | App shell: header with tabs, content container, script imports |
| `swa/css/styles.css` | Dark theme stylesheet, layout, cards, tables, forms, tabs |
| `swa/js/auth.js` | MSAL.js initialization, sign-in/sign-out, token acquisition |
| `swa/js/config.js` | Load/save stamper.json via Blob Storage REST API |
| `swa/js/utils.js` | Shared DOM helpers, API fetch wrapper, formatting |
| `swa/js/tabs/subscriptions.js` | Subscription list tab: cards, add/remove/toggle |
| `swa/js/tabs/rules.js` | Tag rule editor: overrides, resource-type rules, save/reset |
| `swa/js/tabs/simulate.js` | Filter simulation: Resource Graph query, config resolution, diff table |
| `swa/js/tabs/activity.js` | Activity feed: App Insights query, sortable results table |
| `swa/staticwebapp.config.json` | SWA routing and CSP headers |
| `swa/package.json` | SWA CLI dev dependency (no build step) |
| `infra/modules/swa.bicep` | Static Web App Bicep module |

### Modified Files

| File | Change |
|------|--------|
| `infra/main.bicep` | Add SWA module invocation |
| `.gitignore` | Add `.superpowers/` |

---

## 9 Tasks

### Task 1: Project Scaffold (index.html, styles.css, SWA config, package.json)
### Task 2: Auth Module (MSAL.js sign-in/sign-out/token)
### Task 3: Utils + Config Module (DOM helpers, Blob API)
### Task 4: Subscriptions Tab (card list, add/remove/toggle)
### Task 5: Tag Rules Tab (overrides editor, resource-type rules, save/reset)
### Task 6: Simulate Tab (Resource Graph query, tag projection, diff table, CSV export)
### Task 7: Activity Tab (App Insights query, sortable event table)
### Task 8: SWA Bicep Module (infra/modules/swa.bicep + main.bicep integration)
### Task 9: Documentation + Backlog (.gitignore, commit plan)

Full task details with complete code are in the approved design spec and were presented during brainstorming. Each task creates 1-2 files, verifies, and commits. The implementation plan follows the spec exactly — see `docs/superpowers/specs/2026-03-29-swa-config-ui-design.md` for complete file contents.

---

## Verification Checklist

- [ ] `swa/index.html` opens in browser and shows sign-in prompt
- [ ] Tab navigation switches between 4 panels
- [ ] CSS dark theme renders correctly
- [ ] `az bicep build --file infra/main.bicep` validates
- [ ] All JS files load without console errors
- [ ] Auth flow: sign in, tabs visible, sign out, prompt returns
- [ ] Subscriptions tab: add/remove/toggle subscription, saves to blob
- [ ] Rules tab: edit overrides, save, persisted
- [ ] Simulate tab: query resources, see projected tags
- [ ] Activity tab: query App Insights, see recent events
