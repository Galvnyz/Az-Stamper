// Enrollment module — Event Grid enrollment discovery, RBAC health check, pause, and resume

var _enrollmentCache = null;
var _functionAppPrincipalId = null;

// Built-in Azure role definition IDs
var ROLE_READER = 'acdd72a7-3385-48ef-bd42-f606fba81ae7';
var ROLE_TAG_CONTRIBUTOR = '4a9ae827-6dc8-4573-8ac7-8239d42aa03f';

// Follows ARM API nextLink pagination and collects all items from value arrays
async function fetchAllPages(url, token) {
  var allItems = [];
  var currentUrl = url;
  var maxPages = 10; // safety limit
  while (currentUrl && maxPages > 0) {
    var data = await azureFetch(currentUrl, token);
    var items = (data && data.value) ? data.value : [];
    allItems = allItems.concat(items);
    currentUrl = data && data.nextLink ? data.nextLink : null;
    maxPages--;
  }
  return allItems;
}

// Returns cached enrollment data, or fetches fresh if not yet loaded
async function discoverEnrollment() {
  if (_enrollmentCache !== null) {
    return _enrollmentCache;
  }
  return refreshEnrollment();
}

// Always fetches fresh enrollment state across all accessible subscriptions
async function refreshEnrollment() {
  var token = await getManagementToken();
  if (!token) {
    showToast('Unable to acquire management token', 'error');
    _enrollmentCache = [];
    return _enrollmentCache;
  }

  var subsData;
  try {
    subsData = await azureFetch(
      'https://management.azure.com/subscriptions?api-version=2022-12-01',
      token
    );
  } catch (err) {
    console.error('Failed to list subscriptions:', err);
    showToast('Failed to list subscriptions', 'error');
    _enrollmentCache = [];
    return _enrollmentCache;
  }

  var subs = (subsData && subsData.value) ? subsData.value : [];
  console.log('Enrollment: checking ' + subs.length + ' accessible subscription(s): ' +
    subs.map(function(s) { return s.displayName; }).join(', '));

  await loadConfig();
  var config = getConfig();
  var configSubs = (config && config.subscriptions) ? config.subscriptions : {};

  // Resolve function app's managed identity for RBAC checks
  var principalId = await getFunctionAppPrincipalId(token);

  var checks = subs.map(function(sub) {
    return checkEnrollmentDetail(sub.subscriptionId, token).then(function(detail) {
      if (!detail) return null;
      return {
        subscriptionId: sub.subscriptionId,
        displayName: sub.displayName,
        enrolled: true,
        active: detail.active,
        systemTopicName: detail.systemTopicName,
        systemTopicRg: detail.systemTopicRg,
        eventSubscriptionName: detail.eventSubscriptionName,
        hasCustomConfig: Object.prototype.hasOwnProperty.call(configSubs, sub.subscriptionId),
        rbacStatus: null, // filled in after RBAC check
      };
    });
  });

  var results = await Promise.allSettled(checks);

  var enrolled = [];
  results.forEach(function(result) {
    if (result.status === 'fulfilled' && result.value !== null) {
      enrolled.push(result.value);
    } else if (result.status === 'rejected') {
      console.error('Enrollment check failed for a subscription:', result.reason);
    }
  });

  // Run RBAC health checks in parallel for active subscriptions
  if (principalId) {
    var rbacChecks = enrolled.map(function(sub) {
      if (!sub.active) return Promise.resolve(null);
      return checkRbacHealth(sub.subscriptionId, principalId, token).then(function(status) {
        sub.rbacStatus = status;
      });
    });
    await Promise.allSettled(rbacChecks);
  }

  console.log('Enrollment: found ' + enrolled.length + ' enrolled sub(s): ' +
    enrolled.map(function(s) { return s.displayName + ' (' + (s.active ? 'active' : 'paused') + ')'; }).join(', '));

  _enrollmentCache = enrolled;
  return _enrollmentCache;
}

