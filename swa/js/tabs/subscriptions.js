// Subscriptions Tab -- enrollment-centric: reads from Event Grid, not stamper.json config

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
  titleEl.textContent = 'Enrolled Subscriptions';
  bar.appendChild(titleEl);

  var refreshBtn = document.createElement('button');
  refreshBtn.className = 'btn btn-secondary';
  refreshBtn.textContent = 'Refresh';
  refreshBtn.addEventListener('click', async function() {
    invalidateEnrollmentCache();
    var fresh = await refreshEnrollment();
    renderSubscriptionsTab(fresh);
  });
  bar.appendChild(refreshBtn);
  panel.appendChild(bar);

  // Global defaults info banner
  var banner = document.createElement('div');
  banner.className = 'info-banner';

  var bannerIcon = document.createElement('span');
  bannerIcon.textContent = '\u2699';
  bannerIcon.style.cssText = 'font-size:1.25rem;margin-right:8px;vertical-align:middle;';

  var bannerTitle = document.createElement('strong');
  bannerTitle.textContent = 'Global Default Tags';

  var bannerDesc = document.createElement('span');
  bannerDesc.style.cssText = 'color:var(--text-secondary);font-size:0.875rem;margin-left:8px;';
  bannerDesc.textContent = 'Applied to all enrolled subscriptions unless overridden by a custom config.';

  var bannerLink = document.createElement('a');
  bannerLink.href = '#';
  bannerLink.style.cssText = 'margin-left:12px;font-size:0.875rem;';
  bannerLink.textContent = 'View in Tag Rules \u2192';
  bannerLink.addEventListener('click', function(e) {
    e.preventDefault();
    navigateToRules(null);
  });

  banner.appendChild(bannerIcon);
  banner.appendChild(bannerTitle);
  banner.appendChild(bannerDesc);
  banner.appendChild(bannerLink);
  panel.appendChild(banner);

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

  // Card grid
  var grid = document.createElement('div');
  grid.className = 'card-grid';

  enrolled.forEach(function(sub) {
    var card = buildEnrolledCard(sub);
    grid.appendChild(card);
  });

  panel.appendChild(grid);
}

function buildEnrolledCard(sub) {
  var isActive = sub.active !== false;

  var card = document.createElement('div');
  card.className = 'card';
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

  var statusBadge = document.createElement('span');
  statusBadge.className = 'badge ' + (isActive ? 'badge-enabled' : 'badge-warning');
  statusBadge.textContent = isActive ? 'Active' : 'Paused';
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

  if (!isActive) {
    var pausedMsg = document.createElement('div');
    pausedMsg.style.cssText = 'color:var(--warning);font-size:0.875rem;';
    pausedMsg.textContent = 'Event Grid delivery paused \u2014 no tags being applied';
    body.appendChild(pausedMsg);
  } else if (sub.hasCustomConfig) {
    var config = getConfig();
    var subConfig = (config.subscriptions && config.subscriptions[sub.subscriptionId]) || {};
    var tagOverrideCount = Object.keys(subConfig.tagOverrides || {}).length;
    var resourceRuleCount = Object.keys(subConfig.resourceTypeRules || {}).length;

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
  toggleInput.addEventListener('change', function() {
    handleTaggingToggle(sub, toggleInput);
  });

  var toggleTrack = document.createElement('span');
  toggleTrack.className = 'toggle-track';
  var toggleThumb = document.createElement('span');
  toggleThumb.className = 'toggle-thumb';
  toggleTrack.appendChild(toggleThumb);

  var toggleLabel = document.createElement('span');
  toggleLabel.className = 'toggle-label';
  toggleLabel.setAttribute('data-toggle-label', sub.subscriptionId);
  toggleLabel.textContent = isActive ? 'Tagging active' : 'Tagging paused';

  toggleWrapper.appendChild(toggleInput);
  toggleWrapper.appendChild(toggleTrack);
  toggleWrapper.appendChild(toggleLabel);
  footer.appendChild(toggleWrapper);

  // Config action button
  var configBtn = document.createElement('button');
  if (sub.hasCustomConfig) {
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

  // Clicking the card navigates to the rules tab
  card.addEventListener('click', function() {
    navigateToRules(sub.subscriptionId);
  });

  return card;
}

async function handleTaggingToggle(sub, toggleInput) {
  var turningOn = toggleInput.checked;
  var labelEl = document.querySelector('[data-toggle-label="' + sub.subscriptionId + '"]');

  try {
    if (turningOn) {
      await resumeEnrollment(sub);
      showToast('Tagging resumed for ' + (sub.displayName || sub.subscriptionId), 'info');
    } else {
      await pauseEnrollment(sub);
      showToast('Tagging paused for ' + (sub.displayName || sub.subscriptionId), 'warning');
    }
    if (labelEl) {
      labelEl.textContent = turningOn ? 'Tagging active' : 'Tagging paused';
    }
    invalidateEnrollmentCache();
  } catch (err) {
    // Revert toggle on error
    toggleInput.checked = !turningOn;
    var msg = String(err && err.message ? err.message : err);
    if (msg.indexOf('403') !== -1) {
      showToast('Insufficient permissions \u2014 EventGrid Contributor required', 'error');
    } else {
      showToast('Failed to update tagging state: ' + msg, 'error');
    }
  }
}

async function addCustomConfig(sub) {
  var config = getConfig();
  if (!config.subscriptions) {
    config.subscriptions = {};
  }
  if (!config.subscriptions[sub.subscriptionId]) {
    config.subscriptions[sub.subscriptionId] = {
      displayName: sub.displayName || sub.subscriptionId,
      tagOverrides: {},
      resourceTypeRules: {},
    };
  }

  var ok = await saveConfig(config);
  if (ok) {
    invalidateEnrollmentCache();
    var enrolled = await discoverEnrollment();
    renderSubscriptionsTab(enrolled);
  }
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
    invalidateEnrollmentCache();
    var enrolled = await discoverEnrollment();
    renderSubscriptionsTab(enrolled);
  }
}

function navigateToRules(subId) {
  // Update tab indicators
  document.querySelectorAll('.tab').forEach(function(t) {
    t.classList.remove('active');
  });
  document.querySelectorAll('.tab-panel').forEach(function(p) {
    p.classList.remove('active');
  });

  var rulesTab = document.querySelector('.tab[data-tab="rules"]');
  if (rulesTab) rulesTab.classList.add('active');

  var rulesPanel = document.getElementById('panel-rules');
  if (rulesPanel) rulesPanel.classList.add('active');

  if (typeof window.loadRulesTab === 'function') {
    window.loadRulesTab(subId);
  }
}

window.loadSubscriptionsTab = loadSubscriptionsTab;
