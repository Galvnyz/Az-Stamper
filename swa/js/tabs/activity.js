// Activity Tab — recent tagging events from Application Insights

var _activityTimeRange = '1d';

// ── Entry point ───────────────────────────────────────────────────────────────

function loadActivityTab() {
  var panel = document.getElementById('panel-activity');
  panel.textContent = '';
  renderActivityControls();
  refreshActivity();
}

window.loadActivityTab = loadActivityTab;

// ── Controls bar ─────────────────────────────────────────────────────────────

function renderActivityControls() {
  var panel = document.getElementById('panel-activity');
  panel.textContent = '';

  var bar = document.createElement('div');
  bar.className = 'controls-bar';
  bar.style.flexWrap = 'wrap';
  bar.style.gap = '10px';

  var titleEl = document.createElement('span');
  titleEl.className = 'controls-bar-title';
  titleEl.textContent = 'Activity';
  bar.appendChild(titleEl);

  // Time range selector
  var rangeWrapper = document.createElement('div');
  rangeWrapper.style.cssText = 'display:flex;align-items:center;gap:8px;flex-shrink:0;';

  var rangeLabel = document.createElement('label');
  rangeLabel.setAttribute('for', 'activity-time-range');
  rangeLabel.style.cssText = 'font-size:0.875rem;color:var(--text-secondary);white-space:nowrap;';
  rangeLabel.textContent = 'Time range:';
  rangeWrapper.appendChild(rangeLabel);

  var rangeSelect = document.createElement('select');
  rangeSelect.id = 'activity-time-range';
  rangeSelect.className = 'form-input';
  rangeSelect.style.cssText = 'width:auto;padding:6px 10px;font-size:0.875rem;';

  var rangeOptions = [
    { value: '1h',  label: 'Last 1 hour' },
    { value: '1d',  label: 'Last 24 hours' },
    { value: '7d',  label: 'Last 7 days' },
  ];

  rangeOptions.forEach(function(opt) {
    var option = document.createElement('option');
    option.value = opt.value;
    option.textContent = opt.label;
    if (opt.value === _activityTimeRange) option.selected = true;
    rangeSelect.appendChild(option);
  });

  rangeSelect.addEventListener('change', function() {
    _activityTimeRange = rangeSelect.value;
    refreshActivity();
  });
  rangeWrapper.appendChild(rangeSelect);
  bar.appendChild(rangeWrapper);

  // Refresh button
  var refreshBtn = document.createElement('button');
  refreshBtn.id = 'activity-refresh-btn';
  refreshBtn.className = 'btn btn-secondary';
  refreshBtn.textContent = 'Refresh';
  refreshBtn.addEventListener('click', function() {
    refreshActivity();
  });
  bar.appendChild(refreshBtn);

  panel.appendChild(bar);

  // Results container
  var resultsContainer = document.createElement('div');
  resultsContainer.id = 'activity-results';
  panel.appendChild(resultsContainer);
}

// ── Data loading ──────────────────────────────────────────────────────────────

async function refreshActivity() {
  var resultsEl = document.getElementById('activity-results');
  if (!resultsEl) return;

  // Disable refresh button while loading
  var refreshBtn = document.getElementById('activity-refresh-btn');
  if (refreshBtn) {
    refreshBtn.disabled = true;
    refreshBtn.textContent = 'Loading…';
  }

  // Show loading state
  resultsEl.textContent = '';
  var loading = document.createElement('div');
  loading.className = 'loading-state';
  var spinner = document.createElement('div');
  spinner.className = 'spinner';
  var loadingText = document.createElement('span');
  loadingText.textContent = 'Loading activity…';
  loading.appendChild(spinner);
  loading.appendChild(loadingText);
  resultsEl.appendChild(loading);

  try {
    var appInsightsId = (window.AZ_STAMPER_CONFIG || {}).appInsightsId;

    if (!appInsightsId) {
      renderActivityEmpty(resultsEl, 'Application Insights not configured', 'Set appInsightsId in the site configuration to view tagging activity.');
      return;
    }

    var token = await getManagementToken();
    if (!token) {
      renderActivityEmpty(resultsEl, 'Not signed in', 'Sign in to view tagging activity.');
      return;
    }

    var timeRange = document.getElementById('activity-time-range');
    var range = (timeRange && timeRange.value) ? timeRange.value : _activityTimeRange;

    var kql = [
      'traces',
      '| where timestamp > ago(' + range + ')',
      '| where message contains "Stamped" or message contains "skipping" or message contains "Failed"',
      '| extend ResourceId = tostring(customDimensions.prop__ResourceId)',
      '| extend SubscriptionId = extract("/subscriptions/([^/]+)", 1, ResourceId)',
      '| extend ResourceType = extract("/providers/([^/]+/[^/]+)", 1, ResourceId)',
      '| extend ResourceName = extract("[^/]+$", 0, ResourceId)',
      '| project timestamp, ResourceName, ResourceType, SubscriptionId, message',
      '| order by timestamp desc',
      '| take 100',
    ].join('\n');

    var url = 'https://management.azure.com' + appInsightsId + '/query?api-version=2018-04-20';

    var data = await azureFetch(url, token, {
      method: 'POST',
      body: JSON.stringify({ query: kql }),
    });

    var rows = parseAppInsightsResponse(data);
    renderActivityResults(resultsEl, rows);

  } catch (err) {
    console.error('Activity fetch error:', err);
    showToast('Failed to load activity: ' + err.message, 'error');
    renderActivityEmpty(resultsEl, 'Failed to load activity', err.message);
  } finally {
    if (refreshBtn) {
      refreshBtn.disabled = false;
      refreshBtn.textContent = 'Refresh';
    }
  }
}