// Resolves the function app's managed identity principal ID (cached)
async function getFunctionAppPrincipalId(token) {
  if (_functionAppPrincipalId) return _functionAppPrincipalId;

  var functionAppId = (window.AZ_STAMPER_CONFIG || {}).functionAppId || '';
  if (!functionAppId) return null;

  try {
    var data = await azureFetch(
      'https://management.azure.com' + functionAppId + '?api-version=2023-12-01',
      token
    );
    if (data && data.identity && data.identity.principalId) {
      _functionAppPrincipalId = data.identity.principalId;
      console.log('Enrollment: function app principal ID = ' + _functionAppPrincipalId);
      return _functionAppPrincipalId;
    }
  } catch (err) {
    console.warn('Enrollment: could not resolve function app identity:', err.message);
  }
  return null;
}

// Checks whether the function app's managed identity has Reader + Tag Contributor on a subscription
async function checkRbacHealth(subId, principalId, token) {
  if (!principalId) return 'unknown';

  var url = 'https://management.azure.com/subscriptions/' + subId +
    '/providers/Microsoft.Authorization/roleAssignments?api-version=2022-04-01' +
    '&$filter=principalId%20eq%20%27' + principalId + '%27';

  var assignments;
  try {
    assignments = await fetchAllPages(url, token);
  } catch (err) {
    console.warn('Enrollment: RBAC check failed for ' + subId + ':', err.message);
    return 'unknown';
  }

  var hasReader = false;
  var hasTagContributor = false;

  for (var i = 0; i < assignments.length; i++) {
    var props = assignments[i].properties || {};
    var roleId = (props.roleDefinitionId || '').toLowerCase();
    if (roleId.indexOf(ROLE_READER) !== -1) hasReader = true;
    if (roleId.indexOf(ROLE_TAG_CONTRIBUTOR) !== -1) hasTagContributor = true;
    if (hasReader && hasTagContributor) break;
  }

  if (hasReader && hasTagContributor) return 'ok';

  var missing = [];
  if (!hasReader) missing.push('Reader');
  if (!hasTagContributor) missing.push('Tag Contributor');
  console.log('Enrollment: ' + subId + ' missing RBAC: ' + missing.join(', '));
  return 'degraded';
}

// Checks a single subscription for an Az-Stamper Event Grid system topic
async function checkEnrollmentDetail(subId, token) {
  var topicsUrl = 'https://management.azure.com/subscriptions/' + subId +
    '/providers/Microsoft.EventGrid/systemTopics?api-version=2022-06-15';

  var topics = [];
  try {
    topics = await fetchAllPages(topicsUrl, token);
  } catch (err) {
    console.warn('Enrollment check: cannot list system topics for ' + subId + ' (' + err.message + ')');
    return null;
  }
  console.log('Enrollment check: ' + subId + ' has ' + topics.length + ' system topic(s)');

  var matchingTopic = null;
  for (var i = 0; i < topics.length; i++) {
    var topic = topics[i];
    var topicType = (topic.properties && topic.properties.topicType) ? topic.properties.topicType : '';
    if (topicType.toLowerCase() === 'microsoft.resources.subscriptions') {
      matchingTopic = topic;
      break;
    }
  }

  if (!matchingTopic) {
    console.log('Enrollment check: no matching system topic for ' + subId);
    return null;
  }

  var topicId = matchingTopic.id;
  var rgMatch = topicId.match(/resourceGroups\/([^/]+)/i);
  var systemTopicRg = rgMatch ? rgMatch[1] : null;
  var systemTopicName = matchingTopic.name;

  var esUrl = 'https://management.azure.com' + topicId +
    '/eventSubscriptions?api-version=2022-06-15';

  var esData;
  try {
    esData = await azureFetch(esUrl, token);
  } catch (err) {
    console.error('Failed to list event subscriptions for topic ' + topicId + ':', err);
    // Fail-open: topic exists, assume active even if we can't list event subscriptions
    return {
      active: true,
      systemTopicName: systemTopicName,
      systemTopicRg: systemTopicRg,
      eventSubscriptionName: null,
    };
  }

  var eventSubs = (esData && esData.value) ? esData.value : [];
  var functionAppId = (window.AZ_STAMPER_CONFIG || {}).functionAppId || '';

  // Only consider event subscriptions that target this Az-Stamper function app
  var matchingEs = null;
  for (var j = 0; j < eventSubs.length; j++) {
    var es = eventSubs[j];
    var dest = es.properties && es.properties.destination;
    var destId = (dest && dest.properties && dest.properties.resourceId) || '';
    if (functionAppId && destId.toLowerCase().indexOf(functionAppId.toLowerCase()) === 0) {
      matchingEs = es;
      break;
    }
  }

  var active = matchingEs !== null;
  var eventSubscriptionName = active ? matchingEs.name : null;

  return {
    active: active,
    systemTopicName: systemTopicName,
    systemTopicRg: systemTopicRg,
    eventSubscriptionName: eventSubscriptionName,
  };
}

