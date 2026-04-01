// Configuration Tab — unified page: global defaults + enrolled subscriptions + inline config editing
// Replaces both the old subscriptions.js and rules.js (Tag Rules tab removed)

// ── Track which inline editor is currently open ─────────────────────────────
var _openEditorSubId = null;

// ── Tag rule templates ──────────────────────────────────────────────────────
var TAG_TEMPLATES = [
  {
    name: 'Cost Allocation',
    description: 'CostCenter, Department, BudgetOwner',
    tags: {
      CostCenter:  { value: '', overwrite: false },
      Department:  { value: '', overwrite: false },
      BudgetOwner: { value: '', overwrite: false },
    },
  },
  {
    name: 'Compliance',
    description: 'DataClassification, ComplianceScope, RetentionPolicy',
    tags: {
      DataClassification: { value: '', overwrite: false },
      ComplianceScope:    { value: '', overwrite: false },
      RetentionPolicy:    { value: '', overwrite: false },
    },
  },
  {
    name: 'Operations',
    description: 'Environment, ManagedBy, SLA',
    tags: {
      Environment: { value: '', overwrite: false },
      ManagedBy:   { value: '', overwrite: false },
      SLA:         { value: '', overwrite: false },
    },
  },
];

async function loadSubscriptionsTab() {
  var panel = document.getElementById('panel-subscriptions');
  panel.textContent = '';

  var loading = document.createElement('div');
  loading.className = 'loading-state';
  var spinner = document.createElement('div');
  spinner.className = 'spinner';
  var loadingText = document.createElement('span');
  loadingText.textContent = 'Discovering enrolled subscriptions\u2026';
  loading.appendChild(spinner);
  loading.appendChild(loadingText);
  panel.appendChild(loading);

  var enrolled = await discoverEnrollment();
  renderSubscriptionsTab(enrolled);
}

