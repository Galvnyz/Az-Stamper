// Compliance Tab — scan resources, evaluate tag compliance, remediate, and backfill

// Pagination state
var COMP_PAGE_SIZE = 50;
var _compCurrentPage = 0;
var _compResults = null;
var _compPolicies = null;
var _selectedResourceIds = new Set();
var _currentCompSubId = null;

// ── Entry point ──────────────────────────────────────────────────────────────

async function loadComplianceTab() {
  await discoverEnrollment();
  var panel = document.getElementById('panel-compliance');
  panel.textContent = '';
  renderComplianceTab();
}

function renderComplianceTab() {
  var panel = document.getElementById('panel-compliance');
  panel.textContent = '';
  _compResults = null;
  _compPolicies = null;
  _selectedResourceIds.clear();

  var config = getConfig();
  var configSubs = config.subscriptions || {};
  var enrolledSubs = _enrollmentCache || [];
  var subIds = enrolledSubs.map(function(s) { return s.subscriptionId; });
  if (subIds.length === 0) subIds = Object.keys(configSubs);

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
  titleEl.textContent = 'Compliance';
  bar.appendChild(titleEl);

  // Subscription selector
  var selectorWrapper = document.createElement('div');
  selectorWrapper.style.cssText = 'display:flex;align-items:center;gap:8px;flex-shrink:0;';

  var selectorLabel = document.createElement('label');
  selectorLabel.setAttribute('for', 'comp-sub-selector');
  selectorLabel.style.cssText = 'font-size:0.875rem;color:var(--text-secondary);white-space:nowrap;';
  selectorLabel.textContent = 'Subscription:';

  var selector = document.createElement('select');
  selector.id = 'comp-sub-selector';
  selector.className = 'form-select';
  selector.style.cssText = 'min-width:220px;max-width:360px;';

  var placeholderOpt = document.createElement('option');
  placeholderOpt.value = '';
  placeholderOpt.textContent = subIds.length === 0 ? '\u2014 no subscriptions \u2014' : '\u2014 select a subscription \u2014';
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

  // Run Scan button
  var runBtn = document.createElement('button');
  runBtn.id = 'comp-run-btn';
  runBtn.className = 'btn btn-primary';
  runBtn.textContent = 'Run Scan';
  runBtn.style.flexShrink = '0';
  runBtn.addEventListener('click', function() {
    var subId = selector.value;
    if (!subId) { showToast('Select a subscription first', 'error'); return; }
    runComplianceScan(subId);
  });
  bar.appendChild(runBtn);

  // Backfill Scan button
  var backfillBtn = document.createElement('button');
  backfillBtn.id = 'comp-backfill-btn';
  backfillBtn.className = 'btn btn-secondary';
  backfillBtn.textContent = 'Backfill Scan';
  backfillBtn.style.flexShrink = '0';
  backfillBtn.addEventListener('click', function() {
    var subId = selector.value;
    if (!subId) { showToast('Select a subscription first', 'error'); return; }
    runBackfillScan(subId);
  });
  bar.appendChild(backfillBtn);

  panel.appendChild(bar);

  // ── Results container ─────────────────────────────────────────────────────
  var resultsContainer = document.createElement('div');
  resultsContainer.id = 'comp-results-container';
  panel.appendChild(resultsContainer);

  var anyPolicies = subIds.some(function(id) {
    var sub = configSubs[id];
    return sub && sub.compliancePolicies && sub.compliancePolicies.length > 0;
  });

  var prompt = document.createElement('div');
  prompt.className = 'empty-state';

  if (!anyPolicies) {
    renderEmptyState(prompt, '\uD83D\uDCCB', 'No compliance policies configured',
      'Add compliance policies on the Configuration tab, or use Backfill Scan to find resources missing Creator tags.');
  } else {
    renderEmptyState(prompt, '\u2705', 'Ready to scan',
      'Select a subscription and click Run Scan to evaluate tag compliance, or Backfill Scan to find resources missing Creator tags.');
  }
  resultsContainer.appendChild(prompt);
}

// ── Compliance scan ──────────────────────────────────────────────────────────

