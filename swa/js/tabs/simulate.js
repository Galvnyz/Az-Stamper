// Simulate Tab — query Azure Resource Graph and project tag changes client-side

// Global ignore patterns mirroring the C# ConfigResolver defaults
var GLOBAL_IGNORE_PATTERNS = [
  'Microsoft.Resources/deployments',
  'Microsoft.Resources/tags',
  'Microsoft.Network/frontdoor',
  'Microsoft.Authorization/',
  'Microsoft.Resources/subscriptions',
  'Microsoft.ClassicCompute/',
  'Microsoft.Insights/diagnosticSettings',
  'Microsoft.Security/',
];

// Global default tag map (mirrors C# StampOrchestrator defaults)
var GLOBAL_DEFAULT_TAGS = [
  { name: 'Creator',        value: '{caller}',    overwrite: false },
  { name: 'CreatedOn',      value: '{timestamp}', overwrite: false },
  { name: 'LastModifiedBy', value: '{caller}',    overwrite: true  },
  { name: 'LastModifiedOn', value: '{timestamp}', overwrite: true  },
  { name: 'StampedBy',      value: 'Az-Stamper',  overwrite: false },
];

// Holds the last simulation results for CSV export
window._simResults = null;

// ── Entry point ──────────────────────────────────────────────────────────────

function loadSimulateTab() {
  var panel = document.getElementById('panel-simulate');
  panel.textContent = '';
  renderSimulateTab();
}