function renderSubscriptionsTab(enrolled) {
  var panel = document.getElementById('panel-subscriptions');
  panel.textContent = '';

  // Controls bar
  var bar = document.createElement('div');
  bar.className = 'controls-bar';

  var titleEl = document.createElement('span');
  titleEl.className = 'controls-bar-title';
  titleEl.textContent = 'Configuration';
  bar.appendChild(titleEl);

  var refreshBtn = document.createElement('button');
  refreshBtn.className = 'btn btn-secondary';
  refreshBtn.textContent = 'Refresh';
  refreshBtn.addEventListener('click', async function() {
    _openEditorSubId = null;
    invalidateEnrollmentCache();
    var fresh = await refreshEnrollment();
    renderSubscriptionsTab(fresh);
  });
  bar.appendChild(refreshBtn);

  // Export config button
  var exportBtn = document.createElement('button');
  exportBtn.className = 'btn btn-secondary';
  exportBtn.textContent = 'Export';
  exportBtn.addEventListener('click', function() {
    exportConfigFile();
  });
  bar.appendChild(exportBtn);

  // Import config button
  var importBtn = document.createElement('button');
  importBtn.className = 'btn btn-secondary';
  importBtn.textContent = 'Import';
  importBtn.addEventListener('click', function() {
    var fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json';
    fileInput.style.display = 'none';
    fileInput.addEventListener('change', function() {
      if (!fileInput.files || !fileInput.files[0]) return;
      var reader = new FileReader();
      reader.onload = function(e) {
        try {
          var parsed = JSON.parse(e.target.result);
          openImportModal(parsed);
        } catch (err) {
          showToast('Invalid JSON file: ' + err.message, 'error');
        }
      };
      reader.readAsText(fileInput.files[0]);
    });
    document.body.appendChild(fileInput);
    fileInput.click();
    document.body.removeChild(fileInput);
  });
  bar.appendChild(importBtn);

  panel.appendChild(bar);

  // ── Collapsible Help section ─────────────────────────────────────────────
  var helpSection = document.createElement('details');
  helpSection.style.cssText = 'margin-bottom:20px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-lg);';

  var helpSummary = document.createElement('summary');
  helpSummary.style.cssText = 'padding:12px 20px;cursor:pointer;font-size:0.875rem;font-weight:600;color:var(--text-primary);user-select:none;list-style:none;display:flex;align-items:center;gap:8px;';
  var helpArrow = document.createElement('span');
  helpArrow.style.cssText = 'transition:transform 150ms;display:inline-block;';
  helpArrow.textContent = '\u25B6';
  helpSummary.appendChild(helpArrow);
  helpSummary.appendChild(document.createTextNode(' How Az-Stamper configuration works'));
  helpSection.addEventListener('toggle', function() {
    helpArrow.style.transform = helpSection.open ? 'rotate(90deg)' : '';
  });

  var helpBody = document.createElement('div');
  helpBody.style.cssText = 'padding:0 20px 16px;font-size:0.8125rem;color:var(--text-secondary);line-height:1.6;';

  function buildHelpParagraph(title, text) {
    var p = document.createElement('p');
    p.style.cssText = 'margin:0 0 10px;';
    var strong = document.createElement('strong');
    strong.style.color = 'var(--text-primary)';
    strong.textContent = title;
    p.appendChild(strong);
    p.appendChild(document.createTextNode(' \u2014 ' + text));
    return p;
  }

  function buildCode(text) {
    var code = document.createElement('code');
    code.style.cssText = 'background:var(--bg-input);padding:1px 4px;border-radius:3px;';
    code.textContent = text;
    return code;
  }

  var p1 = buildHelpParagraph('Global Defaults',
    'The tag map below (Creator, CreatedOn, etc.) applies to all enrolled subscriptions. These are configured in the Function App environment settings and cannot be changed from this UI.');
  var p2 = buildHelpParagraph('Custom Overrides',
    'Click a subscription card, then "+ Add Custom Config" to override global defaults for that subscription. You can add extra tags, change overwrite behavior, add resource-type rules, and specify ignore patterns.');

  var p3 = document.createElement('p');
  p3.style.cssText = 'margin:0 0 10px;';
  var p3strong = document.createElement('strong');
  p3strong.style.color = 'var(--text-primary)';
  p3strong.textContent = 'Tag Overrides';
  p3.appendChild(p3strong);
  p3.appendChild(document.createTextNode(' \u2014 Add or replace tags for a specific subscription. Use '));
  p3.appendChild(buildCode('{caller}'));
  p3.appendChild(document.createTextNode(' for the user who created the resource or '));
  p3.appendChild(buildCode('{timestamp}'));
  p3.appendChild(document.createTextNode(' for the event time.'));

  var p4 = document.createElement('p');
  p4.style.cssText = 'margin:0 0 10px;';
  var p4strong = document.createElement('strong');
  p4strong.style.color = 'var(--text-primary)';
  p4strong.textContent = 'Resource Type Rules';
  p4.appendChild(p4strong);
  p4.appendChild(document.createTextNode(' \u2014 Target specific resource types (e.g. '));
  p4.appendChild(buildCode('Microsoft.Compute/virtualMachines'));
  p4.appendChild(document.createTextNode(') to add extra tags or exclude certain tags from being applied.'));

  var p5 = document.createElement('p');
  p5.style.cssText = 'margin:0;';
  var p5strong = document.createElement('strong');
  p5strong.style.color = 'var(--text-primary)';
  p5strong.textContent = 'Ignore Patterns';
  p5.appendChild(p5strong);
  p5.appendChild(document.createTextNode(' \u2014 Wildcard patterns for resource IDs to skip entirely. Example: '));
  p5.appendChild(buildCode('/subscriptions/*/resourceGroups/rg-infra/*'));
  p5.appendChild(document.createTextNode(' skips all resources in the rg-infra resource group.'));

  helpBody.appendChild(p1);
  helpBody.appendChild(p2);
  helpBody.appendChild(p3);
  helpBody.appendChild(p4);
  helpBody.appendChild(p5);

  helpSection.appendChild(helpSummary);
  helpSection.appendChild(helpBody);
  panel.appendChild(helpSection);

  // ── Global Default Tag Map (always visible, read-only) ──────────────────
  var globalSection = buildSection(
    'Global Default Tag Map',
    'Applied to all enrolled subscriptions unless overridden by a custom config.'
  );
  var globalBody = globalSection.querySelector('.rules-section-body');

  var globalDefaults = [
    { name: 'Creator',        value: '{caller}',    overwrite: false },
    { name: 'CreatedOn',      value: '{timestamp}', overwrite: false },
    { name: 'LastModifiedBy', value: '{caller}',    overwrite: true  },
    { name: 'LastModifiedOn', value: '{timestamp}', overwrite: true  },
    { name: 'StampedBy',      value: 'Az-Stamper',  overwrite: false },
  ];

  // Header row
  var headerRow = document.createElement('div');
  headerRow.className = 'rule-row rule-header';
  ['Tag', 'Value', 'Overwrite Existing Tags'].forEach(function(label) {
    var col = document.createElement('div');
    col.className = label === 'Tag' ? 'rule-key' : label === 'Value' ? 'rule-value' : 'rule-overwrite';
    col.textContent = label;
    headerRow.appendChild(col);
  });
  globalBody.appendChild(headerRow);

  globalDefaults.forEach(function(def) {
    var row = document.createElement('div');
    row.className = 'rule-row';

    var keyEl = document.createElement('div');
    keyEl.className = 'rule-key';
    keyEl.textContent = def.name;

    var valueEl = document.createElement('div');
    valueEl.className = 'rule-value';
    valueEl.style.fontFamily = 'monospace';
    valueEl.textContent = def.value;

    var overwriteEl = document.createElement('div');
    overwriteEl.className = 'rule-overwrite';
    overwriteEl.textContent = def.overwrite ? 'True' : 'False';
    overwriteEl.style.color = def.overwrite ? 'var(--success)' : 'var(--text-secondary)';

    row.appendChild(keyEl);
    row.appendChild(valueEl);
    row.appendChild(overwriteEl);
    globalBody.appendChild(row);
  });

  var globalNote = document.createElement('div');
  globalNote.style.cssText = 'font-size:0.8rem;color:var(--text-secondary);margin:8px 0 0;padding:0 4px;';
  globalNote.textContent = 'These defaults are configured in the Function App environment settings (StamperConfig__TagMap__*).';
  panel.appendChild(globalSection);
  panel.appendChild(globalNote);

  // ── Enrolled Subscriptions heading ──────────────────────────────────────
  var subsHeading = document.createElement('div');
  subsHeading.style.cssText = 'font-size:1rem;font-weight:600;color:var(--text-primary);margin:24px 0 12px;';
  subsHeading.textContent = 'Enrolled Subscriptions';
  panel.appendChild(subsHeading);

  // Empty state
  if (!enrolled || enrolled.length === 0) {
    var empty = document.createElement('div');
    empty.className = 'empty-state';

    var icon = document.createElement('div');
    icon.className = 'empty-state-icon';
    icon.textContent = '\uD83D\uDD0D';

    var emptyTitle = document.createElement('div');
    emptyTitle.className = 'empty-state-title';
    emptyTitle.textContent = 'No enrolled subscriptions found';

    var emptyDesc = document.createElement('div');
    emptyDesc.className = 'empty-state-desc';
    emptyDesc.textContent = 'Deploy enroll.bicep to an Azure subscription to begin automatic resource tagging.';

    empty.appendChild(icon);
    empty.appendChild(emptyTitle);
    empty.appendChild(emptyDesc);
    panel.appendChild(empty);
    return;
  }

  // Card grid — cards only (no editors inside the grid)
  var grid = document.createElement('div');
  grid.className = 'card-grid';

  // Editor container sits below the grid so editors don't disrupt card layout
  var editorContainer = document.createElement('div');
  editorContainer.className = 'editor-container';

  enrolled.forEach(function(sub) {
    var card = buildEnrolledCard(sub);
    grid.appendChild(card);

    var editor = buildInlineEditor(sub);
    editorContainer.appendChild(editor);
  });

  panel.appendChild(grid);
  panel.appendChild(editorContainer);

  // If an editor was open before re-render, re-open it
  if (_openEditorSubId) {
    expandEditor(_openEditorSubId);
  }
}

// ── Subscription Card ───────────────────────────────────────────────────────

