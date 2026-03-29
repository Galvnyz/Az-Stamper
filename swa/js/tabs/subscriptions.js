// Subscriptions Tab -- card list, add/remove/toggle per subscription

async function loadSubscriptionsTab() {
  const panel = document.getElementById('panel-subscriptions');
  panel.textContent = '';

  const loading = document.createElement('div');
  loading.className = 'loading-state';
  const spinner = document.createElement('div');
  spinner.className = 'spinner';
  const loadingText = document.createElement('span');
  loadingText.textContent = 'Loading subscriptions…';
  loading.appendChild(spinner);
  loading.appendChild(loadingText);
  panel.appendChild(loading);

  await loadConfig();
  renderSubscriptionsTab();
}

function renderSubscriptionsTab() {
  const panel = document.getElementById('panel-subscriptions');
  panel.textContent = '';

  const config = getConfig();
  const subs = config.subscriptions || {};
  const subIds = Object.keys(subs);

  // Controls bar
  const bar = document.createElement('div');
  bar.className = 'controls-bar';

  const titleEl = document.createElement('span');
  titleEl.className = 'controls-bar-title';
  titleEl.textContent = 'Subscriptions';
  bar.appendChild(titleEl);

  const addBtn = document.createElement('button');
  addBtn.className = 'btn btn-primary';
  addBtn.textContent = '+ Add Subscription';
  addBtn.addEventListener('click', openAddSubscriptionModal);
  bar.appendChild(addBtn);
  panel.appendChild(bar);

  // Empty state
  if (subIds.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';

    const icon = document.createElement('div');
    icon.className = 'empty-state-icon';
    icon.textContent = '🔒';

    const emptyTitle = document.createElement('div');
    emptyTitle.className = 'empty-state-title';
    emptyTitle.textContent = 'No subscriptions configured';

    const emptyDesc = document.createElement('div');
    emptyDesc.className = 'empty-state-desc';
    emptyDesc.textContent = 'Add a subscription to start managing tag rules for your Azure environments.';

    empty.appendChild(icon);
    empty.appendChild(emptyTitle);
    empty.appendChild(emptyDesc);
    panel.appendChild(empty);
    return;
  }

  // Card grid
  const grid = document.createElement('div');
  grid.className = 'card-grid';

  subIds.forEach(function(subId) {
    const sub = subs[subId];
    const card = buildSubscriptionCard(subId, sub);
    grid.appendChild(card);
  });

  panel.appendChild(grid);
}