// Pauses enrollment by deleting the event subscription for a sub
async function pauseEnrollment(sub) {
  var token = await getManagementToken();
  if (!token) {
    showToast('Unable to acquire management token', 'error');
    return false;
  }

  var url = 'https://management.azure.com/subscriptions/' + sub.subscriptionId +
    '/resourceGroups/' + sub.systemTopicRg +
    '/providers/Microsoft.EventGrid/systemTopics/' + sub.systemTopicName +
    '/eventSubscriptions/' + sub.eventSubscriptionName +
    '?api-version=2022-06-15';

  try {
    await azureFetch(url, token, { method: 'DELETE' });
    showToast('Enrollment paused for ' + sub.displayName, 'success');
    invalidateEnrollmentCache();
    return true;
  } catch (err) {
    console.error('Failed to pause enrollment for ' + sub.subscriptionId + ':', err);
    showToast('Failed to pause enrollment for ' + sub.displayName, 'error');
    return false;
  }
}

// Resumes enrollment by creating an event subscription for a sub
async function resumeEnrollment(sub) {
  var token = await getManagementToken();
  if (!token) {
    showToast('Unable to acquire management token', 'error');
    return false;
  }

  var functionAppId = (window.AZ_STAMPER_CONFIG || {}).functionAppId || '';
  var esName = sub.eventSubscriptionName || 'evgs-az-stamper';

  var url = 'https://management.azure.com/subscriptions/' + sub.subscriptionId +
    '/resourceGroups/' + sub.systemTopicRg +
    '/providers/Microsoft.EventGrid/systemTopics/' + sub.systemTopicName +
    '/eventSubscriptions/' + esName +
    '?api-version=2022-06-15';

  var body = {
    properties: {
      destination: {
        endpointType: 'AzureFunction',
        properties: {
          resourceId: functionAppId + '/functions/ResourceStamper',
        },
      },
      filter: {
        includedEventTypes: ['Microsoft.Resources.ResourceWriteSuccess'],
        advancedFilters: [
          {
            operatorType: 'StringNotContains',
            key: 'data.operationName',
            values: [
              'Microsoft.Resources/deployments',
              'Microsoft.Resources/tags',
            ],
          },
        ],
      },
    },
  };

  try {
    await azureFetch(url, token, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
    showToast('Enrollment resumed for ' + sub.displayName, 'success');
    invalidateEnrollmentCache();
    return true;
  } catch (err) {
    console.error('Failed to resume enrollment for ' + sub.subscriptionId + ':', err);
    showToast('Failed to resume enrollment for ' + sub.displayName, 'error');
    return false;
  }
}

// Clears the enrollment cache so the next call to discoverEnrollment fetches fresh data
function invalidateEnrollmentCache() {
  _enrollmentCache = null;
}