function buildEnrolledCard(sub) {
  var isActive = sub.active !== false;
  var isNotEnrolled = sub.enrolled === false;

  var card = document.createElement('div');
  card.className = 'card';
  card.setAttribute('data-sub', sub.subscriptionId);
  card.style.cursor = 'pointer';
  if (!isActive) {
    card.style.opacity = '0.7';
  }

  // Header row: title block + badges column
  var header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:8px;';

  var titleBlock = document.createElement('div');
  titleBlock.style.minWidth = '0';

  var cardTitle = document.createElement('div');
  cardTitle.className = 'card-title';
  cardTitle.style.cssText = 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
  cardTitle.textContent = sub.displayName || sub.subscriptionId;

  var cardSubtitle = document.createElement('div');
  cardSubtitle.className = 'card-subtitle';
  cardSubtitle.style.cssText = 'font-family:monospace;word-break:break-all;';
  cardSubtitle.textContent = sub.subscriptionId;

  titleBlock.appendChild(cardTitle);
  titleBlock.appendChild(cardSubtitle);

  var badges = document.createElement('div');
  badges.style.cssText = 'display:flex;flex-direction:column;gap:4px;align-items:flex-end;flex-shrink:0;';

  var isDegraded = isActive && sub.rbacStatus === 'degraded';

  var statusBadge = document.createElement('span');
  if (isNotEnrolled) {
    statusBadge.className = 'badge badge-warning';
    statusBadge.textContent = 'Not Enrolled';
  } else if (isDegraded) {
    statusBadge.className = 'badge badge-warning';
    statusBadge.textContent = 'Degraded';
  } else if (isActive) {
    statusBadge.className = 'badge badge-enabled';
    statusBadge.textContent = 'Active';
  } else {
    statusBadge.className = 'badge badge-warning';
    statusBadge.textContent = 'Paused';
  }
  badges.appendChild(statusBadge);

  if (sub.hasCustomConfig) {
    var customBadge = document.createElement('span');
    customBadge.className = 'badge badge-info';
    customBadge.textContent = 'Custom Config';
    badges.appendChild(customBadge);
  }

  header.appendChild(titleBlock);
  header.appendChild(badges);
  card.appendChild(header);

  // Body
  var body = document.createElement('div');
  body.className = 'card-body';
  body.style.marginBottom = '16px';

  if (isNotEnrolled) {
    var notEnrolledMsg = document.createElement('div');
    notEnrolledMsg.style.cssText = 'color:var(--warning);font-size:0.875rem;';
    notEnrolledMsg.textContent = 'Not enrolled \u2014 run the enrollment template to start tagging this subscription';
    body.appendChild(notEnrolledMsg);
  } else if (isDegraded) {
    var degradedMsg = document.createElement('div');
    degradedMsg.style.cssText = 'color:var(--warning);font-size:0.875rem;margin-bottom:8px;';
    degradedMsg.textContent = 'Event Grid is active but the function app\u2019s managed identity is missing required RBAC roles (Reader + Tag Contributor). Tagging will silently fail.';
    body.appendChild(degradedMsg);
    var fixHint = document.createElement('div');
    fixHint.style.cssText = 'color:var(--text-secondary);font-size:0.8125rem;';
    fixHint.textContent = 'Fix: assign Reader and Tag Contributor roles to the function app\u2019s managed identity on this subscription.';
    body.appendChild(fixHint);
  } else if (!isActive) {
    var pausedMsg = document.createElement('div');
    pausedMsg.style.cssText = 'color:var(--warning);font-size:0.875rem;';
    pausedMsg.textContent = 'Event Grid delivery paused \u2014 no tags being applied';
    body.appendChild(pausedMsg);
  } else if (sub.hasCustomConfig) {
    var config = getConfig();
    var subConfig = (config.subscriptions && config.subscriptions[sub.subscriptionId]) || {};
    var tagOverrideCount = Object.keys(subConfig.tagOverrides || {}).length;
    var resourceRuleCount = Object.keys(subConfig.resourceTypeRules || {}).length;
    var ignorePatternCount = (subConfig.additionalIgnorePatterns || []).length;

    var counts = document.createElement('div');
    counts.style.cssText = 'display:flex;gap:16px;flex-wrap:wrap;';

    function makeCounter(value, label) {
      var item = document.createElement('div');
      var val = document.createElement('div');
      val.style.cssText = 'font-size:1.25rem;font-weight:700;color:var(--text-primary);';
      val.textContent = String(value);
      var lbl = document.createElement('div');
      lbl.style.cssText = 'font-size:0.75rem;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.05em;';
      lbl.textContent = label;
      item.appendChild(val);
      item.appendChild(lbl);
      return item;
    }

    counts.appendChild(makeCounter(tagOverrideCount, 'Tag Overrides'));
    counts.appendChild(makeCounter(resourceRuleCount, 'Resource Rules'));
    counts.appendChild(makeCounter(ignorePatternCount, 'Ignore Patterns'));
    body.appendChild(counts);
  } else {
    var defaultsMsg = document.createElement('div');
    defaultsMsg.style.cssText = 'color:var(--text-secondary);font-size:0.875rem;';
    defaultsMsg.textContent = 'Using global defaults \u2014 no custom overrides';
    body.appendChild(defaultsMsg);
  }

  card.appendChild(body);

  // Footer: toggle + config action. Stops propagation to avoid triggering card click.
  var footer = document.createElement('div');
  footer.className = 'card-footer';
  footer.addEventListener('click', function(e) {
    e.stopPropagation();
  });

  // Tagging toggle
  var safeToggleId = 'toggle-' + sub.subscriptionId.replace(/[^a-zA-Z0-9]/g, '-');
  var toggleWrapper = document.createElement('label');
  toggleWrapper.className = 'toggle-wrapper';
  toggleWrapper.setAttribute('for', safeToggleId);

  var toggleInput = document.createElement('input');
  toggleInput.type = 'checkbox';
  toggleInput.id = safeToggleId;
  toggleInput.className = 'toggle-input';
  toggleInput.checked = isActive;
  if (isNotEnrolled) {
    toggleInput.disabled = true;
    toggleWrapper.style.opacity = '0.5';
    toggleWrapper.style.cursor = 'not-allowed';
  } else {
    toggleInput.addEventListener('change', function() {
      handleTaggingToggle(sub, toggleInput);
    });
  }

  var toggleTrack = document.createElement('span');
  toggleTrack.className = 'toggle-track';
  var toggleThumb = document.createElement('span');
  toggleThumb.className = 'toggle-thumb';
  toggleTrack.appendChild(toggleThumb);

  var toggleLabel = document.createElement('span');
  toggleLabel.className = 'toggle-label';
  toggleLabel.setAttribute('data-toggle-label', sub.subscriptionId);
  toggleLabel.textContent = isNotEnrolled ? 'Not enrolled' : isDegraded ? 'Tagging degraded' : isActive ? 'Tagging active' : 'Tagging paused';

  toggleWrapper.appendChild(toggleInput);
  toggleWrapper.appendChild(toggleTrack);
  toggleWrapper.appendChild(toggleLabel);
  footer.appendChild(toggleWrapper);

  // Config action button — hide for non-enrolled subs
  if (isNotEnrolled) {
    card.appendChild(footer);
    return card;
  }
  var configBtn = document.createElement('button');
  if (sub._unsavedCustomConfig) {
    configBtn.className = 'btn btn-sm';
    configBtn.style.color = 'var(--text-secondary)';
    configBtn.style.borderColor = 'var(--border)';
    configBtn.textContent = 'Cancel';
    configBtn.addEventListener('click', function() {
      cancelCustomConfig(sub);
    });
  } else if (sub.hasCustomConfig) {
    configBtn.className = 'btn btn-sm';
    configBtn.style.color = 'var(--error)';
    configBtn.style.borderColor = 'var(--error)';
    configBtn.textContent = 'Remove Custom Config';
    configBtn.addEventListener('click', function() {
      openRemoveCustomConfigModal(sub);
    });
  } else {
    configBtn.className = 'btn btn-sm';
    configBtn.style.color = 'var(--info)';
    configBtn.style.borderColor = 'var(--info)';
    configBtn.textContent = '+ Add Custom Config';
    configBtn.addEventListener('click', function() {
      addCustomConfig(sub);
    });
  }
  footer.appendChild(configBtn);

  card.appendChild(footer);

  // Clicking the card toggles the inline editor
  card.addEventListener('click', function() {
    toggleInlineEditor(sub.subscriptionId);
  });

  return card;
}

