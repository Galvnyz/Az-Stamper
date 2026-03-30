// Tag Rules Tab — per-subscription tag overrides, resource-type rules, ignore patterns

// Entry point — called by tab switcher or navigateToRules(subId) from subscriptions tab
async function loadRulesTab(selectedSubId) {
  const panel = document.getElementById('panel-rules');
  panel.textContent = '';

  const loading = document.createElement('div');
  loading.className = 'loading-state';
  const spinner = document.createElement('div');
  spinner.className = 'spinner';
  const loadingText = document.createElement('span');
  loadingText.textContent = 'Loading tag rules…';
  loading.appendChild(spinner);
  loading.appendChild(loadingText);
  panel.appendChild(loading);

  await loadConfig();
  renderRulesTab(selectedSubId || null);
}

function renderRulesTab(selectedSubId) {
  const panel = document.getElementById('panel-rules');
  panel.textContent = '';

  var config = getConfig();
  var configSubs = config.subscriptions || {};
  var enrolledSubs = _enrollmentCache || [];
  var subIds = enrolledSubs.map(function(s) { return s.subscriptionId; });
  if (subIds.length === 0) {
    subIds = Object.keys(configSubs);
  }
  var subDisplayNames = {};
  enrolledSubs.forEach(function(s) { subDisplayNames[s.subscriptionId] = s.displayName; });
  Object.keys(configSubs).forEach(function(id) {
    if (!subDisplayNames[id]) subDisplayNames[id] = configSubs[id].displayName || '';
  });

  // ── Controls bar ──────────────────────────────────────────────────────────
  const bar = document.createElement('div');
  bar.className = 'controls-bar';

  const titleEl = document.createElement('span');
  titleEl.className = 'controls-bar-title';
  titleEl.textContent = 'Tag Rules';
  bar.appendChild(titleEl);

  // Subscription selector
  const selectorWrapper = document.createElement('div');
  selectorWrapper.style.cssText = 'display:flex;align-items:center;gap:8px;';

  const selectorLabel = document.createElement('label');
  selectorLabel.setAttribute('for', 'rules-sub-selector');
  selectorLabel.style.cssText = 'font-size:0.875rem;color:var(--text-secondary);white-space:nowrap;';
  selectorLabel.textContent = 'Subscription:';

  const selector = document.createElement('select');
  selector.id = 'rules-sub-selector';
  selector.className = 'form-select';
  selector.style.cssText = 'min-width:220px;max-width:360px;';

  const placeholderOpt = document.createElement('option');
  placeholderOpt.value = '';
  placeholderOpt.textContent = subIds.length === 0 ? '— no subscriptions —' : '— select a subscription —';
  placeholderOpt.disabled = true;
  selector.appendChild(placeholderOpt);

  subIds.forEach(function(subId) {
    const opt = document.createElement('option');
    opt.value = subId;
    var name = (subDisplayNames[subId] || '').trim();
    opt.textContent = name ? name + ' (' + subId + ')' : subId;
    if (subId === selectedSubId) opt.selected = true;
    selector.appendChild(opt);
  });

  if (!selectedSubId && subIds.length > 0) {
    selector.value = '';
  }

  selector.addEventListener('change', function() {
    renderRulesTab(selector.value || null);
  });

  selectorWrapper.appendChild(selectorLabel);
  selectorWrapper.appendChild(selector);
  bar.appendChild(selectorWrapper);
  panel.appendChild(bar);

  // ── No subscriptions empty state ─────────────────────────────────────────
  if (subIds.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';

    const icon = document.createElement('div');
    icon.className = 'empty-state-icon';
    icon.textContent = '🏷️';

    const emptyTitle = document.createElement('div');
    emptyTitle.className = 'empty-state-title';
    emptyTitle.textContent = 'No enrolled subscriptions';

    const emptyDesc = document.createElement('div');
    emptyDesc.className = 'empty-state-desc';
    emptyDesc.textContent = 'Deploy enroll.bicep to an Azure subscription to start viewing tag rules.';

    empty.appendChild(icon);
    empty.appendChild(emptyTitle);
    empty.appendChild(emptyDesc);
    panel.appendChild(empty);
    return;
  }

  var hasCustomConfig = selectedSubId && !!configSubs[selectedSubId];

  if (!hasCustomConfig) {
    // Info banner — context-aware message
    var infoBanner = document.createElement('div');
    infoBanner.className = 'info-banner';

    var infoIcon = document.createElement('span');
    infoIcon.style.cssText = 'color:var(--info);font-size:16px;';
    infoIcon.textContent = '\u2139';

    var infoText = document.createElement('span');
    infoText.style.cssText = 'color:var(--info);font-size:0.8125rem;';

    if (!selectedSubId) {
      infoText.textContent = 'These global defaults are applied to all enrolled subscriptions. Select a subscription above to add custom overrides.';
    } else {
      infoText.textContent = 'This subscription uses global defaults only \u2014 no custom overrides configured. ';

      var addConfigLink = document.createElement('span');
      addConfigLink.style.cssText = 'cursor:pointer;text-decoration:underline;';
      addConfigLink.textContent = 'Add custom config';
      addConfigLink.addEventListener('click', async function() {
        var cfg = getConfig();
        var enrolledSub = (_enrollmentCache || []).find(function(s) { return s.subscriptionId === selectedSubId; });
        cfg.subscriptions[selectedSubId] = {
          displayName: (enrolledSub && enrolledSub.displayName) || selectedSubId,
          enabled: true,
          tagOverrides: {},
          resourceTypeRules: {},
        };
        var ok = await saveConfig(cfg);
        if (ok) {
          invalidateEnrollmentCache();
          renderRulesTab(selectedSubId);
        }
      });
      infoText.appendChild(addConfigLink);
    }

    infoBanner.appendChild(infoIcon);
    infoBanner.appendChild(infoText);
    panel.appendChild(infoBanner);

    // Read-only global defaults
    var sectionTitle = selectedSubId ? 'Effective Tag Map' : 'Global Default Tag Map';
    var sectionDesc = selectedSubId
      ? 'Read-only \u2014 global defaults applied to this subscription'
      : 'These tags are applied to every resource write event across all enrolled subscriptions';
    var globalSection = buildSection(sectionTitle, sectionDesc);
    var globalBody = globalSection.querySelector('.rules-section-body');

    var globalDefaults = [
      { name: 'Creator',        value: '{caller}',    overwrite: false },
      { name: 'CreatedOn',      value: '{timestamp}', overwrite: false },
      { name: 'LastModifiedBy', value: '{caller}',    overwrite: true  },
      { name: 'LastModifiedOn', value: '{timestamp}', overwrite: true  },
      { name: 'StampedBy',      value: 'Az-Stamper',  overwrite: false },
    ];

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

      var overwriteChip = document.createElement('span');
      overwriteChip.className = 'tag-chip ' + (def.overwrite ? 'tag-new' : 'tag-existing');
      overwriteChip.textContent = def.overwrite ? 'overwrite: true' : 'overwrite: false';

      row.appendChild(keyEl);
      row.appendChild(valueEl);
      row.appendChild(overwriteChip);
      globalBody.appendChild(row);
    });

    panel.appendChild(globalSection);
    return;
  }

  var subConfig = configSubs[selectedSubId];

  // ── Section A: Global Defaults (read-only) ────────────────────────────────
  var globalSection2 = buildSection('Global Defaults', 'Applied to all resources. Read-only — configure per-subscription overrides below.');

  var globalDefaults2 = [
    { name: 'Creator',        value: '{caller}',    overwrite: false },
    { name: 'CreatedOn',      value: '{timestamp}', overwrite: false },
    { name: 'LastModifiedBy', value: '{caller}',    overwrite: true  },
    { name: 'LastModifiedOn', value: '{timestamp}', overwrite: true  },
    { name: 'StampedBy',      value: 'Az-Stamper',  overwrite: false },
  ];

  var globalBody2 = globalSection2.querySelector('.rules-section-body');

  globalDefaults2.forEach(function(def) {
    var row = document.createElement('div');
    row.className = 'rule-row';

    const keyEl = document.createElement('div');
    keyEl.className = 'rule-key';
    keyEl.textContent = def.name;

    const valueEl = document.createElement('div');
    valueEl.className = 'rule-value';
    valueEl.style.fontFamily = 'monospace';
    valueEl.textContent = def.value;

    var overwriteChip = document.createElement('span');
    overwriteChip.className = 'tag-chip ' + (def.overwrite ? 'tag-new' : 'tag-existing');
    overwriteChip.textContent = def.overwrite ? 'overwrite: true' : 'overwrite: false';

    row.appendChild(keyEl);
    row.appendChild(valueEl);
    row.appendChild(overwriteChip);
    globalBody2.appendChild(row);
  });

  panel.appendChild(globalSection2);

  // ── Section B: Subscription Overrides (editable) ─────────────────────────
  var overridesSection = buildSection(
    'Subscription Overrides',
    'Per-subscription tag overrides that extend or replace global defaults for: ' +
    ((subConfig.displayName || '').trim() || selectedSubId)
  );
  panel.appendChild(overridesSection);
  const overridesBody = overridesSection.querySelector('.rules-section-body');

  // B1: Tag Overrides --------------------------------------------------------
  const tagOverridesSubsection = buildSubsection('Tag Overrides', overridesBody);
  const tagOverridesList = document.createElement('div');
  tagOverridesList.id = 'tag-overrides-list';
  tagOverridesSubsection.appendChild(tagOverridesList);

  const tagOverrides = subConfig.tagOverrides || {};
  Object.keys(tagOverrides).forEach(function(tagName) {
    const entry = tagOverrides[tagName];
    tagOverridesList.appendChild(buildTagOverrideRow(tagName, entry.value || '', entry.overwrite === true));
  });

  const addTagBtn = document.createElement('button');
  addTagBtn.className = 'btn btn-secondary btn-sm';
  addTagBtn.style.cssText = 'margin:10px 20px 14px;';
  addTagBtn.textContent = '+ Add Tag';
  addTagBtn.addEventListener('click', function() {
    tagOverridesList.appendChild(buildTagOverrideRow('', '', false));
    // Focus the new tag name input
    const rows = tagOverridesList.querySelectorAll('.tag-override-row');
    const lastRow = rows[rows.length - 1];
    if (lastRow) {
      const input = lastRow.querySelector('.tag-name-input');
      if (input) input.focus();
    }
  });
  tagOverridesSubsection.appendChild(addTagBtn);

  // B2: Resource Type Rules --------------------------------------------------
  const resourceRulesSubsection = buildSubsection('Resource Type Rules', overridesBody);
  const resourceRulesList = document.createElement('div');
  resourceRulesList.id = 'resource-rules-list';
  resourceRulesSubsection.appendChild(resourceRulesList);

  const resourceTypeRules = subConfig.resourceTypeRules || {};
  Object.keys(resourceTypeRules).forEach(function(resourceType) {
    const rule = resourceTypeRules[resourceType];
    resourceRulesList.appendChild(buildResourceTypeRuleRow(resourceType, rule));
  });

  const addRuleBtn = document.createElement('button');
  addRuleBtn.className = 'btn btn-secondary btn-sm';
  addRuleBtn.style.cssText = 'margin:10px 20px 14px;';
  addRuleBtn.textContent = '+ Add Rule';
  addRuleBtn.addEventListener('click', function() {
    resourceRulesList.appendChild(buildResourceTypeRuleRow('', { additionalTags: {}, excludeTags: [] }));
    const rows = resourceRulesList.querySelectorAll('.resource-rule-row');
    const lastRow = rows[rows.length - 1];
    if (lastRow) {
      const input = lastRow.querySelector('.resource-type-input');
      if (input) input.focus();
    }
  });
  resourceRulesSubsection.appendChild(addRuleBtn);

  // B3: Additional Ignore Patterns -------------------------------------------
  const ignoreSubsection = buildSubsection('Additional Ignore Patterns', overridesBody);
  const ignoreList = document.createElement('div');
  ignoreList.id = 'ignore-patterns-list';
  ignoreSubsection.appendChild(ignoreList);

  const ignorePatterns = subConfig.additionalIgnorePatterns || [];
  ignorePatterns.forEach(function(pattern) {
    ignoreList.appendChild(buildIgnorePatternRow(pattern));
  });

  const addPatternBtn = document.createElement('button');
  addPatternBtn.className = 'btn btn-secondary btn-sm';
  addPatternBtn.style.cssText = 'margin:10px 20px 14px;';
  addPatternBtn.textContent = '+ Add Pattern';
  addPatternBtn.addEventListener('click', function() {
    ignoreList.appendChild(buildIgnorePatternRow(''));
    const rows = ignoreList.querySelectorAll('.ignore-pattern-row');
    const lastRow = rows[rows.length - 1];
    if (lastRow) {
      const input = lastRow.querySelector('.ignore-pattern-input');
      if (input) input.focus();
    }
  });
  ignoreSubsection.appendChild(addPatternBtn);

  // ── Save / Reset buttons ──────────────────────────────────────────────────
  const actionBar = document.createElement('div');
  actionBar.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;margin-top:20px;';

  const resetBtn = document.createElement('button');
  resetBtn.className = 'btn btn-secondary';
  resetBtn.textContent = 'Reset';
  resetBtn.addEventListener('click', function() {
    renderRulesTab(selectedSubId);
  });

  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn btn-primary';
  saveBtn.textContent = 'Save';
  saveBtn.addEventListener('click', function() {
    saveRulesTab(selectedSubId, saveBtn);
  });

  actionBar.appendChild(resetBtn);
  actionBar.appendChild(saveBtn);
  panel.appendChild(actionBar);
}

