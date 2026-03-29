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

function openAddSubscriptionModal() {
  // Modal form body contains only static HTML (no user content) -- safe
  const subIdLabel = document.createElement('label');
  subIdLabel.className = 'form-label';
  subIdLabel.setAttribute('for', 'new-sub-id');
  subIdLabel.textContent = 'Subscription ID';

  const subIdInput = document.createElement('input');
  subIdInput.id = 'new-sub-id';
  subIdInput.className = 'form-input';
  subIdInput.type = 'text';
  subIdInput.placeholder = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx';
  subIdInput.autocomplete = 'off';

  const subIdGroup = document.createElement('div');
  subIdGroup.className = 'form-group';
  subIdGroup.appendChild(subIdLabel);
  subIdGroup.appendChild(subIdInput);

  const subNameLabel = document.createElement('label');
  subNameLabel.className = 'form-label';
  subNameLabel.setAttribute('for', 'new-sub-name');
  subNameLabel.textContent = 'Display Name';

  const subNameInput = document.createElement('input');
  subNameInput.id = 'new-sub-name';
  subNameInput.className = 'form-input';
  subNameInput.type = 'text';
  subNameInput.placeholder = 'e.g. Production Hub';
  subNameInput.autocomplete = 'off';

  const subNameGroup = document.createElement('div');
  subNameGroup.className = 'form-group';
  subNameGroup.style.marginTop = '14px';
  subNameGroup.appendChild(subNameLabel);
  subNameGroup.appendChild(subNameInput);

  const formWrapper = document.createElement('div');
  formWrapper.appendChild(subIdGroup);
  formWrapper.appendChild(subNameGroup);

  const actionsHtml =
    '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
    '<button class="btn btn-primary" id="confirm-add-sub-btn">Add</button>';

  showModal('Add Subscription', '<div id="add-sub-form-placeholder"></div>', actionsHtml);

  const placeholder = document.getElementById('add-sub-form-placeholder');
  if (placeholder) placeholder.replaceWith(formWrapper);

  document.getElementById('confirm-add-sub-btn').addEventListener('click', confirmAddSubscription);

  // Allow Enter to submit from either field
  document.getElementById('new-sub-id').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') confirmAddSubscription();
  });
  document.getElementById('new-sub-name').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') confirmAddSubscription();
  });

  setTimeout(function() {
    const field = document.getElementById('new-sub-id');
    if (field) field.focus();
  }, 50);
}

async function confirmAddSubscription() {
  const subIdInput = document.getElementById('new-sub-id');
  const subNameInput = document.getElementById('new-sub-name');
  if (!subIdInput || !subNameInput) return;

  const subId = (subIdInput.value || '').trim();
  const displayName = (subNameInput.value || '').trim();

  if (!subId) {
    subIdInput.style.borderColor = 'var(--error)';
    subIdInput.focus();
    return;
  }

  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(subId)) {
    subIdInput.style.borderColor = 'var(--error)';
    showToast('Subscription ID must be a valid UUID (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)', 'error');
    subIdInput.focus();
    return;
  }

  const config = getConfig();
  if (config.subscriptions[subId]) {
    subIdInput.style.borderColor = 'var(--error)';
    showToast('Subscription ID already exists', 'error');
    subIdInput.focus();
    return;
  }

  config.subscriptions[subId] = {
    displayName: displayName || subId,
    enabled: true,
    tagOverrides: {},
    resourceTypeRules: {},
  };

  const ok = await saveConfig(config);
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

  const actionsHtml =
    '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
    '<button class="btn btn-danger" id="confirm-remove-sub-btn">Remove</button>';

  showModal('Remove Subscription', '<div id="remove-sub-body-placeholder"></div>', actionsHtml);

  const placeholder = document.getElementById('remove-sub-body-placeholder');
  if (placeholder) placeholder.replaceWith(bodyEl);

  document.getElementById('confirm-remove-sub-btn').addEventListener('click', function() {
    confirmRemoveSubscription(subId);
  });
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