// ── Inline Editor ───────────────────────────────────────────────────────────

function buildInlineEditor(sub) {
  var editor = document.createElement('div');
  editor.className = 'inline-editor';
  editor.setAttribute('data-sub', sub.subscriptionId);

  // Stop card-grid clicks from propagating through the editor
  editor.addEventListener('click', function(e) {
    e.stopPropagation();
  });

  var config = getConfig();
  var subConfig = (config.subscriptions && config.subscriptions[sub.subscriptionId]) || null;

  if (!subConfig) {
    // No custom config — show helpful message
    var noConfig = document.createElement('div');
    noConfig.style.cssText = 'padding:20px;text-align:center;color:var(--text-secondary);font-size:0.875rem;';
    noConfig.textContent = 'This subscription uses global defaults only. Click "+ Add Custom Config" to add overrides.';
    editor.appendChild(noConfig);
    return editor;
  }

  // ── Subscription Overrides (editable) ───────────────────────────────────
  var overridesSection = buildSection(
    'Subscription Overrides',
    'Per-subscription tag overrides for: ' +
    ((subConfig.displayName || '').trim() || sub.subscriptionId)
  );
  editor.appendChild(overridesSection);
  var overridesBody = overridesSection.querySelector('.rules-section-body');

  // Tag Overrides
  var tagOverridesSubsection = buildSubsection('Tag Overrides', overridesBody);
  var tagOverridesList = document.createElement('div');
  tagOverridesList.className = 'tag-overrides-list';
  tagOverridesSubsection.appendChild(tagOverridesList);

  var tagOverrides = subConfig.tagOverrides || {};
  Object.keys(tagOverrides).forEach(function(tagName) {
    var entry = tagOverrides[tagName];
    tagOverridesList.appendChild(buildTagOverrideRow(tagName, entry.value || '', entry.overwrite === true));
  });

  var tagBtnWrapper = document.createElement('div');
  tagBtnWrapper.style.cssText = 'display:flex;gap:8px;align-items:center;margin:10px 20px 14px;';

  var addTagBtn = document.createElement('button');
  addTagBtn.className = 'btn btn-secondary btn-sm';
  addTagBtn.textContent = '+ Add Tag';
  addTagBtn.addEventListener('click', function() {
    tagOverridesList.appendChild(buildTagOverrideRow('', '', false));
    var rows = tagOverridesList.querySelectorAll('.tag-override-row');
    var lastRow = rows[rows.length - 1];
    if (lastRow) {
      var input = lastRow.querySelector('.tag-name-input');
      if (input) input.focus();
    }
  });
  tagBtnWrapper.appendChild(addTagBtn);

  var templateBtn = document.createElement('button');
  templateBtn.className = 'btn btn-secondary btn-sm';
  templateBtn.textContent = 'Apply Template';
  templateBtn.addEventListener('click', function() {
    openTemplatePickerModal(tagOverridesList);
  });
  tagBtnWrapper.appendChild(templateBtn);

  tagOverridesSubsection.appendChild(tagBtnWrapper);

  // Resource Type Rules
  var resourceRulesSubsection = buildSubsection('Resource Type Rules', overridesBody);
  var resourceRulesList = document.createElement('div');
  resourceRulesList.className = 'resource-rules-list';
  resourceRulesSubsection.appendChild(resourceRulesList);

  var resourceTypeRules = subConfig.resourceTypeRules || {};
  Object.keys(resourceTypeRules).forEach(function(resourceType) {
    var rule = resourceTypeRules[resourceType];
    resourceRulesList.appendChild(buildResourceTypeRuleRow(resourceType, rule));
  });

  var addRuleBtn = document.createElement('button');
  addRuleBtn.className = 'btn btn-secondary btn-sm';
  addRuleBtn.style.cssText = 'margin:10px 20px 14px;';
  addRuleBtn.textContent = '+ Add Rule';
  addRuleBtn.addEventListener('click', function() {
    resourceRulesList.appendChild(buildResourceTypeRuleRow('', { additionalTags: {}, excludeTags: [] }));
    var rows = resourceRulesList.querySelectorAll('.resource-rule-row');
    var lastRow = rows[rows.length - 1];
    if (lastRow) {
      var input = lastRow.querySelector('.resource-type-input');
      if (input) input.focus();
    }
  });
  resourceRulesSubsection.appendChild(addRuleBtn);

  // Additional Ignore Patterns
  var ignoreSubsection = buildSubsection('Additional Ignore Patterns', overridesBody);
  var ignoreList = document.createElement('div');
  ignoreList.className = 'ignore-patterns-list';
  ignoreSubsection.appendChild(ignoreList);

  var ignorePatterns = subConfig.additionalIgnorePatterns || [];
  ignorePatterns.forEach(function(pattern) {
    ignoreList.appendChild(buildIgnorePatternRow(pattern));
  });

  var addPatternBtn = document.createElement('button');
  addPatternBtn.className = 'btn btn-secondary btn-sm';
  addPatternBtn.style.cssText = 'margin:10px 20px 14px;';
  addPatternBtn.textContent = '+ Add Pattern';
  addPatternBtn.addEventListener('click', function() {
    ignoreList.appendChild(buildIgnorePatternRow(''));
    var rows = ignoreList.querySelectorAll('.ignore-pattern-row');
    var lastRow = rows[rows.length - 1];
    if (lastRow) {
      var input = lastRow.querySelector('.ignore-pattern-input');
      if (input) input.focus();
    }
  });
  ignoreSubsection.appendChild(addPatternBtn);

  // ── Save / Reset action bar ─────────────────────────────────────────────
  var actionBar = document.createElement('div');
  actionBar.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;margin-top:16px;';

  var resetBtn = document.createElement('button');
  resetBtn.className = 'btn btn-secondary';
  resetBtn.textContent = 'Reset';
  resetBtn.addEventListener('click', async function() {
    _openEditorSubId = sub.subscriptionId;
    invalidateEnrollmentCache();
    var enrolled = await discoverEnrollment();
    renderSubscriptionsTab(enrolled);
  });

  var saveBtn = document.createElement('button');
  saveBtn.className = 'btn btn-primary';
  saveBtn.textContent = 'Save';
  saveBtn.addEventListener('click', function() {
    saveInlineEditor(sub.subscriptionId, editor, saveBtn);
  });

  actionBar.appendChild(resetBtn);
  actionBar.appendChild(saveBtn);
  editor.appendChild(actionBar);

  return editor;
}