function buildSubscriptionCard(subId, sub) {
  const displayName = sub.displayName || '';
  const enabled = sub.enabled !== false; // default true per schema
  const tagOverrideCount = Object.keys(sub.tagOverrides || {}).length;
  const resourceRuleCount = Object.keys(sub.resourceTypeRules || {}).length;

  const card = document.createElement('div');
  card.className = 'card';
  card.style.cursor = 'pointer';

  // Header row: title block + enabled badge
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:8px;';

  const titleBlock = document.createElement('div');
  titleBlock.style.minWidth = '0';

  const cardTitle = document.createElement('div');
  cardTitle.className = 'card-title';
  cardTitle.style.cssText = 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
  if (displayName) {
    cardTitle.textContent = displayName;
  } else {
    const placeholder = document.createElement('span');
    placeholder.style.cssText = 'color:var(--text-muted);font-style:italic;';
    placeholder.textContent = 'Unnamed';
    cardTitle.appendChild(placeholder);
  }

  const cardSubtitle = document.createElement('div');
  cardSubtitle.className = 'card-subtitle';
  cardSubtitle.style.cssText = 'font-family:monospace;word-break:break-all;';
  cardSubtitle.textContent = subId;

  titleBlock.appendChild(cardTitle);
  titleBlock.appendChild(cardSubtitle);

  const badge = document.createElement('span');
  badge.setAttribute('data-badge', '');
  badge.className = 'badge ' + (enabled ? 'badge-enabled' : 'badge-disabled');
  badge.textContent = enabled ? 'Enabled' : 'Disabled';

  header.appendChild(titleBlock);
  header.appendChild(badge);
  card.appendChild(header);

  // Counts row
  const body = document.createElement('div');
  body.className = 'card-body';
  body.style.marginBottom = '16px';

  const counts = document.createElement('div');
  counts.style.cssText = 'display:flex;gap:16px;flex-wrap:wrap;';

  function makeCounter(value, label) {
    const item = document.createElement('div');
    const val = document.createElement('div');
    val.style.cssText = 'font-size:1.25rem;font-weight:700;color:var(--text-primary);';
    val.textContent = String(value);
    const lbl = document.createElement('div');
    lbl.style.cssText = 'font-size:0.75rem;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.05em;';
    lbl.textContent = label;
    item.appendChild(val);
    item.appendChild(lbl);
    return item;
  }

  counts.appendChild(makeCounter(tagOverrideCount, 'Tag Overrides'));
  counts.appendChild(makeCounter(resourceRuleCount, 'Resource Rules'));
  body.appendChild(counts);
  card.appendChild(body);

  // Footer: toggle + remove. Stops propagation to avoid triggering card click.
  const footer = document.createElement('div');
  footer.className = 'card-footer';
  footer.addEventListener('click', function(e) {
    e.stopPropagation();
  });

  // Toggle (CSS-only: .toggle-input / .toggle-track / .toggle-thumb)
  const safeToggleId = 'toggle-' + subId.replace(/[^a-zA-Z0-9]/g, '-');
  const toggleWrapper = document.createElement('label');
  toggleWrapper.className = 'toggle-wrapper';
  toggleWrapper.setAttribute('for', safeToggleId);

  const toggleInput = document.createElement('input');
  toggleInput.type = 'checkbox';
  toggleInput.id = safeToggleId;
  toggleInput.className = 'toggle-input';
  toggleInput.checked = enabled;
  toggleInput.addEventListener('change', function() {
    toggleSubscription(subId, toggleInput.checked);
  });

  const toggleTrack = document.createElement('span');
  toggleTrack.className = 'toggle-track';
  const toggleThumb = document.createElement('span');
  toggleThumb.className = 'toggle-thumb';
  toggleTrack.appendChild(toggleThumb);

  const toggleLabel = document.createElement('span');
  toggleLabel.className = 'toggle-label';
  toggleLabel.textContent = 'Enabled';

  toggleWrapper.appendChild(toggleInput);
  toggleWrapper.appendChild(toggleTrack);
  toggleWrapper.appendChild(toggleLabel);
  footer.appendChild(toggleWrapper);

  // Remove button
  const removeBtn = document.createElement('button');
  removeBtn.className = 'btn btn-danger btn-sm';
  removeBtn.textContent = 'Remove';
  removeBtn.addEventListener('click', function() {
    openRemoveSubscriptionModal(subId, displayName);
  });
  footer.appendChild(removeBtn);

  card.appendChild(footer);

  // Clicking the card navigates to the rules tab
  card.addEventListener('click', function() {
    navigateToRules(subId);
  });

  return card;
}

async function toggleSubscription(subId, newEnabled) {
  const config = getConfig();
  if (!config.subscriptions[subId]) return;

  config.subscriptions[subId].enabled = newEnabled;
  const ok = await saveConfig(config);

  if (ok) {
    // Update badge in place without full re-render
    const safeToggleId = 'toggle-' + subId.replace(/[^a-zA-Z0-9]/g, '-');
    const toggleEl = document.getElementById(safeToggleId);
    if (toggleEl) {
      const badgeEl = toggleEl.closest('.card').querySelector('[data-badge]');
      if (badgeEl) {
        badgeEl.className = 'badge ' + (newEnabled ? 'badge-enabled' : 'badge-disabled');
        badgeEl.textContent = newEnabled ? 'Enabled' : 'Disabled';
      }
    }
  } else {
    // Revert checkbox on save failure
    const safeToggleId = 'toggle-' + subId.replace(/[^a-zA-Z0-9]/g, '-');
    const toggleEl = document.getElementById(safeToggleId);
    if (toggleEl) toggleEl.checked = !newEnabled;
  }
}

