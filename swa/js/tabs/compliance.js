// Compliance Tab — scan resources via Resource Graph and evaluate tag compliance

// Pagination state
var COMP_PAGE_SIZE = 50;
var _compCurrentPage = 0;
var _compResults = null;

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

  // Run Scan button
  var runBtn = document.createElement('button');
  runBtn.id = 'comp-run-btn';
  runBtn.className = 'btn btn-primary';
  runBtn.textContent = 'Run Scan';
  runBtn.style.flexShrink = '0';
  runBtn.addEventListener('click', function() {
    var subId = selector.value;
    if (!subId) {
      showToast('Select a subscription first', 'error');
      selector.focus();
      return;
    }
    runComplianceScan(subId);
  });
  bar.appendChild(runBtn);

  panel.appendChild(bar);

  // ── Empty state ───────────────────────────────────────────────────────────
  var resultsContainer = document.createElement('div');
  resultsContainer.id = 'comp-results-container';
  panel.appendChild(resultsContainer);

  // Check if any subscription has compliance policies
  var anyPolicies = subIds.some(function(id) {
    var sub = configSubs[id];
    return sub && sub.compliancePolicies && sub.compliancePolicies.length > 0;
  });

  var prompt = document.createElement('div');
  prompt.className = 'empty-state';

  if (!anyPolicies) {
    var icon = document.createElement('div');
    icon.className = 'empty-state-icon';
    icon.textContent = '\uD83D\uDCCB';

    var title = document.createElement('div');
    title.className = 'empty-state-title';
    title.textContent = 'No compliance policies configured';

    var desc = document.createElement('div');
    desc.className = 'empty-state-desc';
    desc.textContent = 'Add compliance policies on the Configuration tab by clicking a subscription, then "+ Add Custom Config" and scrolling to the Compliance Policies section.';

    prompt.appendChild(icon);
    prompt.appendChild(title);
    prompt.appendChild(desc);
  } else {
    var icon2 = document.createElement('div');
    icon2.className = 'empty-state-icon';
    icon2.textContent = '\u2705';

    var title2 = document.createElement('div');
    title2.className = 'empty-state-title';
    title2.textContent = 'Ready to scan';

    var desc2 = document.createElement('div');
    desc2.className = 'empty-state-desc';
    desc2.textContent = 'Select a subscription and click Run Scan to evaluate tag compliance across all resources.';

    prompt.appendChild(icon2);
    prompt.appendChild(title2);
    prompt.appendChild(desc2);
  }
  resultsContainer.appendChild(prompt);
}

// ── Compliance scan ──────────────────────────────────────────────────────────

async function runComplianceScan(subId) {
  var runBtn = document.getElementById('comp-run-btn');
  var resultsContainer = document.getElementById('comp-results-container');

  if (runBtn) {
    runBtn.disabled = true;
    runBtn.textContent = 'Scanning\u2026';
  }

  resultsContainer.textContent = '';
  var loading = document.createElement('div');
  loading.className = 'loading-state';
  var spinner = document.createElement('div');
  spinner.className = 'spinner';
  var loadingText = document.createElement('span');
  loadingText.textContent = 'Querying Azure Resource Graph\u2026';
  loading.appendChild(spinner);
  loading.appendChild(loadingText);
  resultsContainer.appendChild(loading);

  try {
    var token = await getManagementToken();
    if (!token) {
      showToast('Unable to acquire management token \u2014 please sign in', 'error');
      return;
    }

    var config = getConfig();
    var subConfig = (config.subscriptions || {})[subId] || {};
    var policies = (subConfig.compliancePolicies || []).filter(function(p) { return p.enabled !== false; });

    if (policies.length === 0) {
      resultsContainer.textContent = '';
      var noPolicy = document.createElement('div');
      noPolicy.className = 'empty-state';
      var npIcon = document.createElement('div');
      npIcon.className = 'empty-state-icon';
      npIcon.textContent = '\uD83D\uDCCB';
      var npTitle = document.createElement('div');
      npTitle.className = 'empty-state-title';
      npTitle.textContent = 'No compliance policies for this subscription';
      var npDesc = document.createElement('div');
      npDesc.className = 'empty-state-desc';
      npDesc.textContent = 'Add compliance policies on the Configuration tab to define which tags are required.';
      noPolicy.appendChild(npIcon);
      noPolicy.appendChild(npTitle);
      noPolicy.appendChild(npDesc);
      resultsContainer.appendChild(noPolicy);
      return;
    }

    // Query Resource Graph
    var kql = "Resources | where subscriptionId == '" + subId.replace(/'/g, '') + "' | project name, type, id, tags, resourceGroup | order by type asc, name asc | take 1000";
    var url = 'https://management.azure.com/providers/Microsoft.ResourceGraph/resources?api-version=2021-03-01';
    var result = await azureFetch(url, token, {
      method: 'POST',
      body: JSON.stringify({ query: kql, subscriptions: [subId] }),
    });

    var resources = (result && result.data) ? result.data : [];

    // Evaluate each resource against policies
    var compResults = resources.map(function(resource) {
      return evaluateCompliance(resource, policies);
    });

    _compResults = compResults;
    _compCurrentPage = 0;
    renderComplianceResults(compResults, policies, resultsContainer);
  } catch (err) {
    console.error('Compliance scan error:', err);
    showToast('Scan failed: ' + err.message, 'error');
    resultsContainer.textContent = '';
    var errorEl = document.createElement('div');
    errorEl.style.cssText = 'padding:20px;border-radius:6px;background:var(--surface);border:1px solid var(--error, #ef4444);color:var(--error, #ef4444);font-size:0.875rem;margin-top:8px;';
    errorEl.textContent = '\u26A0\uFE0F Scan failed: ' + err.message;
    resultsContainer.appendChild(errorEl);
  } finally {
    if (runBtn) {
      runBtn.disabled = false;
      runBtn.textContent = 'Run Scan';
    }
  }
}

// ── Compliance evaluation ────────────────────────────────────────────────────

function evaluateCompliance(resource, policies) {
  var resourceType = (resource.type || '').toLowerCase();
  var tags = resource.tags || {};
  var violations = [];

  policies.forEach(function(policy) {
    // Check resourceTypeScope — empty means all types
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
        var match = req.allowedValues.some(function(v) {
          return v.toLowerCase() === String(tagValue).toLowerCase();
        });
        if (!match) {
          violations.push({ policy: policy.name, tag: req.name, reason: 'invalid value: ' + tagValue });
          return;
        }
      }

      if (req.pattern) {
        try {
          var regex = new RegExp(req.pattern);
          if (!regex.test(String(tagValue))) {
            violations.push({ policy: policy.name, tag: req.name, reason: 'pattern mismatch: ' + tagValue });
          }
        } catch (e) {
          // Invalid regex — skip this check
        }
      }
    });
  });

  return {
    name: resource.name || '',
    type: resource.type || '',
    resourceGroup: resource.resourceGroup || '',
    id: resource.id || '',
    tags: tags,
    compliant: violations.length === 0,
    violations: violations,
  };
}