// ── Toggle / Expand / Collapse ──────────────────────────────────────────────

function toggleInlineEditor(subId) {
  var editor = document.querySelector('.inline-editor[data-sub="' + subId + '"]');
  if (!editor) return;

  var isOpen = editor.classList.contains('open');

  // Collapse any open editor
  collapseAllEditors();

  if (!isOpen) {
    expandEditor(subId);
  } else {
    _openEditorSubId = null;
  }
}

function expandEditor(subId) {
  var editor = document.querySelector('.inline-editor[data-sub="' + subId + '"]');
  var card = document.querySelector('.card[data-sub="' + subId + '"]');
  if (!editor) return;

  editor.classList.add('open');
  if (card) card.classList.add('expanded');
  _openEditorSubId = subId;
}

function collapseAllEditors() {
  document.querySelectorAll('.inline-editor.open').forEach(function(el) {
    el.classList.remove('open');
  });
  document.querySelectorAll('.card.expanded').forEach(function(el) {
    el.classList.remove('expanded');
  });
}

// ── Tagging Toggle ──────────────────────────────────────────────────────────

async function handleTaggingToggle(sub, toggleInput) {
  var turningOn = toggleInput.checked;

  try {
    if (turningOn) {
      await resumeEnrollment(sub);
      showToast('Tagging resumed for ' + (sub.displayName || sub.subscriptionId), 'info');
    } else {
      await pauseEnrollment(sub);
      showToast('Tagging paused for ' + (sub.displayName || sub.subscriptionId), 'warning');
    }
    invalidateEnrollmentCache();
    var updated = await refreshEnrollment();
    renderSubscriptionsTab(updated);
  } catch (err) {
    toggleInput.checked = !turningOn;
    var msg = String(err && err.message ? err.message : err);
    if (msg.indexOf('403') !== -1) {
      showToast('Insufficient permissions \u2014 EventGrid Contributor required', 'error');
    } else {
      showToast('Failed to update tagging state: ' + msg, 'error');
    }
  }
}

// ── Add / Remove Custom Config ──────────────────────────────────────────────

async function addCustomConfig(sub) {
  // Create the config entry in memory (not saved to blob yet)
  var config = getConfig();
  if (!config.subscriptions) config.subscriptions = {};
  if (!config.subscriptions[sub.subscriptionId]) {
    config.subscriptions[sub.subscriptionId] = {
      displayName: sub.displayName || sub.subscriptionId,
      tagOverrides: {},
      resourceTypeRules: {},
    };
  }

  sub._unsavedCustomConfig = true;
  sub.hasCustomConfig = true;
  _openEditorSubId = sub.subscriptionId;
  var enrolled = await discoverEnrollment();
  enrolled.forEach(function(s) {
    if (s.subscriptionId === sub.subscriptionId) {
      s._unsavedCustomConfig = true;
      s.hasCustomConfig = true;
    }
  });
  renderSubscriptionsTab(enrolled);
}

function cancelCustomConfig(sub) {
  // Remove the in-memory config entry (never saved to blob)
  var config = getConfig();
  if (config.subscriptions && config.subscriptions[sub.subscriptionId]) {
    delete config.subscriptions[sub.subscriptionId];
  }
  delete sub._unsavedCustomConfig;
  sub.hasCustomConfig = false;
  _openEditorSubId = null;
  discoverEnrollment().then(function(enrolled) {
    renderSubscriptionsTab(enrolled);
  });
}

function openRemoveCustomConfigModal(sub) {
  var bodyEl = document.createElement('div');

  var p1 = document.createElement('p');
  p1.style.color = 'var(--text-secondary)';
  p1.textContent = 'Remove custom config for ' + (sub.displayName || sub.subscriptionId) +
    '? This subscription will continue to be tagged using global defaults.';

  bodyEl.appendChild(p1);

  var cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn btn-secondary';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', closeModal);

  var removeBtn = document.createElement('button');
  removeBtn.className = 'btn btn-danger';
  removeBtn.textContent = 'Remove Config';
  removeBtn.addEventListener('click', function() {
    confirmRemoveCustomConfig(sub);
  });

  showModalDOM('Remove Custom Config', bodyEl, [cancelBtn, removeBtn]);
}

async function confirmRemoveCustomConfig(sub) {
  var config = getConfig();
  if (config.subscriptions && config.subscriptions[sub.subscriptionId]) {
    delete config.subscriptions[sub.subscriptionId];
  }

  var ok = await saveConfig(config);
  if (ok) {
    closeModal();
    _openEditorSubId = null;
    invalidateEnrollmentCache();
    var enrolled = await discoverEnrollment();
    renderSubscriptionsTab(enrolled);
  }
}

// ── Import Modal ────────────────────────────────────────────────────────────

