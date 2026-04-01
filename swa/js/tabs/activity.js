// Activity Tab — recent tagging events from Application Insights

var _activityTimeRange = '1d';
var _autoRefreshInterval = null;

// Pagination state
var ACT_PAGE_SIZE = 50;
var _actCurrentPage = 0;
var _actAllRows = null;

// ── Entry point ───────────────────────────────────────────────────────────────

async function loadActivityTab() {
  // Ensure enrollment cache is populated for subscription name resolution
  await discoverEnrollment();
  var panel = document.getElementById('panel-activity');
  panel.textContent = '';
  renderActivityControls();
  refreshActivity();
}

function stopAutoRefresh() {
  if (_autoRefreshInterval) {
    clearInterval(_autoRefreshInterval);
    _autoRefreshInterval = null;
  }
}

window.loadActivityTab = loadActivityTab;
window.stopAutoRefresh = stopAutoRefresh;

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

  // Auto-refresh toggle
  var autoRefreshWrapper = document.createElement('label');
  autoRefreshWrapper.className = 'toggle-wrapper';
  autoRefreshWrapper.style.flexShrink = '0';

  var autoRefreshInput = document.createElement('input');
  autoRefreshInput.type = 'checkbox';
  autoRefreshInput.className = 'toggle-input';
  autoRefreshInput.id = 'activity-auto-refresh';
  autoRefreshInput.checked = _autoRefreshInterval !== null;
  autoRefreshWrapper.setAttribute('for', 'activity-auto-refresh');

  var autoRefreshTrack = document.createElement('span');
  autoRefreshTrack.className = 'toggle-track';
  var autoRefreshThumb = document.createElement('span');
  autoRefreshThumb.className = 'toggle-thumb';
  autoRefreshTrack.appendChild(autoRefreshThumb);

  var autoRefreshLabel = document.createElement('span');
  autoRefreshLabel.className = 'toggle-label';
  autoRefreshLabel.style.fontSize = '0.8125rem';
  autoRefreshLabel.textContent = 'Auto-refresh (30s)';

  autoRefreshInput.addEventListener('change', function() {
    if (autoRefreshInput.checked) {
      _autoRefreshInterval = setInterval(function() {
        refreshActivity();
      }, 30000);
      showToast('Auto-refresh enabled (every 30s)', 'info');
    } else {
      clearInterval(_autoRefreshInterval);
      _autoRefreshInterval = null;
    }
  });

  autoRefreshWrapper.appendChild(autoRefreshInput);
  autoRefreshWrapper.appendChild(autoRefreshTrack);
  autoRefreshWrapper.appendChild(autoRefreshLabel);
  bar.appendChild(autoRefreshWrapper);

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
    refreshBtn.textContent = 'Loading\u2026';
  }

  // Show loading state
  resultsEl.textContent = '';
  var loading = document.createElement('div');
  loading.className = 'loading-state';
  var spinner = document.createElement('div');
  spinner.className = 'spinner';
  var loadingText = document.createElement('span');
  loadingText.textContent = 'Loading activity\u2026';
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
      '| extend ResourceId = coalesce(tostring(customDimensions.ResourceId), extract("(?:on|for) (/subscriptions/[^\\\\s\\\\[]+)", 1, message))',
      '| extend SubscriptionId = coalesce(tostring(customDimensions.SubscriptionId), extract("/subscriptions/([^/]+)", 1, ResourceId))',
      '| extend ResourceType = coalesce(tostring(customDimensions.ResourceType), extract("/providers/([^/]+/[^/]+)", 1, ResourceId))',
      '| extend ResourceName = extract("[^/]+$", 0, ResourceId)',
      '| extend AppliedTags = tostring(customDimensions.AppliedTags)',
      '| where isnotempty(ResourceId)',
      '| project timestamp, ResourceName, ResourceType, SubscriptionId, message, AppliedTags',
      '| order by timestamp desc',
      '| take 500',
    ].join('\n');

    var url = 'https://management.azure.com' + appInsightsId + '/query?api-version=2018-04-20';

    var data = await azureFetch(url, token, {
      method: 'POST',
      body: JSON.stringify({ query: kql }),
    });

    var rows = parseAppInsightsResponse(data);
    _actAllRows = rows;
    _actCurrentPage = 0;
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

// ── Subscription name resolution (#72) ───────────────────────────────────────