function renderSimulateTab() {
  var panel = document.getElementById('panel-simulate');
  panel.textContent = '';
  window._simResults = null;

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
  var bar = document.createElement('div');
  bar.className = 'controls-bar';
  bar.style.flexWrap = 'wrap';
  bar.style.gap = '10px';

  var titleEl = document.createElement('span');
  titleEl.className = 'controls-bar-title';
  titleEl.textContent = 'Simulate';
  bar.appendChild(titleEl);

  // Subscription selector
  var selectorWrapper = document.createElement('div');
  selectorWrapper.style.cssText = 'display:flex;align-items:center;gap:8px;flex-shrink:0;';

  var selectorLabel = document.createElement('label');
  selectorLabel.setAttribute('for', 'sim-sub-selector');
  selectorLabel.style.cssText = 'font-size:0.875rem;color:var(--text-secondary);white-space:nowrap;';
  selectorLabel.textContent = 'Subscription:';

  var selector = document.createElement('select');
  selector.id = 'sim-sub-selector';
  selector.className = 'form-select';
  selector.style.cssText = 'min-width:220px;max-width:360px;';

  var placeholderOpt = document.createElement('option');
  placeholderOpt.value = '';
  placeholderOpt.textContent = subIds.length === 0 ? '— no subscriptions —' : '— select a subscription —';
  placeholderOpt.disabled = true;
  placeholderOpt.selected = true;
  selector.appendChild(placeholderOpt);

  subIds.forEach(function(subId) {
    var opt = document.createElement('option');
    opt.value = subId;
    var name = (subDisplayNames[subId] || '').trim();
    opt.textContent = name ? name + ' (' + subId + ')' : subId;
    selector.appendChild(opt);
  });

  selectorWrapper.appendChild(selectorLabel);
  selectorWrapper.appendChild(selector);
  bar.appendChild(selectorWrapper);

  // Resource type filter
  var typeFilterWrapper = document.createElement('div');
  typeFilterWrapper.style.cssText = 'display:flex;align-items:center;gap:8px;flex:1;min-width:220px;';

  var typeFilterLabel = document.createElement('label');
  typeFilterLabel.setAttribute('for', 'sim-type-filter');
  typeFilterLabel.style.cssText = 'font-size:0.875rem;color:var(--text-secondary);white-space:nowrap;';
  typeFilterLabel.textContent = 'Type filter:';

  var typeFilterInput = document.createElement('input');
  typeFilterInput.type = 'text';
  typeFilterInput.id = 'sim-type-filter';
  typeFilterInput.className = 'form-input';
  typeFilterInput.style.cssText = 'flex:1;font-family:monospace;font-size:0.875rem;';
  typeFilterInput.placeholder = 'e.g. Microsoft.Compute/virtualMachines (optional)';
  typeFilterInput.setAttribute('autocomplete', 'off');
  typeFilterInput.setAttribute('spellcheck', 'false');

  typeFilterWrapper.appendChild(typeFilterLabel);
  typeFilterWrapper.appendChild(typeFilterInput);
  bar.appendChild(typeFilterWrapper);

  // Run Simulation button
  var runBtn = document.createElement('button');
  runBtn.id = 'sim-run-btn';
  runBtn.className = 'btn btn-primary';
  runBtn.textContent = 'Run Simulation';
  runBtn.style.flexShrink = '0';
  runBtn.addEventListener('click', function() {
    var subId = selector.value;
    var typeFilter = typeFilterInput.value.trim();
    if (!subId) {
      showToast('Select a subscription first', 'error');
      selector.focus();
      return;
    }
    runSimulation(subId, typeFilter);
  });
  bar.appendChild(runBtn);

  panel.appendChild(bar);

  // Allow Enter in type filter to trigger run
  typeFilterInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') runBtn.click();
  });

  // ── No subscriptions empty state ──────────────────────────────────────────
  if (subIds.length === 0) {
    var empty = document.createElement('div');
    empty.className = 'empty-state';

    var icon = document.createElement('div');
    icon.className = 'empty-state-icon';
    icon.textContent = '\uD83D\uDD0D';

    var emptyTitle = document.createElement('div');
    emptyTitle.className = 'empty-state-title';
    emptyTitle.textContent = 'No subscriptions configured';

    var emptyDesc = document.createElement('div');
    emptyDesc.className = 'empty-state-desc';
    emptyDesc.textContent = 'Add a subscription on the Subscriptions tab, then return here to simulate tag changes.';

    empty.appendChild(icon);
    empty.appendChild(emptyTitle);
    empty.appendChild(emptyDesc);
    panel.appendChild(empty);
    return;
  }

  // ── Results container (populated by runSimulation) ────────────────────────
  var resultsContainer = document.createElement('div');
  resultsContainer.id = 'sim-results-container';
  panel.appendChild(resultsContainer);

  // Prompt state
  var prompt = document.createElement('div');
  prompt.id = 'sim-prompt';
  prompt.className = 'empty-state';

  var promptIcon = document.createElement('div');
  promptIcon.className = 'empty-state-icon';
  promptIcon.textContent = '\u25B6\uFE0F';

  var promptTitle = document.createElement('div');
  promptTitle.className = 'empty-state-title';
  promptTitle.textContent = 'Ready to simulate';

  var promptDesc = document.createElement('div');
  promptDesc.className = 'empty-state-desc';
  promptDesc.textContent = 'Select a subscription and click Run Simulation to query Azure Resource Graph and preview projected tag changes.';

  prompt.appendChild(promptIcon);
  prompt.appendChild(promptTitle);
  prompt.appendChild(promptDesc);
  resultsContainer.appendChild(prompt);
}

// ── Core simulation ──────────────────────────────────────────────────────────