function openImportModal(parsedConfig) {
  var subs = (parsedConfig && parsedConfig.subscriptions) ? parsedConfig.subscriptions : {};
  var subIds = Object.keys(subs);

  var bodyEl = document.createElement('div');

  var desc = document.createElement('p');
  desc.style.cssText = 'color:var(--text-secondary);margin-bottom:12px;';
  desc.textContent = 'Found ' + subIds.length + ' subscription' + (subIds.length === 1 ? '' : 's') + ' in the uploaded file:';
  bodyEl.appendChild(desc);

  var list = document.createElement('div');
  list.style.cssText = 'max-height:200px;overflow-y:auto;margin-bottom:12px;';

  subIds.forEach(function(subId) {
    var item = document.createElement('div');
    item.style.cssText = 'padding:6px 0;border-bottom:1px solid var(--border);';
    var nameEl = document.createElement('div');
    nameEl.style.cssText = 'font-weight:600;font-size:0.875rem;color:var(--text-primary);';
    nameEl.textContent = subs[subId].displayName || subId;
    var idEl = document.createElement('div');
    idEl.style.cssText = 'font-family:monospace;font-size:0.75rem;color:var(--text-secondary);';
    idEl.textContent = subId;
    item.appendChild(nameEl);
    item.appendChild(idEl);
    list.appendChild(item);
  });
  bodyEl.appendChild(list);

  var hint = document.createElement('p');
  hint.style.cssText = 'color:var(--text-secondary);font-size:0.8125rem;';
  hint.textContent = 'Merge adds imported subscriptions to existing config. Replace overwrites the entire config.';
  bodyEl.appendChild(hint);

  var cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn btn-secondary';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', closeModal);

  var mergeBtn = document.createElement('button');
  mergeBtn.className = 'btn btn-primary';
  mergeBtn.textContent = 'Merge';
  mergeBtn.addEventListener('click', async function() {
    var ok = await importConfigFile(parsedConfig, 'merge');
    if (ok) {
      closeModal();
      showToast('Config merged successfully', 'success');
      invalidateEnrollmentCache();
      var enrolled = await discoverEnrollment();
      renderSubscriptionsTab(enrolled);
    }
  });

  var replaceBtn = document.createElement('button');
  replaceBtn.className = 'btn btn-danger';
  replaceBtn.textContent = 'Replace';
  replaceBtn.addEventListener('click', async function() {
    var ok = await importConfigFile(parsedConfig, 'replace');
    if (ok) {
      closeModal();
      showToast('Config replaced successfully', 'success');
      invalidateEnrollmentCache();
      var enrolled = await discoverEnrollment();
      renderSubscriptionsTab(enrolled);
    }
  });

  showModalDOM('Import Configuration', bodyEl, [cancelBtn, mergeBtn, replaceBtn]);
}

// ── Template Picker ─────────────────────────────────────────────────────────

function openTemplatePickerModal(tagOverridesList) {
  var bodyEl = document.createElement('div');

  TAG_TEMPLATES.forEach(function(template) {
    var card = document.createElement('div');
    card.className = 'template-card';

    var header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;';

    var nameEl = document.createElement('div');
    nameEl.style.cssText = 'font-weight:600;font-size:0.9375rem;color:var(--text-primary);';
    nameEl.textContent = template.name;

    var applyBtn = document.createElement('button');
    applyBtn.className = 'btn btn-primary btn-sm';
    applyBtn.textContent = 'Apply';
    applyBtn.addEventListener('click', function() {
      applyTemplate(template, tagOverridesList);
      closeModal();
    });

    header.appendChild(nameEl);
    header.appendChild(applyBtn);
    card.appendChild(header);

    var chips = document.createElement('div');
    chips.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;';
    Object.keys(template.tags).forEach(function(tagName) {
      var chip = document.createElement('span');
      chip.className = 'tag-chip tag-new';
      chip.style.fontSize = '0.75rem';
      chip.textContent = tagName;
      chips.appendChild(chip);
    });
    card.appendChild(chips);

    bodyEl.appendChild(card);
  });

  var cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn btn-secondary';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', closeModal);

  showModalDOM('Apply Tag Template', bodyEl, [cancelBtn]);
}

function applyTemplate(template, tagOverridesList) {
  // Collect existing tag names from the editor
  var existingNames = [];
  tagOverridesList.querySelectorAll('.tag-name-input').forEach(function(input) {
    var name = input.value.trim();
    if (name) existingNames.push(name.toLowerCase());
  });

  var added = 0;
  var skipped = 0;

  Object.keys(template.tags).forEach(function(tagName) {
    if (existingNames.indexOf(tagName.toLowerCase()) !== -1) {
      skipped++;
      return;
    }
    var entry = template.tags[tagName];
    tagOverridesList.appendChild(buildTagOverrideRow(tagName, entry.value, entry.overwrite));
    added++;
  });

  if (skipped > 0) {
    showToast('Applied ' + template.name + ': ' + added + ' added, ' + skipped + ' skipped (already exist)', 'info');
  } else {
    showToast('Applied template: ' + template.name, 'success');
  }
}

// ── Builder Helpers (migrated from rules.js) ────────────────────────────────

function buildSection(title, description) {
  var section = document.createElement('div');
  section.className = 'rules-section';
  section.style.marginBottom = '20px';

  var header = document.createElement('div');
  header.className = 'rules-section-header';

  var titleEl = document.createElement('div');
  titleEl.className = 'rules-section-title';
  titleEl.textContent = title;
  header.appendChild(titleEl);

  if (description) {
    var descEl = document.createElement('div');
    descEl.style.cssText = 'font-size:0.8125rem;color:var(--text-secondary);';
    descEl.textContent = description;
    header.appendChild(descEl);
  }

  section.appendChild(header);

  var body = document.createElement('div');
  body.className = 'rules-section-body';
  section.appendChild(body);

  return section;
}

function buildSubsection(title, parentEl) {
  var wrapper = document.createElement('div');
  wrapper.style.cssText = 'border-bottom:1px solid var(--border);padding-bottom:4px;margin-bottom:0;';

  var subHeader = document.createElement('div');
  subHeader.style.cssText = 'padding:10px 20px 6px;';

  var subTitle = document.createElement('div');
  subTitle.style.cssText = 'font-size:0.8125rem;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.06em;';
  subTitle.textContent = title;
  subHeader.appendChild(subTitle);

  wrapper.appendChild(subHeader);
  parentEl.appendChild(wrapper);

  return wrapper;
}