function resolveSubscriptionName(subId) {
  if (!subId) return '';
  var enrolled = window._enrollmentCache || [];
  for (var i = 0; i < enrolled.length; i++) {
    if (enrolled[i].subscriptionId === subId) {
      return enrolled[i].displayName || '';
    }
  }
  return '';
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function renderActivityResults(container, rows) {
  container.textContent = '';

  if (!rows || rows.length === 0) {
    renderActivityEmpty(container, 'No events found', 'No tagging events were recorded in the selected time range.');
    return;
  }

  // Pagination
  var totalCount = rows.length;
  var totalPages = Math.ceil(totalCount / ACT_PAGE_SIZE);
  if (_actCurrentPage >= totalPages) _actCurrentPage = Math.max(0, totalPages - 1);
  var pageStart = _actCurrentPage * ACT_PAGE_SIZE;
  var pageEnd = Math.min(pageStart + ACT_PAGE_SIZE, totalCount);
  var pageRows = rows.slice(pageStart, pageEnd);

  // Summary bar
  var summary = document.createElement('div');
  summary.style.cssText = 'display:flex;align-items:center;gap:12px;padding:10px 0 14px 0;color:var(--text-secondary);font-size:0.875rem;';
  var countSpan = document.createElement('span');
  countSpan.style.fontWeight = '600';
  countSpan.style.color = 'var(--text-primary)';
  countSpan.textContent = totalCount + ' event' + (totalCount === 1 ? '' : 's');
  if (totalPages > 1) {
    countSpan.textContent += ' (showing ' + (pageStart + 1) + '\u2013' + pageEnd + ')';
  }
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

  pageRows.forEach(function(row, idx) {
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

    // Subscription — show display name + full ID (#72)
    var subCell = document.createElement('td');
    subCell.style.cssText = cellStyle + 'white-space:nowrap;';
    var subId = row.SubscriptionId || '';
    var subName = resolveSubscriptionName(subId);

    if (subName) {
      var nameSpan = document.createElement('div');
      nameSpan.style.cssText = 'font-weight:600;font-size:0.8125rem;color:var(--text-primary);';
      nameSpan.textContent = subName;

      var idSpan = document.createElement('div');
      idSpan.style.cssText = 'font-family:monospace;font-size:0.6875rem;color:var(--text-secondary);margin-top:1px;';
      idSpan.textContent = subId;

      subCell.appendChild(nameSpan);
      subCell.appendChild(idSpan);
    } else if (subId) {
      subCell.style.cssText += 'font-family:monospace;font-size:0.8125rem;color:var(--text-secondary);';
      subCell.title = escapeHtml(subId);
      subCell.textContent = subId;
    } else {
      subCell.textContent = '\u2014';
    }
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

    // Expandable tag detail row (#67)
    var appliedTags = parseAppliedTags(row.AppliedTags);
    if (appliedTags && Object.keys(appliedTags).length > 0) {
      var detailRow = document.createElement('tr');
      detailRow.className = 'tag-detail-row';
      detailRow.style.display = 'none';

      var detailCell = document.createElement('td');
      detailCell.colSpan = 5;
      detailCell.style.cssText = 'padding:8px 12px 12px;border-bottom:1px solid var(--border);background:var(--bg-secondary);';

      var tagLabel = document.createElement('div');
      tagLabel.style.cssText = 'font-size:0.75rem;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.05em;font-weight:600;margin-bottom:6px;';
      tagLabel.textContent = 'Applied Tags';
      detailCell.appendChild(tagLabel);

      var chipContainer = document.createElement('div');
      chipContainer.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;';

      Object.keys(appliedTags).forEach(function(key) {
        var chip = document.createElement('span');
        chip.className = 'tag-chip tag-new';
        chip.style.cssText += 'font-size:0.75rem;';
        chip.textContent = key + ' = ' + appliedTags[key];
        chipContainer.appendChild(chip);
      });

      detailCell.appendChild(chipContainer);
      detailRow.appendChild(detailCell);
      tbody.appendChild(detailRow);

      // Make the main row clickable to toggle detail
      tr.style.cursor = 'pointer';
      tr.addEventListener('click', (function(detail, mainRow) {
        return function() {
          var isOpen = detail.style.display !== 'none';
          // Collapse all other detail rows
          tbody.querySelectorAll('.tag-detail-row').forEach(function(r) {
            r.style.display = 'none';
          });
          tbody.querySelectorAll('.activity-row-expanded').forEach(function(r) {
            r.classList.remove('activity-row-expanded');
          });
          if (!isOpen) {
            detail.style.display = '';
            mainRow.classList.add('activity-row-expanded');
          }
        };
      })(detailRow, tr));
    }
  });

  table.appendChild(tbody);
  tableWrapper.appendChild(table);
  container.appendChild(tableWrapper);

  // Pagination controls
  if (totalPages > 1) {
    var paginationBar = document.createElement('div');
    paginationBar.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:12px;padding:14px 0;';

    var prevBtn = document.createElement('button');
    prevBtn.className = 'btn btn-secondary btn-sm';
    prevBtn.textContent = '\u2190 Prev';
    prevBtn.disabled = _actCurrentPage === 0;
    prevBtn.addEventListener('click', function() {
      _actCurrentPage--;
      renderActivityResults(container, rows);
    });

    var pageInfo = document.createElement('span');
    pageInfo.style.cssText = 'font-size:0.8125rem;color:var(--text-secondary);';
    pageInfo.textContent = 'Page ' + (_actCurrentPage + 1) + ' of ' + totalPages;

    var nextBtn = document.createElement('button');
    nextBtn.className = 'btn btn-secondary btn-sm';
    nextBtn.textContent = 'Next \u2192';
    nextBtn.disabled = _actCurrentPage >= totalPages - 1;
    nextBtn.addEventListener('click', function() {
      _actCurrentPage++;
      renderActivityResults(container, rows);
    });

    paginationBar.appendChild(prevBtn);
    paginationBar.appendChild(pageInfo);
    paginationBar.appendChild(nextBtn);
    container.appendChild(paginationBar);
  }
}

function parseAppliedTags(tagsStr) {
  if (!tagsStr || tagsStr === 'null' || tagsStr === '') return null;
  try {
    return JSON.parse(tagsStr);
  } catch (e) {
    return null;
  }
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