// ── Response parsing ──────────────────────────────────────────────────────────

function parseAppInsightsResponse(data) {
  if (!data || !data.tables || !data.tables[0]) return [];

  var table = data.tables[0];
  var columns = (table.columns || []).map(function(c) { return c.name; });
  var rawRows = table.rows || [];

  return rawRows.map(function(row) {
    var obj = {};
    columns.forEach(function(col, i) {
      obj[col] = row[i];
    });
    return obj;
  });
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function renderActivityResults(container, rows) {
  container.textContent = '';

  if (!rows || rows.length === 0) {
    renderActivityEmpty(container, 'No events found', 'No tagging events were recorded in the selected time range.');
    return;
  }

  // Summary bar
  var summary = document.createElement('div');
  summary.style.cssText = 'display:flex;align-items:center;gap:12px;padding:10px 0 14px 0;color:var(--text-secondary);font-size:0.875rem;';
  var countSpan = document.createElement('span');
  countSpan.style.fontWeight = '600';
  countSpan.style.color = 'var(--text-primary)';
  countSpan.textContent = rows.length + ' event' + (rows.length === 1 ? '' : 's');
  summary.appendChild(countSpan);
  container.appendChild(summary);

  // Table wrapper for overflow
  var tableWrapper = document.createElement('div');
  tableWrapper.style.cssText = 'overflow-x:auto;';

  var table = document.createElement('table');
  table.style.cssText = 'width:100%;border-collapse:collapse;font-size:0.875rem;';

  // Header
  var thead = document.createElement('thead');
  var headerRow = document.createElement('tr');
  var headers = ['Timestamp', 'Resource', 'Type', 'Subscription', 'Outcome'];

  headers.forEach(function(h) {
    var th = document.createElement('th');
    th.style.cssText = 'text-align:left;padding:8px 12px;border-bottom:1px solid var(--border);color:var(--text-secondary);font-weight:600;white-space:nowrap;font-size:0.75rem;text-transform:uppercase;letter-spacing:.05em;';
    th.textContent = h;
    headerRow.appendChild(th);
  });

  thead.appendChild(headerRow);
  table.appendChild(thead);

  // Body
  var tbody = document.createElement('tbody');

  rows.forEach(function(row, idx) {
    var tr = document.createElement('tr');
    tr.style.backgroundColor = idx % 2 === 0 ? '' : 'var(--surface-alt, rgba(0,0,0,0.02))';

    var cellStyle = 'padding:8px 12px;border-bottom:1px solid var(--border);vertical-align:middle;';

    // Timestamp
    var tsCell = document.createElement('td');
    tsCell.style.cssText = cellStyle + 'white-space:nowrap;color:var(--text-secondary);font-size:0.8125rem;font-family:monospace;';
    tsCell.textContent = formatDate(row.timestamp);
    tr.appendChild(tsCell);

    // Resource Name
    var nameCell = document.createElement('td');
    nameCell.style.cssText = cellStyle + 'max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    nameCell.title = escapeHtml(row.ResourceName || '');
    nameCell.textContent = row.ResourceName || '\u2014';
    tr.appendChild(nameCell);

    // Resource Type
    var typeCell = document.createElement('td');
    typeCell.style.cssText = cellStyle + 'max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-secondary);font-size:0.8125rem;';
    typeCell.title = escapeHtml(row.ResourceType || '');
    typeCell.textContent = row.ResourceType || '\u2014';
    tr.appendChild(typeCell);

    // Subscription ID (truncated)
    var subCell = document.createElement('td');
    subCell.style.cssText = cellStyle + 'font-family:monospace;font-size:0.8125rem;color:var(--text-secondary);white-space:nowrap;';
    var subId = row.SubscriptionId || '';
    subCell.title = escapeHtml(subId);
    subCell.textContent = subId ? subId.substring(0, 8) + '\u2026' : '\u2014';
    tr.appendChild(subCell);

    // Outcome
    var outcomeCell = document.createElement('td');
    outcomeCell.style.cssText = cellStyle + 'white-space:nowrap;';

    var outcome = classifyOutcome(row.message || '');
    var badge = document.createElement('span');
    badge.style.cssText = 'display:inline-block;padding:2px 8px;border-radius:4px;font-size:0.75rem;font-weight:600;' + outcome.style;
    badge.textContent = outcome.label;
    outcomeCell.appendChild(badge);
    tr.appendChild(outcomeCell);

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  tableWrapper.appendChild(table);
  container.appendChild(tableWrapper);
}

function classifyOutcome(message) {
  if (message.indexOf('Stamped') !== -1) {
    return {
      label: 'Tagged',
      style: 'background:var(--success-bg,#dcfce7);color:var(--success,#16a34a);',
    };
  }
  if (message.indexOf('Failed') !== -1) {
    return {
      label: 'Error',
      style: 'background:var(--error-bg,#fee2e2);color:var(--error,#dc2626);',
    };
  }
  return {
    label: 'Skipped',
    style: 'background:var(--warning-bg,#fef9c3);color:var(--warning,#ca8a04);',
  };
}

function renderActivityEmpty(container, title, description) {
  container.textContent = '';

  var empty = document.createElement('div');
  empty.className = 'empty-state';

  var icon = document.createElement('div');
  icon.className = 'empty-state-icon';
  icon.textContent = '\uD83D\uDCCB';

  var emptyTitle = document.createElement('div');
  emptyTitle.className = 'empty-state-title';
  emptyTitle.textContent = title;

  var emptyDesc = document.createElement('div');
  emptyDesc.className = 'empty-state-desc';
  emptyDesc.textContent = description;

  empty.appendChild(icon);
  empty.appendChild(emptyTitle);
  empty.appendChild(emptyDesc);
  container.appendChild(empty);
}