function buildTagOverrideRow(tagName, tagValue, overwrite) {
  var row = document.createElement('div');
  row.className = 'rule-row tag-override-row';
  row.style.flexWrap = 'nowrap';

  var nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'form-input tag-name-input';
  nameInput.style.cssText = 'width:180px;flex-shrink:0;';
  nameInput.placeholder = 'Tag name';
  nameInput.value = tagName;
  nameInput.setAttribute('aria-label', 'Tag name');

  var valueInput = document.createElement('input');
  valueInput.type = 'text';
  valueInput.className = 'form-input tag-value-input';
  valueInput.style.cssText = 'flex:1;min-width:120px;';
  valueInput.placeholder = 'Value (e.g. {caller}, MyTeam)';
  valueInput.value = tagValue;
  valueInput.setAttribute('aria-label', 'Tag value');

  var toggleId = 'overwrite-toggle-' + Math.random().toString(36).slice(2, 9);
  var toggleWrapper = document.createElement('label');
  toggleWrapper.className = 'toggle-wrapper';
  toggleWrapper.setAttribute('for', toggleId);
  toggleWrapper.style.flexShrink = '0';

  var toggleInput = document.createElement('input');
  toggleInput.type = 'checkbox';
  toggleInput.id = toggleId;
  toggleInput.className = 'toggle-input overwrite-toggle';
  toggleInput.checked = overwrite;

  var toggleTrack = document.createElement('span');
  toggleTrack.className = 'toggle-track';
  var toggleThumb = document.createElement('span');
  toggleThumb.className = 'toggle-thumb';
  toggleTrack.appendChild(toggleThumb);

  var toggleLabel = document.createElement('span');
  toggleLabel.className = 'toggle-label';
  toggleLabel.style.cssText = 'font-size:0.8125rem;color:var(--text-secondary);';
  toggleLabel.textContent = 'Overwrite';

  toggleWrapper.appendChild(toggleInput);
  toggleWrapper.appendChild(toggleTrack);
  toggleWrapper.appendChild(toggleLabel);

  var removeBtn = document.createElement('button');
  removeBtn.className = 'btn btn-danger btn-sm';
  removeBtn.style.flexShrink = '0';
  removeBtn.textContent = 'Remove';
  removeBtn.setAttribute('aria-label', 'Remove tag override');
  removeBtn.addEventListener('click', function() {
    row.remove();
  });

  row.appendChild(nameInput);
  row.appendChild(valueInput);
  row.appendChild(toggleWrapper);
  row.appendChild(removeBtn);

  return row;
}

function addJsonValidation(textarea, expectArray) {
  var errorEl = document.createElement('div');
  errorEl.style.cssText = 'font-size:0.75rem;color:var(--error);margin-top:4px;display:none;';

  textarea.addEventListener('blur', function() {
    var val = textarea.value.trim();
    if (!val) {
      textarea.style.borderColor = '';
      errorEl.style.display = 'none';
      return;
    }
    try {
      var parsed = JSON.parse(val);
      if (expectArray && !Array.isArray(parsed)) {
        throw new Error('Expected a JSON array, e.g. ["Creator", "CreatedOn"]');
      }
      textarea.style.borderColor = 'var(--success)';
      errorEl.style.display = 'none';
      // Auto-format valid JSON
      textarea.value = JSON.stringify(parsed, null, 2);
      // Clear success border after a moment
      setTimeout(function() { textarea.style.borderColor = ''; }, 1500);
    } catch (e) {
      textarea.style.borderColor = 'var(--error)';
      errorEl.textContent = e.message;
      errorEl.style.display = 'block';
    }
  });

  // Insert error element after textarea
  textarea.parentNode.appendChild(errorEl);
}

function buildResourceTypeRuleRow(resourceType, rule) {
  var additionalTags = rule.additionalTags || {};
  var excludeTags = rule.excludeTags || [];

  var row = document.createElement('div');
  row.className = 'rule-row resource-rule-row';
  row.style.cssText = 'flex-direction:column;align-items:stretch;gap:10px;padding:14px 20px;';

  var topLine = document.createElement('div');
  topLine.style.cssText = 'display:flex;align-items:center;gap:12px;';

  var rtInput = document.createElement('input');
  rtInput.type = 'text';
  rtInput.className = 'form-input resource-type-input';
  rtInput.style.cssText = 'flex:1;font-family:monospace;';
  rtInput.placeholder = 'e.g. Microsoft.Compute/virtualMachines';
  rtInput.value = resourceType;
  rtInput.setAttribute('aria-label', 'Resource type');

  var removeBtn = document.createElement('button');
  removeBtn.className = 'btn btn-danger btn-sm';
  removeBtn.style.flexShrink = '0';
  removeBtn.textContent = 'Remove';
  removeBtn.setAttribute('aria-label', 'Remove resource type rule');
  removeBtn.addEventListener('click', function() {
    row.remove();
  });

  topLine.appendChild(rtInput);
  topLine.appendChild(removeBtn);
  row.appendChild(topLine);

  var additionalTagsGroup = document.createElement('div');
  additionalTagsGroup.className = 'form-group';

  var additionalTagsLabel = document.createElement('label');
  additionalTagsLabel.className = 'form-label';
  additionalTagsLabel.textContent = 'Additional Tags (JSON)';

  var additionalTagsTextarea = document.createElement('textarea');
  additionalTagsTextarea.className = 'form-textarea resource-additional-tags';
  additionalTagsTextarea.style.cssText = 'font-family:monospace;font-size:0.8125rem;min-height:70px;';
  additionalTagsTextarea.placeholder = '{ "Environment": { "value": "Prod", "overwrite": false } }';
  additionalTagsTextarea.value = Object.keys(additionalTags).length > 0
    ? JSON.stringify(additionalTags, null, 2)
    : '';
  additionalTagsTextarea.setAttribute('aria-label', 'Additional tags JSON');

  additionalTagsGroup.appendChild(additionalTagsLabel);
  additionalTagsGroup.appendChild(additionalTagsTextarea);
  addJsonValidation(additionalTagsTextarea, false);
  row.appendChild(additionalTagsGroup);

  var excludeTagsGroup = document.createElement('div');
  excludeTagsGroup.className = 'form-group';

  var excludeTagsLabel = document.createElement('label');
  excludeTagsLabel.className = 'form-label';
  excludeTagsLabel.textContent = 'Exclude Tags (JSON array)';

  var excludeTagsTextarea = document.createElement('textarea');
  excludeTagsTextarea.className = 'form-textarea resource-exclude-tags';
  excludeTagsTextarea.style.cssText = 'font-family:monospace;font-size:0.8125rem;min-height:50px;';
  excludeTagsTextarea.placeholder = '["Creator", "CreatedOn"]';
  excludeTagsTextarea.value = excludeTags.length > 0 ? JSON.stringify(excludeTags, null, 2) : '';
  excludeTagsTextarea.setAttribute('aria-label', 'Exclude tags JSON array');

  excludeTagsGroup.appendChild(excludeTagsLabel);
  excludeTagsGroup.appendChild(excludeTagsTextarea);
  addJsonValidation(excludeTagsTextarea, true);
  row.appendChild(excludeTagsGroup);

  return row;
}