// ── Builder helpers ────────────────────────────────────────────────────────

function buildSection(title, description) {
  const section = document.createElement('div');
  section.className = 'rules-section';
  section.style.marginBottom = '20px';

  const header = document.createElement('div');
  header.className = 'rules-section-header';

  const titleEl = document.createElement('div');
  titleEl.className = 'rules-section-title';
  titleEl.textContent = title;
  header.appendChild(titleEl);

  if (description) {
    const descEl = document.createElement('div');
    descEl.style.cssText = 'font-size:0.8125rem;color:var(--text-secondary);';
    descEl.textContent = description;
    header.appendChild(descEl);
  }

  section.appendChild(header);

  const body = document.createElement('div');
  body.className = 'rules-section-body';
  section.appendChild(body);

  return section;
}

function buildSubsection(title, parentEl) {
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'border-bottom:1px solid var(--border);padding-bottom:4px;margin-bottom:0;';

  const subHeader = document.createElement('div');
  subHeader.style.cssText = 'padding:10px 20px 6px;';

  const subTitle = document.createElement('div');
  subTitle.style.cssText = 'font-size:0.8125rem;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.06em;';
  subTitle.textContent = title;
  subHeader.appendChild(subTitle);

  wrapper.appendChild(subHeader);
  parentEl.appendChild(wrapper);

  return wrapper;
}