async function openAddSubscriptionModal() {
  // Fetch available subscriptions from ARM
  var token = await getManagementToken();
  var availableSubs = [];
  if (token) {
    try {
      var data = await azureFetch(
        'https://management.azure.com/subscriptions?api-version=2022-12-01',
        token
      );
      availableSubs = (data && data.value) ? data.value : [];
    } catch (err) {
      console.error('Failed to fetch subscriptions:', err);
    }
  }

  // Filter out already-added subscriptions
  var config = getConfig();
  var existing = config.subscriptions || {};
  availableSubs = availableSubs.filter(function(s) {
    return !existing[s.subscriptionId];
  });

  // Build modal body
  var formWrapper = document.createElement('div');

  if (availableSubs.length === 0) {
    var emptyMsg = document.createElement('p');
    emptyMsg.style.cssText = 'color:var(--text-secondary);font-size:0.875rem;';
    emptyMsg.textContent = token
      ? 'All accessible subscriptions have been added.'
      : 'Could not load subscriptions. Check your permissions.';
    formWrapper.appendChild(emptyMsg);
  } else {
    var selectLabel = document.createElement('label');
    selectLabel.className = 'form-label';
    selectLabel.setAttribute('for', 'new-sub-select');
    selectLabel.textContent = 'Select Subscription';

    var select = document.createElement('select');
    select.id = 'new-sub-select';
    select.className = 'form-input';

    availableSubs.sort(function(a, b) {
      return a.displayName.localeCompare(b.displayName);
    });

    availableSubs.forEach(function(sub) {
      var opt = document.createElement('option');
      opt.value = sub.subscriptionId;
      opt.textContent = sub.displayName + ' (' + sub.subscriptionId.substring(0, 8) + '…)';
      select.appendChild(opt);
    });

    var selectGroup = document.createElement('div');
    selectGroup.className = 'form-group';
    selectGroup.appendChild(selectLabel);
    selectGroup.appendChild(select);
    formWrapper.appendChild(selectGroup);
  }

  // Store subs on the wrapper so confirmAdd can read them
  formWrapper._availableSubs = availableSubs;

  // Build action buttons with DOM (no inline onclick — CSP safe)
  var cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn btn-secondary';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', closeModal);

  var addBtn = document.createElement('button');
  addBtn.className = 'btn btn-primary';
  addBtn.textContent = 'Add';
  if (availableSubs.length === 0) addBtn.disabled = true;
  addBtn.addEventListener('click', function() {
    confirmAddSubscription(formWrapper._availableSubs);
  });

  showModalDOM('Add Subscription', formWrapper, [cancelBtn, addBtn]);

  setTimeout(function() {
    var field = document.getElementById('new-sub-select');
    if (field) field.focus();
  }, 50);
}

async function confirmAddSubscription(availableSubs) {
  var select = document.getElementById('new-sub-select');
  if (!select) return;

  var subId = select.value;
  if (!subId) return;

  var sub = availableSubs.find(function(s) { return s.subscriptionId === subId; });
  var displayName = sub ? sub.displayName : subId;

  var config = getConfig();
  if (config.subscriptions[subId]) {
    showToast('Subscription already added', 'error');
    return;
  }

  config.subscriptions[subId] = {
    displayName: displayName,
    enabled: true,
    tagOverrides: {},
    resourceTypeRules: {},
  };

  var ok = await saveConfig(config);
  if (ok) {
    closeModal();
    renderSubscriptionsTab();
  }
}

function openRemoveSubscriptionModal(subId, displayName) {
  // Build confirmation body with safe DOM methods so no user content touches HTML strings
  const bodyEl = document.createElement('div');

  const p1 = document.createElement('p');
  p1.style.color = 'var(--text-secondary)';
  p1.appendChild(document.createTextNode('Are you sure you want to remove '));
  const strong = document.createElement('strong');
  strong.style.color = 'var(--text-primary)';
  strong.textContent = displayName || subId;
  p1.appendChild(strong);
  p1.appendChild(document.createTextNode('?'));

  const p2 = document.createElement('p');
  p2.style.cssText = 'color:var(--text-muted);font-size:0.8125rem;margin-top:8px;';
  p2.textContent = subId;

  const p3 = document.createElement('p');
  p3.style.cssText = 'color:var(--error);font-size:0.8125rem;margin-top:12px;';
  p3.textContent = 'This will delete all tag overrides and resource rules for this subscription.';

  bodyEl.appendChild(p1);
  bodyEl.appendChild(p2);
  bodyEl.appendChild(p3);

  var cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn btn-secondary';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', closeModal);

  var removeBtn = document.createElement('button');
  removeBtn.className = 'btn btn-danger';
  removeBtn.textContent = 'Remove';
  removeBtn.addEventListener('click', function() {
    confirmRemoveSubscription(subId);
  });

  showModalDOM('Remove Subscription', bodyEl, [cancelBtn, removeBtn]);
}

async function confirmRemoveSubscription(subId) {
  const config = getConfig();
  if (!config.subscriptions[subId]) {
    closeModal();
    return;
  }

  delete config.subscriptions[subId];

  const ok = await saveConfig(config);
  if (ok) {
    closeModal();
    renderSubscriptionsTab();
  }
}

function navigateToRules(subId) {
  // Update tab indicator
  document.querySelectorAll('.tab').forEach(function(t) {
    t.classList.remove('active');
  });
  document.querySelectorAll('.tab-panel').forEach(function(p) {
    p.classList.remove('active');
  });

  const rulesTab = document.querySelector('.tab[data-tab="rules"]');
  if (rulesTab) rulesTab.classList.add('active');

  const rulesPanel = document.getElementById('panel-rules');
  if (rulesPanel) rulesPanel.classList.add('active');

  // Delegate to rules tab loader (defined in Task 5)
  if (typeof window.loadRulesTab === 'function') {
    window.loadRulesTab(subId);
  }
}

window.loadSubscriptionsTab = loadSubscriptionsTab;