function buildIgnorePatternRow(pattern) {
  var row = document.createElement('div');
  row.className = 'rule-row ignore-pattern-row';
  row.style.flexWrap = 'nowrap';

  var patternInput = document.createElement('input');
  patternInput.type = 'text';
  patternInput.className = 'form-input ignore-pattern-input';
  patternInput.style.cssText = 'flex:1;font-family:monospace;';
  patternInput.placeholder = 'e.g. /subscriptions/*/resourceGroups/rg-infra/*';
  patternInput.value = pattern;
  patternInput.setAttribute('aria-label', 'Ignore pattern');

  var removeBtn = document.createElement('button');
  removeBtn.className = 'btn btn-danger btn-sm';
  removeBtn.style.flexShrink = '0';
  removeBtn.textContent = 'Remove';
  removeBtn.setAttribute('aria-label', 'Remove ignore pattern');
  removeBtn.addEventListener('click', function() {
    row.remove();
  });

  row.appendChild(patternInput);
  row.appendChild(removeBtn);

  return row;
}

// ── Save Inline Editor ──────────────────────────────────────────────────────

async function saveInlineEditor(subId, editorEl, saveBtn) {
  var config = getConfig();
  if (!config.subscriptions) config.subscriptions = {};
  if (!config.subscriptions[subId]) {
    config.subscriptions[subId] = { tagOverrides: {}, resourceTypeRules: {} };
  }

  // Collect tag overrides
  var tagOverrides = {};
  var hasValidationError = false;

  var tagOverrideRows = editorEl.querySelectorAll('.tag-overrides-list .tag-override-row');
  tagOverrideRows.forEach(function(row) {
    var nameInput = row.querySelector('.tag-name-input');
    var valueInput = row.querySelector('.tag-value-input');
    var overwriteToggle = row.querySelector('.overwrite-toggle');

    var name = (nameInput ? nameInput.value : '').trim();
    var value = (valueInput ? valueInput.value : '').trim();
    var overwrite = overwriteToggle ? overwriteToggle.checked : false;

    if (!name) {
      if (nameInput) nameInput.style.borderColor = 'var(--error)';
      hasValidationError = true;
      return;
    }

    if (nameInput) nameInput.style.borderColor = '';
    tagOverrides[name] = { value: value, overwrite: overwrite };
  });

  if (hasValidationError) {
    showToast('Tag name cannot be empty \u2014 fix highlighted fields', 'error');
    return;
  }

  // Collect resource type rules
  var resourceTypeRules = {};

  var resourceRuleRows = editorEl.querySelectorAll('.resource-rules-list .resource-rule-row');
  for (var i = 0; i < resourceRuleRows.length; i++) {
    var row = resourceRuleRows[i];
    var rtInput = row.querySelector('.resource-type-input');
    var additionalTagsEl = row.querySelector('.resource-additional-tags');
    var excludeTagsEl = row.querySelector('.resource-exclude-tags');

    var resourceType = (rtInput ? rtInput.value : '').trim();
    if (!resourceType) {
      if (rtInput) rtInput.style.borderColor = 'var(--error)';
      hasValidationError = true;
      continue;
    }
    if (rtInput) rtInput.style.borderColor = '';

    var additionalTags = {};
    if (additionalTagsEl && additionalTagsEl.value.trim()) {
      try {
        additionalTags = JSON.parse(additionalTagsEl.value);
        additionalTagsEl.style.borderColor = '';
      } catch (e) {
        additionalTagsEl.style.borderColor = 'var(--error)';
        showToast('Invalid JSON in Additional Tags for: ' + resourceType, 'error');
        hasValidationError = true;
        continue;
      }
    }

    var excludeTags = [];
    if (excludeTagsEl && excludeTagsEl.value.trim()) {
      try {
        excludeTags = JSON.parse(excludeTagsEl.value);
        if (!Array.isArray(excludeTags)) throw new Error('Expected array');
        excludeTagsEl.style.borderColor = '';
      } catch (e) {
        excludeTagsEl.style.borderColor = 'var(--error)';
        showToast('Invalid JSON array in Exclude Tags for: ' + resourceType, 'error');
        hasValidationError = true;
        continue;
      }
    }

    resourceTypeRules[resourceType] = {
      additionalTags: additionalTags,
      excludeTags: excludeTags,
    };
  }

  if (hasValidationError) {
    showToast('Fix validation errors before saving', 'error');
    return;
  }

  // Collect ignore patterns
  var additionalIgnorePatterns = [];
  var ignorePatternRows = editorEl.querySelectorAll('.ignore-patterns-list .ignore-pattern-row');
  ignorePatternRows.forEach(function(row) {
    var patternInput = row.querySelector('.ignore-pattern-input');
    var pattern = (patternInput ? patternInput.value : '').trim();
    if (pattern) additionalIgnorePatterns.push(pattern);
  });

  // Build updated subscription config
  var updatedSub = Object.assign({}, config.subscriptions[subId], {
    tagOverrides: tagOverrides,
    resourceTypeRules: resourceTypeRules,
    additionalIgnorePatterns: additionalIgnorePatterns,
  });

  config.subscriptions[subId] = updatedSub;

  if (saveBtn) saveBtn.disabled = true;
  var ok = await saveConfig(config);
  if (saveBtn) saveBtn.disabled = false;

  if (ok) {
    // Re-render with the editor still open
    _openEditorSubId = subId;
    invalidateEnrollmentCache();
    var enrolled = await discoverEnrollment();
    renderSubscriptionsTab(enrolled);
  }
}

window.loadSubscriptionsTab = loadSubscriptionsTab;