// ── Results rendering ────────────────────────────────────────────────────────

function renderComplianceResults(results, policies, container) {
  container.textContent = '';

  var totalCount = results.length;
  var compliantCount = results.filter(function(r) { return r.compliant; }).length;
  var nonCompliantCount = totalCount - compliantCount;
  var compliancePct = totalCount > 0 ? Math.round((compliantCount / totalCount) * 100) : 0;

  // ── Summary bar ───────────────────────────────────────────────────────────
  var summaryBar = document.createElement('div');
  summaryBar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;' +
    'padding:12px 16px;margin-bottom:16px;background:var(--surface-secondary,var(--surface));' +
    'border:1px solid var(--border);border-radius:6px;';

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

  summaryText.appendChild(makeStat(totalCount, 'resources scanned'));
  summaryText.appendChild(document.createTextNode('\u00B7'));
  summaryText.appendChild(makeStat(compliantCount, 'compliant', 'var(--success, #22c55e)'));
  summaryText.appendChild(document.createTextNode('\u00B7'));
  summaryText.appendChild(makeStat(nonCompliantCount, 'non-compliant', nonCompliantCount > 0 ? 'var(--error, #ef4444)' : 'var(--text-secondary)'));
  summaryText.appendChild(document.createTextNode('\u00B7'));

  // Compliance percentage badge
  var pctBadge = document.createElement('span');
  pctBadge.style.cssText = 'padding:2px 10px;border-radius:12px;font-weight:600;font-size:0.875rem;';
  if (compliancePct >= 90) {
    pctBadge.style.background = 'rgba(34,197,94,0.15)';
    pctBadge.style.color = 'var(--success, #22c55e)';
  } else if (compliancePct >= 60) {
    pctBadge.style.background = 'rgba(234,179,8,0.15)';
    pctBadge.style.color = 'var(--warning, #eab308)';
  } else {
    pctBadge.style.background = 'rgba(239,68,68,0.15)';
    pctBadge.style.color = 'var(--error, #ef4444)';
  }
  pctBadge.textContent = compliancePct + '% compliant';
  summaryText.appendChild(pctBadge);

  summaryBar.appendChild(summaryText);

  // Export buttons
  if (totalCount > 0) {
    var exportWrapper = document.createElement('div');
    exportWrapper.style.cssText = 'display:flex;gap:8px;flex-shrink:0;';

    var csvBtn = document.createElement('button');
    csvBtn.className = 'btn btn-secondary btn-sm';
    csvBtn.textContent = 'Export CSV';
    csvBtn.addEventListener('click', function() { exportComplianceCsv(results); });

    var jsonBtn = document.createElement('button');
    jsonBtn.className = 'btn btn-secondary btn-sm';
    jsonBtn.textContent = 'Export JSON';
    jsonBtn.addEventListener('click', function() { exportComplianceJson(results); });

    exportWrapper.appendChild(csvBtn);
    exportWrapper.appendChild(jsonBtn);
    summaryBar.appendChild(exportWrapper);
  }

  container.appendChild(summaryBar);

  // ── Policy breakdown ──────────────────────────────────────────────────────
  if (policies.length > 0 && nonCompliantCount > 0) {
    var policyBreakdown = document.createElement('div');
    policyBreakdown.style.cssText = 'display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px;';

    policies.forEach(function(policy) {
      var policyViolations = 0;
      results.forEach(function(r) {
        r.violations.forEach(function(v) {
          if (v.policy === policy.name) policyViolations++;
        });
      });
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

  // ── Empty results ─────────────────────────────────────────────────────────
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
    emptyDesc.textContent = 'The query returned no resources for this subscription.';
    empty.appendChild(emptyIcon);
    empty.appendChild(emptyTitle);
    empty.appendChild(emptyDesc);
    container.appendChild(empty);
    return;
  }

  // ── Pagination ────────────────────────────────────────────────────────────
  var totalPages = Math.ceil(totalCount / COMP_PAGE_SIZE);
  if (_compCurrentPage >= totalPages) _compCurrentPage = Math.max(0, totalPages - 1);
  var pageStart = _compCurrentPage * COMP_PAGE_SIZE;
  var pageEnd = Math.min(pageStart + COMP_PAGE_SIZE, totalCount);

  // Sort: non-compliant first, then compliant
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
  ['Resource Name', 'Type', 'Resource Group', 'Status', 'Violations'].forEach(function(col) {
    var th = document.createElement('th');
    th.style.cssText = 'padding:8px 12px;text-align:left;font-weight:600;font-size:0.75rem;' +
      'text-transform:uppercase;letter-spacing:0.05em;color:var(--text-secondary);' +
      'border-bottom:2px solid var(--border);white-space:nowrap;';
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

    // Name
    var tdName = document.createElement('td');
    tdName.style.cssText = 'padding:8px 12px;font-weight:500;vertical-align:top;max-width:200px;word-break:break-all;';
    tdName.textContent = result.name;

    // Type
    var tdType = document.createElement('td');
    tdType.style.cssText = 'padding:8px 12px;font-family:monospace;font-size:0.75rem;color:var(--text-secondary);vertical-align:top;max-width:240px;word-break:break-all;';
    tdType.textContent = result.type;

    // Resource Group
    var tdRg = document.createElement('td');
    tdRg.style.cssText = 'padding:8px 12px;font-size:0.8125rem;color:var(--text-secondary);vertical-align:top;';
    tdRg.textContent = result.resourceGroup;

    // Status
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

    // Violations
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

  // Pagination controls
  if (totalPages > 1) {
    var paginationBar = document.createElement('div');
    paginationBar.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:12px;padding:14px 0;';

    var prevBtn = document.createElement('button');
    prevBtn.className = 'btn btn-secondary btn-sm';
    prevBtn.textContent = '\u2190 Prev';
    prevBtn.disabled = _compCurrentPage === 0;
    prevBtn.addEventListener('click', function() {
      _compCurrentPage--;
      renderComplianceResults(sorted, policies, container);
    });

    var pageInfo = document.createElement('span');
    pageInfo.style.cssText = 'font-size:0.8125rem;color:var(--text-secondary);';
    pageInfo.textContent = (pageStart + 1) + '\u2013' + pageEnd + ' of ' + totalCount;

    var nextBtn = document.createElement('button');
    nextBtn.className = 'btn btn-secondary btn-sm';
    nextBtn.textContent = 'Next \u2192';
    nextBtn.disabled = _compCurrentPage >= totalPages - 1;
    nextBtn.addEventListener('click', function() {
      _compCurrentPage++;
      renderComplianceResults(sorted, policies, container);
    });

    paginationBar.appendChild(prevBtn);
    paginationBar.appendChild(pageInfo);
    paginationBar.appendChild(nextBtn);
    container.appendChild(paginationBar);
  }
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
      if (str.indexOf(',') !== -1 || str.indexOf('"') !== -1 || str.indexOf('\n') !== -1) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    }).join(',');
  }).join('\r\n');

  downloadBlob(csvContent, 'text/csv;charset=utf-8;', 'az-stamper-compliance.csv');
  showToast('Compliance report exported as CSV', 'success');
}

function exportComplianceJson(results) {
  var report = results.map(function(r) {
    return {
      resource: r.name,
      type: r.type,
      resourceGroup: r.resourceGroup,
      resourceId: r.id,
      compliant: r.compliant,
      violations: r.violations,
      tags: r.tags,
    };
  });
  downloadBlob(JSON.stringify(report, null, 2), 'application/json', 'az-stamper-compliance.json');
  showToast('Compliance report exported as JSON', 'success');
}

// Expose entry point
window.loadComplianceTab = loadComplianceTab;