async function runSimulation(subId, typeFilter) {
  var panel = document.getElementById('panel-simulate');
  var runBtn = document.getElementById('sim-run-btn');
  var resultsContainer = document.getElementById('sim-results-container');

  if (runBtn) {
    runBtn.disabled = true;
    runBtn.textContent = 'Running…';
  }

  // Clear previous results — replace with loading state
  resultsContainer.textContent = '';
  var loading = document.createElement('div');
  loading.className = 'loading-state';
  var spinner = document.createElement('div');
  spinner.className = 'spinner';
  var loadingText = document.createElement('span');
  loadingText.textContent = 'Querying Azure Resource Graph…';
  loading.appendChild(spinner);
  loading.appendChild(loadingText);
  resultsContainer.appendChild(loading);

  try {
    var token = await getManagementToken();
    if (!token) {
      showToast('Unable to acquire management token — please sign in', 'error');
      renderSimulationError('Authentication required. Please sign in and try again.', resultsContainer);
      return;
    }

    // Build KQL query
    var whereClause = "subscriptionId == '" + subId + "'";
    if (typeFilter) {
      // Sanitise: strip single quotes to prevent KQL injection
      var safeType = typeFilter.replace(/'/g, '');
      whereClause += " and type =~ '" + safeType + "'";
    }
    var kql = 'Resources | where ' + whereClause + ' | project name, type, id, tags, resourceGroup | order by type asc, name asc | take 100';

    var url = 'https://management.azure.com/providers/Microsoft.ResourceGraph/resources?api-version=2021-03-01';
    var result = await azureFetch(url, token, {
      method: 'POST',
      body: JSON.stringify({ query: kql, subscriptions: [subId] }),
    });

    var resources = (result && result.data) ? result.data : [];

    // Resolve subscription config
    var config = getConfig();
    var subConfig = (config.subscriptions || {})[subId] || {};

    // Simulate each resource
    var simResults = resources.map(function(resource) {
      return simulateResource(resource, subConfig);
    });

    window._simResults = simResults;
    renderSimulationResults(simResults, resultsContainer);
  } catch (err) {
    console.error('Simulation error:', err);
    showToast('Simulation failed: ' + err.message, 'error');
    renderSimulationError('Query failed: ' + err.message, resultsContainer);
  } finally {
    if (runBtn) {
      runBtn.disabled = false;
      runBtn.textContent = 'Run Simulation';
    }
  }
}

// ── Config resolution (mirrors C# ConfigResolver) ────────────────────────────

function simulateResource(resource, subConfig) {
  var resourceId = resource.id || '';
  var resourceName = resource.name || '';
  var resourceType = resource.type || '';
  var existingTags = resource.tags || {};

  // 1. Build base tag map from global defaults
  var tagMap = {};
  GLOBAL_DEFAULT_TAGS.forEach(function(def) {
    tagMap[def.name] = { value: def.value, overwrite: def.overwrite };
  });

  // 2. Check ignore patterns
  var globalPatterns = GLOBAL_IGNORE_PATTERNS.slice();
  var additionalPatterns = subConfig.additionalIgnorePatterns || [];
  var allIgnorePatterns = globalPatterns.concat(additionalPatterns);

  var resourceIdLower = resourceId.toLowerCase();
  var isIgnored = allIgnorePatterns.some(function(pattern) {
    return resourceIdLower.indexOf(pattern.toLowerCase()) !== -1;
  });

  if (isIgnored) {
    return {
      name: resourceName,
      type: resourceType,
      resourceGroup: resource.resourceGroup || '',
      id: resourceId,
      status: 'ignored',
      tags: {},
      excludedTags: [],
      existingTags: existingTags,
    };
  }

  // 3. Merge subscription tagOverrides into tag map (overrides win)
  var tagOverrides = subConfig.tagOverrides || {};
  Object.keys(tagOverrides).forEach(function(tagName) {
    var entry = tagOverrides[tagName];
    tagMap[tagName] = {
      value: entry.value || '',
      overwrite: entry.overwrite === true,
    };
  });

  // 4. Apply resource-type rules (case-insensitive match)
  var resourceTypeRules = subConfig.resourceTypeRules || {};
  var resourceTypeLower = resourceType.toLowerCase();
  var excludedTagNames = [];

  Object.keys(resourceTypeRules).forEach(function(ruleType) {
    if (ruleType.toLowerCase() !== resourceTypeLower) return;
    var rule = resourceTypeRules[ruleType];

    // additionalTags → add to tag map
    var additionalTags = rule.additionalTags || {};
    Object.keys(additionalTags).forEach(function(tagName) {
      var entry = additionalTags[tagName];
      tagMap[tagName] = {
        value: (entry && entry.value !== undefined) ? entry.value : entry,
        overwrite: entry && entry.overwrite === true,
      };
    });

    // excludeTags → remove from tag map, track for display
    var excludeTags = rule.excludeTags || [];
    excludeTags.forEach(function(tagName) {
      if (tagMap[tagName] !== undefined) {
        delete tagMap[tagName];
        excludedTagNames.push(tagName);
      }
    });
  });

  // 5. Detect first stamp: if none of the Overwrite=false tags exist in current tags
  //    then this is a first-time stamp — skip all overwrite:true tags
  var hasAnyNonOverwriteTag = Object.keys(tagMap).some(function(tagName) {
    return tagMap[tagName].overwrite === false && existingTags.hasOwnProperty(tagName);
  });
  var isFirstStamp = !hasAnyNonOverwriteTag;

  // 6. Determine which tags are projected new/updated
  var projectedTags = {};
  Object.keys(tagMap).forEach(function(tagName) {
    var entry = tagMap[tagName];

    // First stamp: skip overwrite:true tags
    if (isFirstStamp && entry.overwrite === true) return;

    // Tag already exists and overwrite is false → skip (already stamped)
    if (existingTags.hasOwnProperty(tagName) && entry.overwrite === false) return;

    // Otherwise this tag will be written
    projectedTags[tagName] = entry.value;
  });

  // Determine status
  var status;
  if (Object.keys(projectedTags).length === 0) {
    status = 'unchanged';
  } else {
    status = 'tagged';
  }

  return {
    name: resourceName,
    type: resourceType,
    resourceGroup: resource.resourceGroup || '',
    id: resourceId,
    status: status,
    tags: projectedTags,
    excludedTags: excludedTagNames,
    existingTags: existingTags,
  };
}

// ── Results rendering ─────────────────────────────────────────────────────────

function renderSimulationResults(results, container) {
  container.textContent = '';

  var totalCount = results.length;
  var taggedCount = results.filter(function(r) { return r.status === 'tagged'; }).length;
  var ignoredCount = results.filter(function(r) { return r.status === 'ignored'; }).length;
  var unchangedCount = results.filter(function(r) { return r.status === 'unchanged'; }).length;

  // ── Summary bar ────────────────────────────────────────────────────────────
  var summaryBar = document.createElement('div');
  summaryBar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;' +
    'padding:12px 16px;margin-bottom:16px;background:var(--surface-secondary,var(--surface));' +
    'border:1px solid var(--border);border-radius:6px;';

  var summaryText = document.createElement('div');
  summaryText.style.cssText = 'font-size:0.875rem;color:var(--text-secondary);display:flex;gap:16px;flex-wrap:wrap;';

  function makeStat(value, label, color) {
    var span = document.createElement('span');
    var strong = document.createElement('strong');
    strong.style.color = color || 'var(--text-primary)';
    strong.textContent = String(value);
    span.appendChild(strong);
    span.appendChild(document.createTextNode(' ' + label));
    return span;
  }

  summaryText.appendChild(makeStat(totalCount, 'resources queried', null));
  summaryText.appendChild(document.createTextNode('\u00B7'));
  summaryText.appendChild(makeStat(taggedCount, 'would be tagged', 'var(--success, #22c55e)'));
  summaryText.appendChild(document.createTextNode('\u00B7'));
  summaryText.appendChild(makeStat(ignoredCount, 'ignored', 'var(--text-muted)'));
  summaryText.appendChild(document.createTextNode('\u00B7'));
  summaryText.appendChild(makeStat(unchangedCount, 'unchanged', 'var(--text-secondary)'));

  summaryBar.appendChild(summaryText);

  // Export CSV button (only visible when there are results)
  if (totalCount > 0) {
    var exportBtn = document.createElement('button');
    exportBtn.className = 'btn btn-secondary btn-sm';
    exportBtn.textContent = 'Export CSV';
    exportBtn.style.flexShrink = '0';
    exportBtn.addEventListener('click', exportSimulationCsv);
    summaryBar.appendChild(exportBtn);
  }

  container.appendChild(summaryBar);

  // ── Empty results state ────────────────────────────────────────────────────
  if (totalCount === 0) {
    var empty = document.createElement('div');
    empty.className = 'empty-state';

    var emptyIcon = document.createElement('div');
    emptyIcon.className = 'empty-state-icon';
    emptyIcon.textContent = '\uD83D\uDCED';

    var emptyTitle = document.createElement('div');
    emptyTitle.className = 'empty-state-title';
    emptyTitle.textContent = 'No resources found';

    var emptyDesc = document.createElement('div');
    emptyDesc.className = 'empty-state-desc';
    emptyDesc.textContent = 'The query returned no resources. Try a different subscription or remove the type filter.';

    empty.appendChild(emptyIcon);
    empty.appendChild(emptyTitle);
    empty.appendChild(emptyDesc);
    container.appendChild(empty);
    return;
  }

  // ── Results table ──────────────────────────────────────────────────────────
  var tableWrapper = document.createElement('div');
  tableWrapper.style.cssText = 'overflow-x:auto;';

  var table = document.createElement('table');
  table.style.cssText = 'width:100%;border-collapse:collapse;font-size:0.8125rem;';

  // Table header
  var thead = document.createElement('thead');
  var headerRow = document.createElement('tr');
  ['Resource Name', 'Type', 'Current Tags', 'Projected New Tags', 'Excluded Tags', 'Status'].forEach(function(col) {
    var th = document.createElement('th');
    th.style.cssText = 'padding:8px 12px;text-align:left;font-weight:600;font-size:0.75rem;' +
      'text-transform:uppercase;letter-spacing:0.05em;color:var(--text-secondary);' +
      'border-bottom:2px solid var(--border);white-space:nowrap;';
    th.textContent = col;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  // Table body
  var tbody = document.createElement('tbody');
  results.forEach(function(result, index) {
    var tr = document.createElement('tr');
    tr.style.cssText = 'border-bottom:1px solid var(--border);' + (result.status === 'ignored' ? 'opacity:0.5;' : '');

    // Alternating row background
    if (index % 2 === 1) {
      tr.style.backgroundColor = 'var(--surface-secondary, rgba(0,0,0,0.02))';
    }

    // Resource Name column
    var tdName = document.createElement('td');
    tdName.style.cssText = 'padding:8px 12px;font-weight:500;vertical-align:top;max-width:200px;word-break:break-all;';
    tdName.textContent = result.name;

    var rgSpan = document.createElement('div');
    rgSpan.style.cssText = 'font-size:0.75rem;color:var(--text-muted);margin-top:2px;font-weight:400;';
    rgSpan.textContent = result.resourceGroup;
    tdName.appendChild(rgSpan);

    // Type column
    var tdType = document.createElement('td');
    tdType.style.cssText = 'padding:8px 12px;font-family:monospace;font-size:0.75rem;color:var(--text-secondary);vertical-align:top;max-width:240px;word-break:break-all;';
    tdType.textContent = result.type;

    // Current Tags column
    var tdExisting = document.createElement('td');
    tdExisting.style.cssText = 'padding:8px 12px;vertical-align:top;';
    renderTagChips(result.existingTags, 'tag-existing', tdExisting);

    // Projected New Tags column
    var tdProjected = document.createElement('td');
    tdProjected.style.cssText = 'padding:8px 12px;vertical-align:top;';
    if (result.status === 'ignored') {
      var ignoredNote = document.createElement('span');
      ignoredNote.style.cssText = 'font-size:0.75rem;font-style:italic;color:var(--text-muted);';
      ignoredNote.textContent = 'ignored';
      tdProjected.appendChild(ignoredNote);
    } else {
      renderTagChips(result.tags, 'tag-new', tdProjected);
    }

    // Excluded Tags column
    var tdExcluded = document.createElement('td');
    tdExcluded.style.cssText = 'padding:8px 12px;vertical-align:top;';
    if (result.excludedTags && result.excludedTags.length > 0) {
      result.excludedTags.forEach(function(tagName) {
        var chip = document.createElement('span');
        chip.className = 'tag-chip tag-excluded';
        chip.textContent = tagName;
        tdExcluded.appendChild(chip);
      });
    }

    // Status column
    var tdStatus = document.createElement('td');
    tdStatus.style.cssText = 'padding:8px 12px;vertical-align:top;white-space:nowrap;';
    var statusBadge = document.createElement('span');
    statusBadge.className = 'badge';
    if (result.status === 'tagged') {
      statusBadge.className += ' badge-enabled';
      statusBadge.textContent = 'Tagged';
    } else if (result.status === 'ignored') {
      statusBadge.className += ' badge-disabled';
      statusBadge.textContent = 'Ignored';
    } else {
      statusBadge.style.cssText = 'background:var(--surface);border:1px solid var(--border);color:var(--text-secondary);';
      statusBadge.textContent = 'Unchanged';
    }
    tdStatus.appendChild(statusBadge);

    tr.appendChild(tdName);
    tr.appendChild(tdType);
    tr.appendChild(tdExisting);
    tr.appendChild(tdProjected);
    tr.appendChild(tdExcluded);
    tr.appendChild(tdStatus);
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  tableWrapper.appendChild(table);
  container.appendChild(tableWrapper);
}

function renderTagChips(tagsObj, chipClass, container) {
  var keys = Object.keys(tagsObj || {});
  if (keys.length === 0) {
    var none = document.createElement('span');
    none.style.cssText = 'font-size:0.75rem;color:var(--text-muted);font-style:italic;';
    none.textContent = 'none';
    container.appendChild(none);
    return;
  }
  keys.forEach(function(key) {
    var chip = document.createElement('span');
    chip.className = 'tag-chip ' + chipClass;
    chip.textContent = key + ': ' + String(tagsObj[key]);
    container.appendChild(chip);
  });
}

function renderSimulationError(message, container) {
  container.textContent = '';
  var errorEl = document.createElement('div');
  errorEl.style.cssText = 'padding:20px;border-radius:6px;background:var(--surface);border:1px solid var(--error, #ef4444);' +
    'color:var(--error, #ef4444);font-size:0.875rem;margin-top:8px;';

  var icon = document.createElement('span');
  icon.textContent = '\u26A0\uFE0F ';
  errorEl.appendChild(icon);
  errorEl.appendChild(document.createTextNode(message));
  container.appendChild(errorEl);
}

// ── CSV Export ────────────────────────────────────────────────────────────────

function exportSimulationCsv() {
  var results = window._simResults;
  if (!results || results.length === 0) {
    showToast('No simulation results to export', 'error');
    return;
  }

  var rows = [];
  // Header
  rows.push(['Resource', 'Type', 'Resource Group', 'Status', 'Existing Tags', 'Projected New Tags', 'Excluded Tags']);

  results.forEach(function(result) {
    var existingTagsStr = formatTagsForCsv(result.existingTags);
    var projectedTagsStr = formatTagsForCsv(result.tags);
    var excludedTagsStr = (result.excludedTags || []).join('; ');

    rows.push([
      result.name,
      result.type,
      result.resourceGroup,
      result.status,
      existingTagsStr,
      projectedTagsStr,
      excludedTagsStr,
    ]);
  });

  var csvContent = rows.map(function(row) {
    return row.map(function(cell) {
      // Escape double-quotes and wrap in double-quotes if needed
      var str = String(cell == null ? '' : cell);
      if (str.indexOf(',') !== -1 || str.indexOf('"') !== -1 || str.indexOf('\n') !== -1) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    }).join(',');
  }).join('\r\n');

  var blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  var url = URL.createObjectURL(blob);
  var link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', 'az-stamper-simulation.csv');
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  showToast('CSV exported', 'success');
}

function formatTagsForCsv(tagsObj) {
  if (!tagsObj || Object.keys(tagsObj).length === 0) return '';
  return Object.keys(tagsObj).map(function(key) {
    return key + '=' + String(tagsObj[key]);
  }).join('; ');
}

// ── Tag chip styles injected once ─────────────────────────────────────────────
// tag-existing, tag-new, tag-excluded are expected to be in styles.css.
// Provide a fallback via a style block if not already declared.
(function injectTagChipFallbacks() {
  if (document.getElementById('sim-tag-chip-styles')) return;
  var style = document.createElement('style');
  style.id = 'sim-tag-chip-styles';
  style.textContent =
    '.tag-chip{display:inline-block;padding:2px 7px;border-radius:4px;font-size:0.7rem;font-family:monospace;margin:2px 2px 2px 0;white-space:nowrap;}' +
    '.tag-existing{background:var(--surface-secondary,#f1f5f9);color:var(--text-secondary,#64748b);border:1px solid var(--border,#e2e8f0);}' +
    '.tag-new{background:rgba(34,197,94,0.12);color:var(--success,#16a34a);border:1px solid rgba(34,197,94,0.3);}' +
    '.tag-excluded{background:rgba(245,158,11,0.12);color:var(--warning,#d97706);border:1px solid rgba(245,158,11,0.3);}';
  document.head.appendChild(style);
})();

// Expose entry point on window so tab-switcher inline script can call it
window.loadSimulateTab = loadSimulateTab;