function buildTagOverrideRow(tagName, tagValue, overwrite) {
  const row = document.createElement('div');
  row.className = 'rule-row tag-override-row';
  row.style.flexWrap = 'nowrap';

  // Tag name
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'form-input tag-name-input';
  nameInput.style.cssText = 'width:180px;flex-shrink:0;';
  nameInput.placeholder = 'Tag name';
  nameInput.value = tagName;
  nameInput.setAttribute('aria-label', 'Tag name');

  // Tag value
  const valueInput = document.createElement('input');
  valueInput.type = 'text';
  valueInput.className = 'form-input tag-value-input';
  valueInput.style.cssText = 'flex:1;min-width:120px;';
  valueInput.placeholder = 'Value (e.g. {caller}, MyTeam)';
  valueInput.value = tagValue;
  valueInput.setAttribute('aria-label', 'Tag value');

  // Overwrite toggle
  const toggleId = 'overwrite-toggle-' + Math.random().toString(36).slice(2, 9);
  const toggleWrapper = document.createElement('label');
  toggleWrapper.className = 'toggle-wrapper';
  toggleWrapper.setAttribute('for', toggleId);
  toggleWrapper.style.flexShrink = '0';

  const toggleInput = document.createElement('input');
  toggleInput.type = 'checkbox';
  toggleInput.id = toggleId;
  toggleInput.className = 'toggle-input overwrite-toggle';
  toggleInput.checked = overwrite;

  const toggleTrack = document.createElement('span');
  toggleTrack.className = 'toggle-track';
  const toggleThumb = document.createElement('span');
  toggleThumb.className = 'toggle-thumb';
  toggleTrack.appendChild(toggleThumb);

  const toggleLabel = document.createElement('span');
  toggleLabel.className = 'toggle-label';
  toggleLabel.style.cssText = 'font-size:0.8125rem;color:var(--text-secondary);';
  toggleLabel.textContent = 'Overwrite';

  toggleWrapper.appendChild(toggleInput);
  toggleWrapper.appendChild(toggleTrack);
  toggleWrapper.appendChild(toggleLabel);

  // Remove button
  const removeBtn = document.createElement('button');
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

function buildResourceTypeRuleRow(resourceType, rule) {
  const additionalTags = rule.additionalTags || {};
  const excludeTags = rule.excludeTags || [];

  const row = document.createElement('div');
  row.className = 'rule-row resource-rule-row';
  row.style.cssText = 'flex-direction:column;align-items:stretch;gap:10px;padding:14px 20px;';

  // Top line: resource type input + remove
  const topLine = document.createElement('div');
  topLine.style.cssText = 'display:flex;align-items:center;gap:12px;';

  const rtInput = document.createElement('input');
  rtInput.type = 'text';
  rtInput.className = 'form-input resource-type-input';
  rtInput.style.cssText = 'flex:1;font-family:monospace;';
  rtInput.placeholder = 'e.g. Microsoft.Compute/virtualMachines';
  rtInput.value = resourceType;
  rtInput.setAttribute('aria-label', 'Resource type');

  const removeBtn = document.createElement('button');
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

  // Additional tags (JSON textarea for MVP)
  const additionalTagsGroup = document.createElement('div');
  additionalTagsGroup.className = 'form-group';

  const additionalTagsLabel = document.createElement('label');
  additionalTagsLabel.className = 'form-label';
  additionalTagsLabel.textContent = 'Additional Tags (JSON)';

  const additionalTagsTextarea = document.createElement('textarea');
  additionalTagsTextarea.className = 'form-textarea resource-additional-tags';
  additionalTagsTextarea.style.cssText = 'font-family:monospace;font-size:0.8125rem;min-height:70px;';
  additionalTagsTextarea.placeholder = '{ "Environment": { "value": "Prod", "overwrite": false } }';
  additionalTagsTextarea.value = Object.keys(additionalTags).length > 0
    ? JSON.stringify(additionalTags, null, 2)
    : '';
  additionalTagsTextarea.setAttribute('aria-label', 'Additional tags JSON');

  additionalTagsGroup.appendChild(additionalTagsLabel);
  additionalTagsGroup.appendChild(additionalTagsTextarea);
  row.appendChild(additionalTagsGroup);

  // Exclude tags (JSON textarea for MVP)
  const excludeTagsGroup = document.createElement('div');
  excludeTagsGroup.className = 'form-group';

  const excludeTagsLabel = document.createElement('label');
  excludeTagsLabel.className = 'form-label';
  excludeTagsLabel.textContent = 'Exclude Tags (JSON array)';

  const excludeTagsTextarea = document.createElement('textarea');
  excludeTagsTextarea.className = 'form-textarea resource-exclude-tags';
  excludeTagsTextarea.style.cssText = 'font-family:monospace;font-size:0.8125rem;min-height:50px;';
  excludeTagsTextarea.placeholder = '["Creator", "CreatedOn"]';
  excludeTagsTextarea.value = excludeTags.length > 0 ? JSON.stringify(excludeTags, null, 2) : '';
  excludeTagsTextarea.setAttribute('aria-label', 'Exclude tags JSON array');

  excludeTagsGroup.appendChild(excludeTagsLabel);
  excludeTagsGroup.appendChild(excludeTagsTextarea);
  row.appendChild(excludeTagsGroup);

  return row;
}

function buildIgnorePatternRow(pattern) {
  const row = document.createElement('div');
  row.className = 'rule-row ignore-pattern-row';
  row.style.flexWrap = 'nowrap';

  const patternInput = document.createElement('input');
  patternInput.type = 'text';
  patternInput.className = 'form-input ignore-pattern-input';
  patternInput.style.cssText = 'flex:1;font-family:monospace;';
  patternInput.placeholder = 'e.g. /subscriptions/*/resourceGroups/rg-infra/*';
  patternInput.value = pattern;
  patternInput.setAttribute('aria-label', 'Ignore pattern');

  const removeBtn = document.createElement('button');
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

// ── Save ────────────────────────────────────────────────────────────────────

async function saveRulesTab(subId, saveBtn) {
  const config = getConfig();
  if (!config.subscriptions[subId]) {
    showToast('Subscription not found in config', 'error');
    return;
  }

  // ── Collect tag overrides ──────────────────────────────────────────────
  const tagOverrides = {};
  let hasValidationError = false;

  const tagOverrideRows = document.querySelectorAll('#tag-overrides-list .tag-override-row');
  tagOverrideRows.forEach(function(row) {
    const nameInput = row.querySelector('.tag-name-input');
    const valueInput = row.querySelector('.tag-value-input');
    const overwriteToggle = row.querySelector('.overwrite-toggle');

    const name = (nameInput ? nameInput.value : '').trim();
    const value = (valueInput ? valueInput.value : '').trim();
    const overwrite = overwriteToggle ? overwriteToggle.checked : false;

    if (!name) {
      if (nameInput) nameInput.style.borderColor = 'var(--error)';
      hasValidationError = true;
      return;
    }

    if (nameInput) nameInput.style.borderColor = '';
    tagOverrides[name] = { value: value, overwrite: overwrite };
  });

  if (hasValidationError) {
    showToast('Tag name cannot be empty — fix highlighted fields', 'error');
    return;
  }

  // ── Collect resource type rules ────────────────────────────────────────
  const resourceTypeRules = {};

  const resourceRuleRows = document.querySelectorAll('#resource-rules-list .resource-rule-row');
  for (let i = 0; i < resourceRuleRows.length; i++) {
    const row = resourceRuleRows[i];
    const rtInput = row.querySelector('.resource-type-input');
    const additionalTagsEl = row.querySelector('.resource-additional-tags');
    const excludeTagsEl = row.querySelector('.resource-exclude-tags');

    const resourceType = (rtInput ? rtInput.value : '').trim();
    if (!resourceType) {
      if (rtInput) rtInput.style.borderColor = 'var(--error)';
      hasValidationError = true;
      continue;
    }
    if (rtInput) rtInput.style.borderColor = '';

    let additionalTags = {};
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

    let excludeTags = [];
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

  // ── Collect ignore patterns ────────────────────────────────────────────
  const additionalIgnorePatterns = [];
  const ignorePatternRows = document.querySelectorAll('#ignore-patterns-list .ignore-pattern-row');
  ignorePatternRows.forEach(function(row) {
    const patternInput = row.querySelector('.ignore-pattern-input');
    const pattern = (patternInput ? patternInput.value : '').trim();
    if (pattern) additionalIgnorePatterns.push(pattern);
  });

  // ── Build updated subscription config ─────────────────────────────────
  const updatedSub = Object.assign({}, config.subscriptions[subId], {
    tagOverrides: tagOverrides,
    resourceTypeRules: resourceTypeRules,
    additionalIgnorePatterns: additionalIgnorePatterns,
  });

  config.subscriptions[subId] = updatedSub;

  if (saveBtn) saveBtn.disabled = true;
  const ok = await saveConfig(config);
  if (saveBtn) saveBtn.disabled = false;
}

// Expose entry point on window so tab-switcher inline script can call it
window.loadRulesTab = loadRulesTab;