async function runComplianceScan(subId) {
  var runBtn = document.getElementById('comp-run-btn');
  var resultsContainer = document.getElementById('comp-results-container');
  _currentCompSubId = subId;
  _selectedResourceIds.clear();

  if (runBtn) { runBtn.disabled = true; runBtn.textContent = 'Scanning\u2026'; }

  resultsContainer.textContent = '';
  renderLoadingState(resultsContainer, 'Querying Azure Resource Graph\u2026');

  try {
    var token = await getManagementToken();
    if (!token) { showToast('Unable to acquire management token', 'error'); return; }

    var config = getConfig();
    var subConfig = (config.subscriptions || {})[subId] || {};
    var policies = (subConfig.compliancePolicies || []).filter(function(p) { return p.enabled !== false; });

    if (policies.length === 0) {
      resultsContainer.textContent = '';
      renderEmptyState(resultsContainer, '\uD83D\uDCCB', 'No compliance policies for this subscription',
        'Add compliance policies on the Configuration tab to define which tags are required.');
      return;
    }

    var kql = "Resources | where subscriptionId == '" + subId.replace(/'/g, '') + "' | project name, type, id, tags, resourceGroup | order by type asc, name asc | take 1000";
    var url = 'https://management.azure.com/providers/Microsoft.ResourceGraph/resources?api-version=2021-03-01';
    var result = await azureFetch(url, token, {
      method: 'POST',
      body: JSON.stringify({ query: kql, subscriptions: [subId] }),
    });

    var resources = (result && result.data) ? result.data : [];
    var compResults = resources.map(function(resource) {
      return evaluateCompliance(resource, policies);
    });

    _compResults = compResults;
    _compPolicies = policies;
    _compCurrentPage = 0;
    renderComplianceResults(compResults, policies, resultsContainer, 'compliance');
  } catch (err) {
    console.error('Compliance scan error:', err);
    showToast('Scan failed: ' + err.message, 'error');
    resultsContainer.textContent = '';
    renderErrorState(resultsContainer, 'Scan failed: ' + err.message);
  } finally {
    if (runBtn) { runBtn.disabled = false; runBtn.textContent = 'Run Scan'; }
  }
}

// ── Backfill scan ────────────────────────────────────────────────────────────

async function runBackfillScan(subId) {
  var backfillBtn = document.getElementById('comp-backfill-btn');
  var resultsContainer = document.getElementById('comp-results-container');
  _currentCompSubId = subId;
  _selectedResourceIds.clear();

  if (backfillBtn) { backfillBtn.disabled = true; backfillBtn.textContent = 'Scanning\u2026'; }

  resultsContainer.textContent = '';
  renderLoadingState(resultsContainer, 'Querying Activity Log and Resource Graph\u2026');

  try {
    var token = await getManagementToken();
    if (!token) { showToast('Unable to acquire management token', 'error'); return; }

    // Query Resource Graph for resources missing Creator or CreatedOn tags
    var kql = "Resources | where subscriptionId == '" + subId.replace(/'/g, '') + "' | where isnull(tags.Creator) or isnull(tags.CreatedOn) | project name, type, id, tags, resourceGroup | order by type asc, name asc | take 1000";
    var rgUrl = 'https://management.azure.com/providers/Microsoft.ResourceGraph/resources?api-version=2021-03-01';
    var rgResult = await azureFetch(rgUrl, token, {
      method: 'POST',
      body: JSON.stringify({ query: kql, subscriptions: [subId] }),
    });
    var resources = (rgResult && rgResult.data) ? rgResult.data : [];

    if (resources.length === 0) {
      resultsContainer.textContent = '';
      renderEmptyState(resultsContainer, '\u2705', 'All resources have Creator tags',
        'No resources are missing Creator or CreatedOn tags in this subscription.');
      return;
    }

    // Query Activity Log for recent resource creation events to find callers
    var lookbackDays = 30;
    var startDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
    var activityUrl = 'https://management.azure.com/subscriptions/' + subId +
      '/providers/Microsoft.Insights/eventtypes/management/values?api-version=2015-04-01&$filter=eventTimestamp ge \'' +
      startDate + '\'&$select=eventTimestamp,operationName,resourceId,caller,status';

    var callerMap = {};
    try {
      var events = await fetchAllPages(activityUrl, token);
      events.forEach(function(evt) {
        if (!evt.resourceId || !evt.caller) return;
        if (evt.status && evt.status.value !== 'Succeeded') return;
        var rid = evt.resourceId.toLowerCase();
        if (!callerMap[rid]) {
          callerMap[rid] = { caller: evt.caller, timestamp: evt.eventTimestamp };
        }
      });
    } catch (err) {
      console.warn('Activity Log query failed (continuing without caller data):', err.message);
    }

    // Build backfill results
    var backfillResults = resources.map(function(resource) {
      var tags = resource.tags || {};
      var rid = (resource.id || '').toLowerCase();
      var activityInfo = callerMap[rid] || {};
      var violations = [];
      var proposedTags = {};

      if (tags.Creator === undefined || tags.Creator === null) {
        violations.push({ policy: 'Backfill', tag: 'Creator', reason: 'missing' });
        proposedTags.Creator = activityInfo.caller || '';
      }
      if (tags.CreatedOn === undefined || tags.CreatedOn === null) {
        violations.push({ policy: 'Backfill', tag: 'CreatedOn', reason: 'missing' });
        proposedTags.CreatedOn = activityInfo.timestamp ? new Date(activityInfo.timestamp).toISOString().replace(/\.\d+Z$/, 'Z') : '';
      }

      return {
        name: resource.name || '',
        type: resource.type || '',
        resourceGroup: resource.resourceGroup || '',
        id: resource.id || '',
        tags: tags,
        compliant: violations.length === 0,
        violations: violations,
        proposedTags: proposedTags,
      };
    }).filter(function(r) { return !r.compliant; });

    _compResults = backfillResults;
    _compPolicies = null;
    _compCurrentPage = 0;
    renderComplianceResults(backfillResults, null, resultsContainer, 'backfill');
  } catch (err) {
    console.error('Backfill scan error:', err);
    showToast('Backfill scan failed: ' + err.message, 'error');
    resultsContainer.textContent = '';
    renderErrorState(resultsContainer, 'Backfill scan failed: ' + err.message);
  } finally {
    if (backfillBtn) { backfillBtn.disabled = false; backfillBtn.textContent = 'Backfill Scan'; }
  }
}

// ── Compliance evaluation ────────────────────────────────────────────────────

function evaluateCompliance(resource, policies) {
  var resourceType = (resource.type || '').toLowerCase();
  var tags = resource.tags || {};
  var violations = [];

  policies.forEach(function(policy) {
    if (policy.resourceTypeScope && policy.resourceTypeScope.length > 0) {
      var inScope = policy.resourceTypeScope.some(function(scope) {
        return scope.toLowerCase() === resourceType;
      });
      if (!inScope) return;
    }

    (policy.requiredTags || []).forEach(function(req) {
      var tagValue = tags[req.name];
      if (tagValue === undefined || tagValue === null) {
        violations.push({ policy: policy.name, tag: req.name, reason: 'missing' });
        return;
      }
      if (req.allowedValues && req.allowedValues.length > 0) {
        var match = req.allowedValues.some(function(v) { return v.toLowerCase() === String(tagValue).toLowerCase(); });
        if (!match) { violations.push({ policy: policy.name, tag: req.name, reason: 'invalid value: ' + tagValue }); return; }
      }
      if (req.pattern) {
        try {
          if (!new RegExp(req.pattern).test(String(tagValue))) {
            violations.push({ policy: policy.name, tag: req.name, reason: 'pattern mismatch: ' + tagValue });
          }
        } catch (e) { /* invalid regex */ }
      }
    });
  });

  return {
    name: resource.name || '', type: resource.type || '', resourceGroup: resource.resourceGroup || '',
    id: resource.id || '', tags: tags, compliant: violations.length === 0, violations: violations,
  };
}

// ── Results rendering ────────────────────────────────────────────────────────

function renderComplianceResults(results, policies, container, mode) {
  container.textContent = '';
  _selectedResourceIds.clear();

  var totalCount = results.length;
  var compliantCount = results.filter(function(r) { return r.compliant; }).length;
  var nonCompliantCount = totalCount - compliantCount;
  var compliancePct = totalCount > 0 ? Math.round((compliantCount / totalCount) * 100) : 0;

  // ── Summary bar ───────────────────────────────────────────────────────────
  var summaryBar = document.createElement('div');
  summaryBar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;padding:12px 16px;margin-bottom:16px;background:var(--surface-secondary,var(--surface));border:1px solid var(--border);border-radius:6px;';

  var summaryText = document.createElement('div');
  summaryText.style.cssText = 'font-size:0.875rem;color:var(--text-secondary);display:flex;gap:16px;flex-wrap:wrap;align-items:center;';

  function makeStat(value, label, color) {
    var span = document.createElement('span');
    var strong = document.createElement('strong');
    strong.style.color = color || 'var(--text-primary)';
    strong.textContent = String(value);
    span.appendChild(strong);
    span.appendChild(document.createTextNode(' ' + label));
    return span;
  }

  var scanLabel = mode === 'backfill' ? 'resources missing Creator tags' : 'resources scanned';
  summaryText.appendChild(makeStat(totalCount, scanLabel));

  if (mode !== 'backfill') {
    summaryText.appendChild(document.createTextNode('\u00B7'));
    summaryText.appendChild(makeStat(compliantCount, 'compliant', 'var(--success, #22c55e)'));
    summaryText.appendChild(document.createTextNode('\u00B7'));
    summaryText.appendChild(makeStat(nonCompliantCount, 'non-compliant', nonCompliantCount > 0 ? 'var(--error, #ef4444)' : 'var(--text-secondary)'));
    summaryText.appendChild(document.createTextNode('\u00B7'));

    var pctBadge = document.createElement('span');
    pctBadge.style.cssText = 'padding:2px 10px;border-radius:12px;font-weight:600;font-size:0.875rem;';
    if (compliancePct >= 90) { pctBadge.style.background = 'rgba(34,197,94,0.15)'; pctBadge.style.color = 'var(--success, #22c55e)'; }
    else if (compliancePct >= 60) { pctBadge.style.background = 'rgba(234,179,8,0.15)'; pctBadge.style.color = 'var(--warning, #eab308)'; }
    else { pctBadge.style.background = 'rgba(239,68,68,0.15)'; pctBadge.style.color = 'var(--error, #ef4444)'; }
    pctBadge.textContent = compliancePct + '% compliant';
    summaryText.appendChild(pctBadge);
  }

  summaryBar.appendChild(summaryText);

  // Action buttons
  if (totalCount > 0) {
    var btnWrapper = document.createElement('div');
    btnWrapper.style.cssText = 'display:flex;gap:8px;flex-shrink:0;';

    if (nonCompliantCount > 0) {
      var remediateBtn = document.createElement('button');
      remediateBtn.id = 'comp-remediate-btn';
      remediateBtn.className = 'btn btn-primary btn-sm';
      remediateBtn.textContent = 'Remediate Selected (0)';
      remediateBtn.disabled = true;
      remediateBtn.addEventListener('click', function() { openRemediationModal(mode); });
      btnWrapper.appendChild(remediateBtn);
    }

    var csvBtn = document.createElement('button');
    csvBtn.className = 'btn btn-secondary btn-sm';
    csvBtn.textContent = 'Export CSV';
    csvBtn.addEventListener('click', function() { exportComplianceCsv(results); });

    var jsonBtn = document.createElement('button');
    jsonBtn.className = 'btn btn-secondary btn-sm';
    jsonBtn.textContent = 'Export JSON';
    jsonBtn.addEventListener('click', function() { exportComplianceJson(results); });

    btnWrapper.appendChild(csvBtn);
    btnWrapper.appendChild(jsonBtn);
    summaryBar.appendChild(btnWrapper);
  }

  container.appendChild(summaryBar);

  // ── Policy breakdown (compliance mode only) ───────────────────────────────
  if (mode === 'compliance' && policies && policies.length > 0 && nonCompliantCount > 0) {
    var policyBreakdown = document.createElement('div');
    policyBreakdown.style.cssText = 'display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px;';

    policies.forEach(function(policy) {
      var policyViolations = 0;
      results.forEach(function(r) { r.violations.forEach(function(v) { if (v.policy === policy.name) policyViolations++; }); });
      if (policyViolations === 0) return;

      var card = document.createElement('div');
      card.style.cssText = 'padding:10px 16px;background:var(--surface);border:1px solid var(--border);border-radius:6px;font-size:0.8125rem;';
      var pName = document.createElement('div');
      pName.style.cssText = 'font-weight:600;color:var(--text-primary);margin-bottom:4px;';
      pName.textContent = policy.name;
      var pCount = document.createElement('div');
      pCount.style.cssText = 'color:var(--error, #ef4444);';
      pCount.textContent = policyViolations + ' violation' + (policyViolations !== 1 ? 's' : '');
      card.appendChild(pName);
      card.appendChild(pCount);
      policyBreakdown.appendChild(card);
    });
    container.appendChild(policyBreakdown);
  }

  if (totalCount === 0) {
    renderEmptyState(container, '\uD83D\uDCED', 'No resources found', 'The query returned no resources for this subscription.');
    return;
  }

  // ── Sort and paginate ─────────────────────────────────────────────────────
  var totalPages = Math.ceil(totalCount / COMP_PAGE_SIZE);
  if (_compCurrentPage >= totalPages) _compCurrentPage = Math.max(0, totalPages - 1);
  var pageStart = _compCurrentPage * COMP_PAGE_SIZE;
  var pageEnd = Math.min(pageStart + COMP_PAGE_SIZE, totalCount);

  var sorted = results.slice().sort(function(a, b) {
    if (a.compliant === b.compliant) return 0;
    return a.compliant ? 1 : -1;
  });
  var pageResults = sorted.slice(pageStart, pageEnd);

  // ── Results table ─────────────────────────────────────────────────────────
  var tableWrapper = document.createElement('div');
  tableWrapper.style.cssText = 'overflow-x:auto;';

  var table = document.createElement('table');
  table.style.cssText = 'width:100%;border-collapse:collapse;font-size:0.8125rem;';

  var thead = document.createElement('thead');
  var headerRow = document.createElement('tr');

  var thCheck = document.createElement('th');
  thCheck.style.cssText = 'padding:8px 8px;width:36px;text-align:center;border-bottom:2px solid var(--border);';
  var selectAll = document.createElement('input');
  selectAll.type = 'checkbox';
  selectAll.title = 'Select all non-compliant';
  selectAll.addEventListener('change', function() {
    var checked = selectAll.checked;
    sorted.forEach(function(r) { if (!r.compliant) { if (checked) _selectedResourceIds.add(r.id); else _selectedResourceIds.delete(r.id); } });
    table.querySelectorAll('input[data-comp-check]').forEach(function(cb) { cb.checked = checked; });
    updateRemediateButton();
  });
  thCheck.appendChild(selectAll);
  headerRow.appendChild(thCheck);

  ['Resource Name', 'Type', 'Resource Group', 'Status', 'Violations'].forEach(function(col) {
    var th = document.createElement('th');
    th.style.cssText = 'padding:8px 12px;text-align:left;font-weight:600;font-size:0.75rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-secondary);border-bottom:2px solid var(--border);white-space:nowrap;';
    th.textContent = col;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  var tbody = document.createElement('tbody');
  pageResults.forEach(function(result, index) {
    var tr = document.createElement('tr');
    tr.style.cssText = 'border-bottom:1px solid var(--border);';
    if (index % 2 === 1) tr.style.backgroundColor = 'var(--surface-secondary, rgba(0,0,0,0.02))';

    var tdCheck = document.createElement('td');
    tdCheck.style.cssText = 'padding:8px 8px;text-align:center;vertical-align:top;';
    if (!result.compliant) {
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.setAttribute('data-comp-check', result.id);
      cb.checked = _selectedResourceIds.has(result.id);
      cb.addEventListener('change', function() {
        if (cb.checked) _selectedResourceIds.add(result.id); else _selectedResourceIds.delete(result.id);
        updateRemediateButton();
      });
      tdCheck.appendChild(cb);
    }
    tr.appendChild(tdCheck);

    var tdName = document.createElement('td');
    tdName.style.cssText = 'padding:8px 12px;font-weight:500;vertical-align:top;max-width:200px;word-break:break-all;';
    tdName.textContent = result.name;

    var tdType = document.createElement('td');
    tdType.style.cssText = 'padding:8px 12px;font-family:monospace;font-size:0.75rem;color:var(--text-secondary);vertical-align:top;max-width:240px;word-break:break-all;';
    tdType.textContent = result.type;

    var tdRg = document.createElement('td');
    tdRg.style.cssText = 'padding:8px 12px;font-size:0.8125rem;color:var(--text-secondary);vertical-align:top;';
    tdRg.textContent = result.resourceGroup;

    var tdStatus = document.createElement('td');
    tdStatus.style.cssText = 'padding:8px 12px;vertical-align:top;white-space:nowrap;';
    var statusBadge = document.createElement('span');
    statusBadge.className = 'badge';
    if (result.compliant) {
      statusBadge.className += ' badge-enabled';
      statusBadge.textContent = 'Compliant';
    } else {
      statusBadge.style.cssText = 'display:inline-block;padding:2px 8px;border-radius:4px;font-size:0.75rem;font-weight:600;background:rgba(239,68,68,0.15);color:var(--error, #ef4444);';
      statusBadge.textContent = 'Non-Compliant';
    }
    tdStatus.appendChild(statusBadge);

    var tdViolations = document.createElement('td');
    tdViolations.style.cssText = 'padding:8px 12px;vertical-align:top;';
    if (result.violations.length > 0) {
      result.violations.forEach(function(v) {
        var chip = document.createElement('span');
        chip.style.cssText = 'display:inline-block;margin:2px 4px 2px 0;padding:2px 8px;border-radius:4px;font-size:0.75rem;background:rgba(239,68,68,0.1);color:var(--error, #ef4444);';
        chip.textContent = v.tag + ' (' + v.reason + ')';
        tdViolations.appendChild(chip);
      });
    } else {
      var ok = document.createElement('span');
      ok.style.cssText = 'font-size:0.75rem;color:var(--text-muted);font-style:italic;';
      ok.textContent = 'none';
      tdViolations.appendChild(ok);
    }

    tr.appendChild(tdName);
    tr.appendChild(tdType);
    tr.appendChild(tdRg);
    tr.appendChild(tdStatus);
    tr.appendChild(tdViolations);
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  tableWrapper.appendChild(table);
  container.appendChild(tableWrapper);

  if (totalPages > 1) {
    var paginationBar = document.createElement('div');
    paginationBar.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:12px;padding:14px 0;';
    var prevBtn = document.createElement('button');
    prevBtn.className = 'btn btn-secondary btn-sm';
    prevBtn.textContent = '\u2190 Prev';
    prevBtn.disabled = _compCurrentPage === 0;
    prevBtn.addEventListener('click', function() { _compCurrentPage--; renderComplianceResults(results, policies, container, mode); });
    var pageInfo = document.createElement('span');
    pageInfo.style.cssText = 'font-size:0.8125rem;color:var(--text-secondary);';
    pageInfo.textContent = (pageStart + 1) + '\u2013' + pageEnd + ' of ' + totalCount;
    var nextBtn = document.createElement('button');
    nextBtn.className = 'btn btn-secondary btn-sm';
    nextBtn.textContent = 'Next \u2192';
    nextBtn.disabled = _compCurrentPage >= totalPages - 1;
    nextBtn.addEventListener('click', function() { _compCurrentPage++; renderComplianceResults(results, policies, container, mode); });
    paginationBar.appendChild(prevBtn);
    paginationBar.appendChild(pageInfo);
    paginationBar.appendChild(nextBtn);
    container.appendChild(paginationBar);
  }
}

function updateRemediateButton() {
  var btn = document.getElementById('comp-remediate-btn');
  if (!btn) return;
  var count = _selectedResourceIds.size;
  btn.textContent = 'Remediate Selected (' + count + ')';
  btn.disabled = count === 0;
}

// ── Remediation modal ────────────────────────────────────────────────────────

function openRemediationModal(mode) {
  if (_selectedResourceIds.size === 0 || !_compResults) return;

  var selected = _compResults.filter(function(r) { return _selectedResourceIds.has(r.id); });

  // Collect unique tags to remediate (missing violations only)
  var tagProposals = {};
  selected.forEach(function(r) {
    r.violations.forEach(function(v) {
      if (v.reason !== 'missing') return;
      if (!tagProposals[v.tag]) {
        var proposed = (r.proposedTags && r.proposedTags[v.tag]) || '';
        tagProposals[v.tag] = { value: proposed, count: 0 };
      }
      tagProposals[v.tag].count++;
    });
  });

  var body = document.createElement('div');

  var summary = document.createElement('p');
  summary.style.cssText = 'color:var(--text-secondary);margin-bottom:16px;';
  summary.textContent = 'Apply missing tags to ' + selected.length + ' resource' + (selected.length !== 1 ? 's' : '') + ':';
  body.appendChild(summary);

  // Tag value editor
  var tagKeys = Object.keys(tagProposals);
  if (tagKeys.length > 0) {
    var tagTable = document.createElement('div');
    tagTable.style.cssText = 'margin-bottom:16px;';

    tagKeys.forEach(function(tagName) {
      var row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:10px;align-items:center;margin-bottom:8px;';

      var label = document.createElement('span');
      label.style.cssText = 'font-weight:600;min-width:120px;';
      label.textContent = tagName;

      var input = document.createElement('input');
      input.type = 'text';
      input.className = 'form-input remediation-tag-value';
      input.setAttribute('data-tag-name', tagName);
      input.style.cssText = 'flex:1;';
      input.placeholder = 'Value to apply';
      input.value = tagProposals[tagName].value;

      var countLabel = document.createElement('span');
      countLabel.style.cssText = 'font-size:0.75rem;color:var(--text-muted);white-space:nowrap;';
      countLabel.textContent = tagProposals[tagName].count + ' resource' + (tagProposals[tagName].count !== 1 ? 's' : '');

      row.appendChild(label);
      row.appendChild(input);
      row.appendChild(countLabel);
      tagTable.appendChild(row);
    });
    body.appendChild(tagTable);
  }

  // Resource list
  var listLabel = document.createElement('div');
  listLabel.style.cssText = 'font-size:0.75rem;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-secondary);margin-bottom:6px;';
  listLabel.textContent = 'Resources';
  body.appendChild(listLabel);

  var list = document.createElement('div');
  list.style.cssText = 'max-height:200px;overflow-y:auto;border:1px solid var(--border);border-radius:4px;padding:8px;font-size:0.8125rem;';
  selected.forEach(function(r) {
    var item = document.createElement('div');
    item.style.cssText = 'padding:2px 0;color:var(--text-secondary);';
    item.textContent = r.name + ' (' + r.type + ')';
    list.appendChild(item);
  });
  body.appendChild(list);

  // Progress area (hidden initially)
  var progressArea = document.createElement('div');
  progressArea.id = 'remediation-progress';
  progressArea.style.display = 'none';
  body.appendChild(progressArea);

  var cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn btn-secondary';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', closeModal);

  var applyBtn = document.createElement('button');
  applyBtn.className = 'btn btn-primary';
  applyBtn.textContent = 'Apply Tags';
  applyBtn.addEventListener('click', function() {
    executeRemediation(selected, body, applyBtn, cancelBtn);
  });

  showModalDOM('Remediate Tags', body, [cancelBtn, applyBtn]);
}

async function executeRemediation(selected, body, applyBtn, cancelBtn) {
  var tagValues = {};
  body.querySelectorAll('.remediation-tag-value').forEach(function(input) {
    var tagName = input.getAttribute('data-tag-name');
    var value = input.value.trim();
    if (tagName && value) tagValues[tagName] = value;
  });

  if (Object.keys(tagValues).length === 0) {
    showToast('Enter at least one tag value', 'error');
    return;
  }

  applyBtn.disabled = true;
  applyBtn.textContent = 'Applying\u2026';
  cancelBtn.disabled = true;

  var progressArea = document.getElementById('remediation-progress');
  progressArea.style.display = '';
  progressArea.textContent = '';

  var progressText = document.createElement('div');
  progressText.style.cssText = 'margin-bottom:8px;font-size:0.875rem;color:var(--text-secondary);';
  progressArea.appendChild(progressText);

  var progressBarOuter = document.createElement('div');
  progressBarOuter.style.cssText = 'height:6px;background:var(--border);border-radius:3px;overflow:hidden;';
  var progressBarInner = document.createElement('div');
  progressBarInner.style.cssText = 'height:100%;background:var(--primary, #3b82f6);border-radius:3px;transition:width 0.2s;width:0%;';
  progressBarOuter.appendChild(progressBarInner);
  progressArea.appendChild(progressBarOuter);

  var token = await getManagementToken();
  var results = [];
  var total = selected.length;

  for (var i = 0; i < total; i++) {
    var resource = selected[i];
    progressText.textContent = 'Applying tags\u2026 ' + (i + 1) + ' / ' + total;
    progressBarInner.style.width = Math.round(((i + 1) / total) * 100) + '%';

    // Build tags for this resource — only missing tags that have a value
    var tagsForResource = {};
    resource.violations.forEach(function(v) {
      if (v.reason === 'missing' && tagValues[v.tag]) {
        // For backfill: use per-resource proposed value (e.g. actual caller from Activity Log)
        if (resource.proposedTags && resource.proposedTags[v.tag]) {
          tagsForResource[v.tag] = resource.proposedTags[v.tag];
        } else {
          tagsForResource[v.tag] = tagValues[v.tag];
        }
      }
    });

    if (Object.keys(tagsForResource).length === 0) {
      results.push({ name: resource.name, success: true });
      continue;
    }

    try {
      var patchUrl = 'https://management.azure.com' + resource.id + '/providers/Microsoft.Resources/tags/default?api-version=2021-04-01';
      await azureFetch(patchUrl, token, {
        method: 'PATCH',
        body: JSON.stringify({ operation: 'Merge', properties: { tags: tagsForResource } }),
      });
      results.push({ name: resource.name, success: true });
    } catch (err) {
      results.push({ name: resource.name, success: false, error: err.message });
    }
  }

  // Show results
  var successCount = results.filter(function(r) { return r.success; }).length;
  var failCount = results.filter(function(r) { return !r.success; }).length;

  progressArea.textContent = '';

  var resultLine = document.createElement('div');
  resultLine.style.cssText = 'margin-bottom:12px;font-size:0.875rem;';

  var successSpan = document.createElement('strong');
  successSpan.style.color = 'var(--success, #22c55e)';
  successSpan.textContent = successCount + ' succeeded';
  resultLine.appendChild(successSpan);

  if (failCount > 0) {
    resultLine.appendChild(document.createTextNode(' \u00B7 '));
    var failSpan = document.createElement('strong');
    failSpan.style.color = 'var(--error, #ef4444)';
    failSpan.textContent = failCount + ' failed';
    resultLine.appendChild(failSpan);
  }
  progressArea.appendChild(resultLine);

  if (failCount > 0) {
    var failList = document.createElement('div');
    failList.style.cssText = 'max-height:150px;overflow-y:auto;font-size:0.8125rem;';
    results.filter(function(r) { return !r.success; }).forEach(function(r) {
      var item = document.createElement('div');
      item.style.cssText = 'padding:4px 0;color:var(--error, #ef4444);';
      item.textContent = r.name + ': ' + (r.error || 'Unknown error');
      failList.appendChild(item);
    });
    progressArea.appendChild(failList);
  }

  applyBtn.style.display = 'none';
  cancelBtn.disabled = false;
  cancelBtn.textContent = 'Close';
  cancelBtn.onclick = function() {
    closeModal();
    if (_currentCompSubId) runComplianceScan(_currentCompSubId);
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function renderEmptyState(container, icon, title, desc) {
  var wrapper = container.classList && container.classList.contains('empty-state') ? container : document.createElement('div');
  if (!container.classList || !container.classList.contains('empty-state')) wrapper.className = 'empty-state';

  var iconEl = document.createElement('div');
  iconEl.className = 'empty-state-icon';
  iconEl.textContent = icon;
  var titleEl = document.createElement('div');
  titleEl.className = 'empty-state-title';
  titleEl.textContent = title;
  var descEl = document.createElement('div');
  descEl.className = 'empty-state-desc';
  descEl.textContent = desc;
  wrapper.appendChild(iconEl);
  wrapper.appendChild(titleEl);
  wrapper.appendChild(descEl);

  if (wrapper !== container) container.appendChild(wrapper);
}

function renderLoadingState(container, message) {
  var loading = document.createElement('div');
  loading.className = 'loading-state';
  var spinner = document.createElement('div');
  spinner.className = 'spinner';
  var loadingText = document.createElement('span');
  loadingText.textContent = message;
  loading.appendChild(spinner);
  loading.appendChild(loadingText);
  container.appendChild(loading);
}

function renderErrorState(container, message) {
  var errorEl = document.createElement('div');
  errorEl.style.cssText = 'padding:20px;border-radius:6px;background:var(--surface);border:1px solid var(--error, #ef4444);color:var(--error, #ef4444);font-size:0.875rem;margin-top:8px;';
  errorEl.textContent = '\u26A0\uFE0F ' + message;
  container.appendChild(errorEl);
}

// ── Export ────────────────────────────────────────────────────────────────────

function exportComplianceCsv(results) {
  var rows = [['Resource', 'Type', 'ResourceGroup', 'Status', 'Violations']];
  results.forEach(function(r) {
    var violationStr = r.violations.map(function(v) { return v.tag + ':' + v.reason; }).join('; ');
    rows.push([r.name, r.type, r.resourceGroup, r.compliant ? 'Compliant' : 'Non-Compliant', violationStr]);
  });
  var csvContent = rows.map(function(row) {
    return row.map(function(cell) {
      var str = String(cell == null ? '' : cell);
      if (str.indexOf(',') !== -1 || str.indexOf('"') !== -1 || str.indexOf('\n') !== -1) return '"' + str.replace(/"/g, '""') + '"';
      return str;
    }).join(',');
  }).join('\r\n');
  downloadBlob(csvContent, 'text/csv;charset=utf-8;', 'az-stamper-compliance.csv');
  showToast('Compliance report exported as CSV', 'success');
}

function exportComplianceJson(results) {
  var report = results.map(function(r) {
    return { resource: r.name, type: r.type, resourceGroup: r.resourceGroup, resourceId: r.id, compliant: r.compliant, violations: r.violations, tags: r.tags };
  });
  downloadBlob(JSON.stringify(report, null, 2), 'application/json', 'az-stamper-compliance.json');
  showToast('Compliance report exported as JSON', 'success');
}

// Expose entry point
window.loadComplianceTab = loadComplianceTab;
